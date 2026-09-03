import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { CreateDayTripDto } from '../dto/create-day-trip.dto';
import {
  OriginBoundOpenDestinationScope,
  DayTripFeasibilityResult,
} from '../interfaces/day-trip.interface';
import {
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import { PreferenceInterpreterService } from './preference-interpreter.service';
import { evaluateExperiencePreferences } from '../utils/experience-preference-evaluator.util';
import { buildExperienceFootprint, buildPointFootprint } from '../utils/spatial-footprint.util';
import { evaluateDayTripFeasibility } from '../utils/day-trip-feasibility.util';
import { redactTracePayload } from '../utils/trace-redaction.util';

const MAX_OPEN_DESTINATION_CATALOG = 250;
const MAX_ROUTED_CANDIDATES = 50;
const MAX_COARSE_RADIUS_METERS = 400_000;
const COARSE_METERS_PER_TRAVEL_MINUTE = 2_000;

interface DayTripCandidateEvaluation {
  experience: any;
  preferenceScore: number;
  exclusionMatches: string[];
  outbound: TravelEstimate;
  returnTrip: TravelEstimate;
  feasibility: DayTripFeasibilityResult;
  score: number;
}

@Injectable()
export class DayTripGenerationService {
  private readonly logger = new Logger(DayTripGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly catalog: ExperienceCatalogService,
    private readonly preferenceInterpreter: PreferenceInterpreterService,
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelProvider: TravelEstimateProvider,
  ) {}

  async create(request: CreateDayTripDto, ownerId: string) {
    this.validateRequest(request);
    const scope = this.toScope(request);
    const storedRequest = this.toJson({
      ...request,
      scope,
      contractVersion: 1,
    });

    return this.prisma.$transaction(async (tx) => {
      const tour = await tx.tour.create({
        data: {
          ownerId,
          name: `Escapada desde ${request.origin.label}`,
          description: request.additionalPreferences,
          totalDays: request.overnightPolicy === 'allow_overnight' ? 2 : 1,
          startDates: [new Date(`${request.startDate}T00:00:00.000Z`)],
          categories: ['day_trip', ...request.interests],
          prompt: request.additionalPreferences,
          metadata: {
            generationStatus: 'pending',
            generationKind: 'origin_bound_open',
            dayTripRequest: storedRequest,
          },
        },
        include: { experiences: true },
      });
      await this.outbox.createInTx(tx, {
        eventType: 'DayTripGenerationRequested',
        payload: {
          eventKey: `day-trip-generation:${tour.id}`,
          tourId: tour.id,
          userId: ownerId,
          requestedAt: new Date().toISOString(),
        },
      });
      return tour;
    });
  }

  async generate(tourId: string): Promise<void> {
    const tour = await this.prisma.tour.findUniqueOrThrow({
      where: { id: tourId },
      include: { experiences: true },
    });
    const metadata = (tour.metadata ?? {}) as any;
    if (
      metadata.generationStatus === 'completed' &&
      (tour.experiences?.length ?? 0) > 0
    ) {
      return;
    }
    if (metadata.generationStatus === 'failed') return;

    const request = metadata.dayTripRequest as any;
    if (!request || request.scope?.kind !== 'origin_bound_open') {
      throw new BadRequestException('Tour does not contain an origin-bound day trip request');
    }
    const scope = request.scope as OriginBoundOpenDestinationScope;

    await this.updateStatus(tourId, metadata, 'generating', 'Evaluando escapadas desde el origen...');

    try {
      const interpreted = await this.preferenceInterpreter.interpret(
        request.additionalPreferences,
      );
      const normalized = {
        ...interpreted.intent,
        preferredThemes: Array.from(
          new Set([
            ...(interpreted.intent.preferredThemes ?? []),
            ...(request.interests ?? []),
          ].map((value) => String(value).trim().toLowerCase()).filter(Boolean)),
        ),
      };
      const coarseRadiusMeters = Math.min(
        MAX_COARSE_RADIUS_METERS,
        Math.max(scope.maxOutboundTravelMinutes, scope.maxReturnTravelMinutes) *
          COARSE_METERS_PER_TRAVEL_MINUTE,
      );
      const catalogCandidates = await this.catalog.findVerifiedWithin(
        scope.origin.latitude,
        scope.origin.longitude,
        coarseRadiusMeters,
        MAX_OPEN_DESTINATION_CATALOG,
      );
      if (catalogCandidates.length === 0) {
        await this.persistTerminalFailure(
          tourId,
          metadata,
          'NO_OPEN_DESTINATION_COVERAGE',
          {
            scope,
            coarseRadiusMeters,
            catalogCandidateCount: 0,
            preferenceInterpretation: interpreted.trace,
          },
        );
        return;
      }

      const scored = catalogCandidates
        .map((experience: any) => ({
          experience,
          evaluation: evaluateExperiencePreferences(experience, normalized),
        }))
        .sort((left, right) => {
          if (right.evaluation.score !== left.evaluation.score) {
            return right.evaluation.score - left.evaluation.score;
          }
          const rightQuality = Number(right.experience.qualityScore ?? 0);
          const leftQuality = Number(left.experience.qualityScore ?? 0);
          if (rightQuality !== leftQuality) return rightQuality - leftQuality;
          return String(left.experience.id).localeCompare(String(right.experience.id));
        });
      const strict = scored.filter(
        (candidate) => candidate.evaluation.exclusionMatches.length === 0,
      );
      const routedPool = (strict.length > 0 ? strict : scored).slice(
        0,
        MAX_ROUTED_CANDIDATES,
      );

      const origin = buildPointFootprint(
        scope.origin.latitude,
        scope.origin.longitude,
      );
      const candidateEvaluations: DayTripCandidateEvaluation[] = [];
      for (const candidate of routedPool) {
        const footprint = buildExperienceFootprint(candidate.experience);
        if (
          !Number.isFinite(footprint.centroid.lat) ||
          !Number.isFinite(footprint.centroid.lng)
        ) {
          continue;
        }
        const outbound = await this.travelProvider.estimate(
          origin,
          footprint,
          scope.allowedTransportationModes,
        );
        const returnTrip = await this.travelProvider.estimate(
          footprint,
          origin,
          scope.allowedTransportationModes,
        );
        const feasibility = evaluateDayTripFeasibility({
          scope,
          departureMinutesFromMidnight:
            scope.departureWindow.earliestMinutesFromMidnight,
          outboundTravelMinutes: outbound.durationMinutes,
          experienceDurationMinutes:
            candidate.experience.durationMinutes ?? 180,
          returnTravelMinutes: returnTrip.durationMinutes,
        });
        const quality = Number(candidate.experience.qualityScore ?? 0);
        const score =
          candidate.evaluation.score * 100 +
          quality * 10 -
          (outbound.durationMinutes + returnTrip.durationMinutes) / 10;
        candidateEvaluations.push({
          experience: candidate.experience,
          preferenceScore: candidate.evaluation.score,
          exclusionMatches: candidate.evaluation.exclusionMatches,
          outbound,
          returnTrip,
          feasibility,
          score,
        });
      }

      const feasible = candidateEvaluations
        .filter((candidate) => candidate.feasibility.feasible)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          return String(left.experience.id).localeCompare(
            String(right.experience.id),
          );
        });
      if (feasible.length === 0) {
        await this.persistTerminalFailure(
          tourId,
          metadata,
          'NO_FEASIBLE_ROUND_TRIP',
          {
            scope,
            coarseRadiusMeters,
            catalogCandidateCount: catalogCandidates.length,
            routedCandidateCount: candidateEvaluations.length,
            preferenceInterpretation: interpreted.trace,
            candidateDecisions: candidateEvaluations.map((candidate) =>
              this.traceCandidate(candidate),
            ),
          },
        );
        return;
      }

      const selected = feasible[0];
      const selectedEntity = await this.prisma.experience.findUniqueOrThrow({
        where: { id: selected.experience.id },
        include: { components: { include: { geoEntity: true } } },
      });
      const experienceStartMinutes =
        scope.departureWindow.earliestMinutesFromMidnight +
        selected.outbound.durationMinutes;
      const startTime = this.dateAtMinutes(request.startDate, experienceStartMinutes);
      const trace = redactTracePayload({
        version: 1,
        kind: 'origin_bound_open',
        canonicalRequest: request,
        localCatalogFirst: true,
        coarseRadiusMeters,
        catalogCandidateCount: catalogCandidates.length,
        routedCandidateCount: candidateEvaluations.length,
        hardExclusionRelaxed: strict.length === 0 && scored.length > 0,
        preferenceInterpretation: interpreted.trace,
        candidateDecisions: candidateEvaluations.map((candidate) =>
          this.traceCandidate(candidate),
        ),
        selected: this.traceCandidate(selected),
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.tourExperience.deleteMany({ where: { tourId } });
        await tx.tourExperience.create({
          data: {
            tourId,
            experienceId: selectedEntity.id,
            dayNumber: 1,
            order: 1,
            startTime,
            duration: (selectedEntity.durationMinutes ?? 180) / 60,
            notes: selected.feasibility.overnight
              ? 'Escapada con pernocte habilitado explícitamente.'
              : 'Escapada ida y vuelta en el día.',
            components: {
              create: selectedEntity.components.map((component, index) => ({
                geoEntityId: component.geoEntityId,
                order: component.order ?? index + 1,
                role: component.role,
                required: component.required,
                name: component.geoEntity.name,
                latitude: component.geoEntity.latitude,
                longitude: component.geoEntity.longitude,
                geometry: component.geoEntity.geometry,
              })),
            },
          },
        });
        const completedAt = new Date().toISOString();
        await tx.tour.update({
          where: { id: tourId },
          data: {
            totalDays: selected.feasibility.overnight ? 2 : 1,
            metadata: {
              ...metadata,
              generationStatus: 'completed',
              generationKind: 'origin_bound_open',
              generationCompletedAt: completedAt,
              dayTripTrace: trace,
              selectedDestination: {
                experienceId: selectedEntity.id,
                name: selectedEntity.canonicalName,
                latitude: selectedEntity.latitude,
                longitude: selectedEntity.longitude,
              },
              roundTrip: {
                outbound: selected.outbound,
                returnTrip: selected.returnTrip,
                feasibility: selected.feasibility,
              },
            },
          },
        });
        await this.outbox.createInTx(tx, {
          eventType: 'TourCompleted',
          payload: {
            tourId,
            userId: tour.ownerId ?? undefined,
            status: 'COMPLETED',
            totalActivities: 1,
            message: selected.feasibility.overnight
              ? 'Escapada con pernocte generada.'
              : 'Escapada same-day generada.',
          },
        });
      });
    } catch (error: any) {
      this.logger.error(
        `Day trip generation failed for ${tourId}: ${error?.message ?? error}`,
      );
      throw error;
    }
  }

  private async updateStatus(
    tourId: string,
    metadata: any,
    status: string,
    message: string,
  ) {
    await this.prisma.tour.update({
      where: { id: tourId },
      data: {
        metadata: {
          ...metadata,
          generationStatus: status,
          generationMessage: message,
        },
      },
    });
  }

  private async persistTerminalFailure(
    tourId: string,
    metadata: any,
    reason: string,
    trace: Record<string, unknown>,
  ) {
    await this.prisma.tour.update({
      where: { id: tourId },
      data: {
        metadata: {
          ...metadata,
          generationStatus: 'failed',
          generationError: reason,
          generationFailedAt: new Date().toISOString(),
          dayTripTrace: redactTracePayload({
            version: 1,
            kind: 'origin_bound_open',
            status: 'failed',
            reason,
            ...trace,
          }),
        },
      },
    });
  }

  private traceCandidate(candidate: DayTripCandidateEvaluation) {
    return {
      experienceId: candidate.experience.id,
      name: candidate.experience.canonicalName ?? candidate.experience.name,
      preferenceScore: candidate.preferenceScore,
      exclusionMatches: candidate.exclusionMatches,
      score: candidate.score,
      outbound: candidate.outbound,
      returnTrip: candidate.returnTrip,
      feasibility: candidate.feasibility,
    };
  }

  private toScope(request: CreateDayTripDto): OriginBoundOpenDestinationScope {
    return {
      kind: 'origin_bound_open',
      origin: { ...request.origin },
      maxOutboundTravelMinutes: request.maxOutboundTravelMinutes,
      maxReturnTravelMinutes: request.maxReturnTravelMinutes,
      departureWindow: { ...request.departureWindow },
      returnWindow: { ...request.returnWindow },
      overnightPolicy: request.overnightPolicy,
      allowedTransportationModes: [...request.allowedTransportationModes],
    };
  }

  private validateRequest(request: CreateDayTripDto) {
    if (
      request.departureWindow.earliestMinutesFromMidnight >
      request.departureWindow.latestMinutesFromMidnight
    ) {
      throw new BadRequestException('departureWindow is inverted');
    }
    if (
      request.returnWindow.earliestMinutesFromMidnight >
      request.returnWindow.latestMinutesFromMidnight
    ) {
      throw new BadRequestException('returnWindow is inverted');
    }
    if (
      request.overnightPolicy === 'same_day_only' &&
      request.returnWindow.latestMinutesFromMidnight >= 24 * 60
    ) {
      throw new BadRequestException(
        'same_day_only returnWindow must end before midnight',
      );
    }
  }

  private dateAtMinutes(startDate: string, minutes: number): Date {
    const result = new Date(`${startDate}T00:00:00.000Z`);
    result.setUTCMinutes(minutes);
    return result;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
