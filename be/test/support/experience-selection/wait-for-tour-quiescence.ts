import { OutboxPublisherService } from '../../../src/modules/outbox/services/outbox-publisher.service';
import { PrismaService } from '../../../src/core/database/prisma.service';

const TERMINAL_GENERATION_STATUSES = new Set(['completed', 'failed']);

/**
 * Wait for the generation terminal boundary before a test resets shared DB
 * state. Generation writes `completed` before its completion/media events have
 * necessarily been published, so status alone is not a safe teardown signal.
 */
export async function waitForTourQuiescence(
  prisma: PrismaService,
  publisher: OutboxPublisherService,
  tourId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 6000; attempt++) {
    await publisher.processNextBatch();

    const tour = await prisma.tour.findUnique({
      where: { id: tourId },
      select: {
        metadata: true,
        experiences: { select: { experienceId: true } },
      },
    });
    if (!tour) throw new Error(`Tour ${tourId} disappeared while finalizing`);

    const metadata = (tour.metadata ?? {}) as { generationStatus?: string };
    const experienceIds = new Set(
      tour.experiences.map((experience) => experience.experienceId),
    );
    const events = await prisma.outboxEvent.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      select: { payload: true },
    });
    const relevantPending = events.some((event) => {
      const payload = event.payload as Record<string, unknown>;
      return (
        payload.tourId === tourId ||
        (typeof payload.experienceId === 'string' &&
          experienceIds.has(payload.experienceId))
      );
    });

    if (
      TERMINAL_GENERATION_STATUSES.has(metadata.generationStatus ?? '') &&
      !relevantPending
    ) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Tour ${tourId} did not reach a quiescent terminal boundary`);
}
