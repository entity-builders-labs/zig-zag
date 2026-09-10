import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { ExperienceGeographicValidationResult } from '../interfaces/experience-resolution.interface';
import {
  ExperienceProposalResolverService,
  RESOLVER_CANDIDATE_CONCURRENCY,
} from './experience-proposal-resolver.service';

/**
 * Regression: a cold-start city (empty catalog → many acquisition deficits →
 * dozens of structured + web candidates in ONE resolve() call) used to fan out
 * one interactive `prisma.$transaction` per accepted candidate with an
 * unbounded `Promise.all`. The pg pool has a small fixed size, so the batch
 * exhausted it and the surplus transactions failed with
 * "Unable to start a transaction in the given time." (Buenos Aires,
 * 13 deficits, 4 providers.)
 *
 * `resolve()` must now cap how many candidates it resolves/persists
 * concurrently, while keeping deterministic output order and the same
 * all-or-nothing failure semantics.
 */

const boundary: any = {
  id: 'osm:relation:1',
  name: 'Buenos Aires',
  osmType: 'relation',
  osmId: 1,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-58.55, -34.7],
        [-58.3, -34.7],
        [-58.3, -34.45],
        [-58.55, -34.45],
        [-58.55, -34.7],
      ],
    ],
  },
  tags: { boundary: 'administrative' },
};

const pad = (index: number) => String(index).padStart(3, '0');

const candidateAt = (index: number): ExperienceCandidate => ({
  name: `Experience ${pad(index)}`,
  themes: ['culture'],
  traits: [],
  intents: ['visit'],
  componentHints: [
    {
      key: `place-${pad(index)}`,
      name: `Venue ${pad(index)}`,
      role: 'venue',
      expectedKind: 'PLACE',
      required: true,
      evidenceKeys: ['ev-1'],
    },
  ],
  evidenceKeys: ['ev-1'],
  shortReason: 'Evidence-backed experience',
});

const acceptedValidation = (
  proposalName: string,
): ExperienceGeographicValidationResult => ({
  proposalName,
  kind: 'EXPERIENCE',
  status: 'GEO_VERIFIED',
  accepted: true,
  strategy: 'venue_centric',
  anchors: [],
  groundedEvidenceKeys: ['ev-1'],
  rejectionReasons: [],
  validatorVersion: 2,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A jest.fn() whose async body tracks how many calls overlap in time. */
function trackingFn(delayMs = 8) {
  const state = { active: 0, peak: 0, calls: 0 };
  const fn = jest.fn(async (arg?: any) => {
    state.calls += 1;
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    try {
      await wait(delayMs);
      return {
        id: `exp-${arg?.canonicalName ?? arg?.name ?? state.calls}`,
        dedupeDecision: 'NEW' as const,
      };
    } finally {
      state.active -= 1;
    }
  });
  return { fn, state };
}

function buildService(overrides?: { persist?: jest.Mock; upsert?: jest.Mock }) {
  const poiPool = Array.from({ length: 40 }, (_, index) => ({
    id: `osm:node:${index}`,
    name: `Venue ${pad(index)}`,
    osmType: 'node',
    osmId: index,
    geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
    tags: { tourism: 'attraction' },
  }));
  const osmPlaces = {
    lookupStreetsWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: poiPool }),
    lookupStreetsNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: poiPool }),
  };
  const catalog = {
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    upsertGeoEntity:
      overrides?.upsert ??
      jest.fn(async (input: any) => ({ id: `geo-${input.externalId}` })),
    persistVerifiedExperience:
      overrides?.persist ??
      jest.fn(async (input: any) => ({
        id: `exp-${input.canonicalName}`,
        dedupeDecision: 'NEW' as const,
      })),
  };
  const geographicValidator = {
    validate: jest.fn((item: any) => acceptedValidation(item.candidate.name)),
  };
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    geographicValidator as any,
  );
  return { service, osmPlaces, catalog, geographicValidator };
}

describe('ExperienceProposalResolverService — bounded candidate concurrency', () => {
  const BATCH = 25;

  it('exposes a conservative concurrency limit well under a typical DB pool', () => {
    expect(RESOLVER_CANDIDATE_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(RESOLVER_CANDIDATE_CONCURRENCY).toBeLessThanOrEqual(6);
  });

  it('never persists more than the configured number of candidates at once, for a batch far larger than the limit', async () => {
    const persist = trackingFn();
    const upsert = trackingFn();
    const { service } = buildService({
      persist: persist.fn,
      upsert: upsert.fn,
    });

    const candidates = Array.from({ length: BATCH }, (_, i) => candidateAt(i));
    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      destinationBoundary: boundary,
      candidates,
    });

    // Peak overlap of the two candidate-level fan-outs stays bounded.
    expect(persist.state.peak).toBeGreaterThan(1); // still concurrent, just capped
    expect(persist.state.peak).toBeLessThanOrEqual(
      RESOLVER_CANDIDATE_CONCURRENCY,
    );
    expect(upsert.state.peak).toBeLessThanOrEqual(
      RESOLVER_CANDIDATE_CONCURRENCY,
    );

    // Every candidate was processed exactly once.
    expect(persist.state.calls).toBe(BATCH);
    expect(result.resolved).toHaveLength(BATCH);
    expect(result.acceptedCount).toBe(BATCH);
  });

  it('preserves deterministic output order even when tasks finish out of order', async () => {
    // Later candidates resolve faster than earlier ones.
    const persist = jest.fn(async (input: any) => {
      const index = Number(input.canonicalName.split(' ')[1]);
      await wait((BATCH - index) * 2);
      return {
        id: `exp-${input.canonicalName}`,
        dedupeDecision: 'NEW' as const,
      };
    });
    const { service } = buildService({ persist });

    const candidates = Array.from({ length: BATCH }, (_, i) => candidateAt(i));
    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      destinationBoundary: boundary,
      candidates,
    });

    expect(result.resolved.map((r: any) => r.candidate.name)).toEqual(
      candidates.map((c) => c.name),
    );
    expect(result.resolved.map((r: any) => r.experienceId)).toEqual(
      candidates.map((c) => `exp-${c.name}`),
    );
  });

  it('keeps all-or-nothing failure semantics: one persist rejection fails resolve()', async () => {
    const persist = jest.fn(async (input: any) => {
      if (input.canonicalName === 'Experience 007') {
        throw new Error('persist boom');
      }
      await wait(4);
      return {
        id: `exp-${input.canonicalName}`,
        dedupeDecision: 'NEW' as const,
      };
    });
    const { service } = buildService({ persist });

    const candidates = Array.from({ length: BATCH }, (_, i) => candidateAt(i));
    await expect(
      service.resolve({
        destinationName: 'Buenos Aires',
        destinationBoundary: boundary,
        candidates,
      }),
    ).rejects.toThrow('persist boom');
  });
});
