import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import {
  CATALOG_POPULATION_STATUS,
  CatalogPopulationRequestedPayload,
  CreateCatalogPopulationJobRequest,
} from '../interfaces/catalog-population.interface';
import { redactTracePayload } from '../utils/trace-redaction.util';

const MAX_POPULATION_RADIUS_METERS = 25_000;
const MAX_POPULATION_CANDIDATES = 250;

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class CatalogPopulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly catalog: ExperienceCatalogService,
    private readonly acquisition: ExperienceAcquisitionService,
  ) {}

  async createJob(request: CreateCatalogPopulationJobRequest) {
    this.validateBounds(request);
    const existing = await this.prisma.catalogPopulationJob.findUnique({
      where: { idempotencyKey: request.idempotencyKey },
    });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.catalogPopulationJob.create({
        data: {
          idempotencyKey: request.idempotencyKey,
          requestedById: request.requestedById,
          scope: asInputJson(request.scope),
          themes: request.themes,
          intents: request.intents ?? [],
          status: CATALOG_POPULATION_STATUS.PENDING,
          trace: asInputJson(
            redactTracePayload({
              version: 1,
              bounded: true,
              scope: request.scope,
              themes: request.themes,
              intents: request.intents ?? [],
              maxCandidates: Math.min(
                request.maxCandidates ?? MAX_POPULATION_CANDIDATES,
                MAX_POPULATION_CANDIDATES,
              ),
            }),
          ),
        },
      });
      const payload: CatalogPopulationRequestedPayload = {
        jobId: job.id,
        eventKey: `catalog-population:${job.id}`,
      };
      await this.outbox.createInTx(tx, {
        eventType: 'CatalogPopulationRequested',
        payload,
      });
      return job;
    });
  }

  async getJob(jobId: string, requestedById: string) {
    return this.prisma.catalogPopulationJob.findFirstOrThrow({
      where: { id: jobId, requestedById },
    });
  }

  async process(jobId: string): Promise<void> {
    const job = await this.prisma.catalogPopulationJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    if (job.status === CATALOG_POPULATION_STATUS.COMPLETED) return;
    if (job.status === CATALOG_POPULATION_STATUS.RUNNING) {
      // Durable redelivery can recover a worker that died after setting RUNNING.
      await this.prisma.catalogPopulationJob.update({
        where: { id: job.id },
        data: { status: CATALOG_POPULATION_STATUS.RETRYABLE },
      });
    }

    const scope = job.scope as unknown as {
      label: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
    };
    const maxCandidates = Math.min(
      Number((job.trace as any)?.maxCandidates ?? MAX_POPULATION_CANDIDATES),
      MAX_POPULATION_CANDIDATES,
    );
    const attempt = job.attemptCount + 1;

    await this.prisma.catalogPopulationJob.update({
      where: { id: job.id },
      data: {
        status: CATALOG_POPULATION_STATUS.RUNNING,
        attemptCount: attempt,
        startedAt: job.startedAt ?? new Date(),
        lastError: null,
      },
    });

    try {
      const before = await this.catalog.findVerifiedWithin(
        scope.latitude,
        scope.longitude,
        scope.radiusMeters,
        MAX_POPULATION_CANDIDATES,
      );
      const acquired = await this.acquisition.acquireNearby({
        latitude: scope.latitude,
        longitude: scope.longitude,
        radius: Math.min(scope.radiusMeters, 5000),
        interests: job.themes,
        maxResultCount: maxCandidates,
      });
      const after = await this.catalog.findVerifiedWithin(
        scope.latitude,
        scope.longitude,
        scope.radiusMeters,
        MAX_POPULATION_CANDIDATES,
      );
      const beforeIds = new Set(before.map((item: any) => item.id));
      const createdCount = after.filter(
        (item: any) => !beforeIds.has(item.id),
      ).length;
      const reusedCount = acquired.experienceIds.filter((id) =>
        beforeIds.has(id),
      ).length;

      await this.prisma.catalogPopulationJob.update({
        where: { id: job.id },
        data: {
          status: CATALOG_POPULATION_STATUS.COMPLETED,
          beforeCount: before.length,
          afterCount: after.length,
          createdCount,
          reusedCount,
          completedAt: new Date(),
          trace: asInputJson(
            redactTracePayload({
              ...(job.trace as any),
              attempt,
              beforeCount: before.length,
              acquiredCount: acquired.experienceIds.length,
              afterCount: after.length,
              createdCount,
              reusedCount,
              provenance: acquired.provenance,
              coverageDelta: after.length - before.length,
            }),
          ),
        },
      });
    } catch (error: any) {
      const terminal = attempt >= job.maxAttempts;
      await this.prisma.catalogPopulationJob.update({
        where: { id: job.id },
        data: {
          status: terminal
            ? CATALOG_POPULATION_STATUS.FAILED
            : CATALOG_POPULATION_STATUS.RETRYABLE,
          lastError: error?.message ?? String(error),
          trace: asInputJson(
            redactTracePayload({
              ...(job.trace as any),
              attempt,
              error: error?.message ?? String(error),
              retryable: !terminal,
            }),
          ),
        },
      });
      throw error;
    }
  }

  private validateBounds(request: CreateCatalogPopulationJobRequest) {
    if (!request.idempotencyKey?.trim()) {
      throw new BadRequestException('idempotencyKey is required');
    }
    if (
      !Number.isFinite(request.scope.latitude) ||
      !Number.isFinite(request.scope.longitude) ||
      !Number.isFinite(request.scope.radiusMeters) ||
      request.scope.radiusMeters <= 0 ||
      request.scope.radiusMeters > MAX_POPULATION_RADIUS_METERS
    ) {
      throw new BadRequestException(
        `population scope must be bounded to <= ${MAX_POPULATION_RADIUS_METERS} meters`,
      );
    }
    if ((request.maxCandidates ?? 1) > MAX_POPULATION_CANDIDATES) {
      throw new BadRequestException(
        `population maxCandidates must be <= ${MAX_POPULATION_CANDIDATES}`,
      );
    }
  }
}
