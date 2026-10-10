/**
 * Cutover M3 — AcquisitionStrategySelector + AreaRouteWalkAcquisitionService
 * reachability from the live preference-first orchestrator.
 *
 * See docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md §5
 * Q5/Q10. `acquisition-strategy-selector.util.spec.ts` exhaustively proves
 * the pure selection logic (including reference-identity of the passed-
 * through deficit); these tests prove the LIVE orchestrator actually wires
 * that selector to `AreaRouteWalkAcquisitionService`, and only for the
 * facets/anchors the design specifies -- never as a special "if anchors"
 * branch, never duplicating deficit computation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TourGenerationHarness } from './support/harness';
import { seedTour, seedVerifiedExperience } from '../support/seed';
import { AreaRouteWalkAcquisitionService } from 'src/modules/tours/services/area-route-walk-acquisition.service';
import { ExperienceAcquisitionPlannerService } from 'src/modules/tours/services/experience-acquisition-planner.service';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from 'src/modules/tours/services/experience-classification.service';

const DEST = { latitude: -34.6212, longitude: -58.373 };

// Stage 3 cutover: AREA/ROUTE anchors must be destination-compatible, and
// compatibility is UNKNOWN (fail closed) for a point-scale destination. These
// scenarios therefore use the realistic area-scale Buenos Aires destination
// whose admin boundary contains San Telmo and La Boca.
const BUENOS_AIRES_AREA_DESTINATION = {
  scale: 'area',
  countryCode: 'AR',
  boundary: {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation',
    osmId: 1224652,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.53, -34.71],
          [-58.33, -34.71],
          [-58.33, -34.53],
          [-58.53, -34.53],
          [-58.53, -34.71],
        ],
      ],
    },
    tags: { boundary: 'administrative', admin_level: '8' },
  },
} as any;

function interpreterResponse(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    preferredFacets: [],
    anchoredPlaces: [],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: '',
    notes: [],
    ...overrides,
  });
}

describe('tour-generation integration · acquisition strategy routing (M3)', () => {
  let harness: TourGenerationHarness;

  beforeAll(async () => {
    harness = await TourGenerationHarness.create();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
  });

  it('1. routes an AREA anchor + intent:walk deficit to AreaRouteWalkAcquisitionService', async () => {
    harness.fakes.langChain.generateChatResponse.mockResolvedValueOnce(
      interpreterResponse({
        preferredFacets: [
          {
            dimension: 'intent',
            key: 'walk',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['caminata'],
          },
        ],
        anchoredPlaces: [
          { rawName: 'San Telmo', usage: 'geographic_scope', priority: 'must' },
        ],
        positiveSemanticQuery: 'walking tour in san telmo',
      }),
    );

    const areaRouteWalk = harness.app.get(AreaRouteWalkAcquisitionService);
    const acquireSpy = jest
      .spyOn(areaRouteWalk, 'acquireOrReuse')
      .mockResolvedValue({ outcome: 'no_result' });
    const plannerSpy = jest.spyOn(
      harness.app.get(ExperienceAcquisitionPlannerService),
      'buildAcquisitionPlan',
    );
    harness.fakes.nominatim.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1,
        addresstype: 'suburb',
        placeRank: 20,
        class: 'place',
        type: 'suburb',
        displayName: 'San Telmo, Buenos Aires, Argentina',
        importance: 0.5,
        latitude: DEST.latitude,
        longitude: DEST.longitude,
      },
    ]);
    harness.configure({ destination: BUENOS_AIRES_AREA_DESTINATION });
    harness.fakes.osm.configure({
      boundary: {
        id: 'osm:relation:1',
        name: 'San Telmo',
        osmType: 'relation',
        osmId: 1,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [DEST.longitude - 0.01, DEST.latitude - 0.01],
              [DEST.longitude + 0.01, DEST.latitude - 0.01],
              [DEST.longitude + 0.01, DEST.latitude + 0.01],
              [DEST.longitude - 0.01, DEST.latitude + 0.01],
              [DEST.longitude - 0.01, DEST.latitude - 0.01],
            ],
          ],
        },
        tags: { boundary: 'administrative' },
      },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'San Telmo, Buenos Aires, Argentina',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: [],
      intents: [],
      additionalPreferences: 'caminata a pie por San Telmo',
    });

    await harness.generate(tourId);

    // Bounded acquisition retries every pass while coverage stays
    // insufficient (the mock always reports no_result) -- called at least
    // once is what proves reachability; every call's shape is identical.
    expect(acquireSpy).toHaveBeenCalled();
    const call = acquireSpy.mock.calls[0][0];
    expect(call.anchor).toEqual(
      expect.objectContaining({
        status: 'resolved',
        rawName: 'San Telmo',
        usage: 'geographic_scope',
        kind: 'area',
        canonicalName: 'San Telmo',
        priority: 'must',
      }),
    );
    expect(call.deficit.key).toBe('walk');
    // 5. The original canonical deficit is passed through untouched -- the
    // exact production message format `computePreferenceCoverage` builds,
    // never a reconstructed/placeholder deficit.
    expect(call.deficit).toEqual({
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'walk',
      reason: 'Preference facet [intent:walk] has no strong catalog match yet.',
    });

    // The generic path never receives this same deficit -- no dual
    // ownership of the same requirement.
    for (const plannerCall of plannerSpy.mock.calls) {
      const deficits = plannerCall[0].deficits ?? [];
      expect(
        deficits.some(
          (d: any) => d.origin === 'preference_facet' && d.key === 'walk',
        ),
      ).toBe(false);
    }
  });

  it('2. routes a ROUTE anchor + intent:route_like deficit to AreaRouteWalkAcquisitionService', async () => {
    harness.fakes.langChain.generateChatResponse.mockResolvedValueOnce(
      interpreterResponse({
        preferredFacets: [
          {
            dimension: 'intent',
            key: 'route_like',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['Caminito'],
          },
        ],
        anchoredPlaces: [
          { rawName: 'Caminito', usage: 'named_path', priority: 'must' },
        ],
        positiveSemanticQuery: 'Caminito walking route',
      }),
    );

    const areaRouteWalk = harness.app.get(AreaRouteWalkAcquisitionService);
    const acquireSpy = jest
      .spyOn(areaRouteWalk, 'acquireOrReuse')
      .mockResolvedValue({ outcome: 'no_result' });
    harness.configure({ destination: BUENOS_AIRES_AREA_DESTINATION });
    harness.fakes.osm.configure({
      streets: [
        {
          id: 'osm:way:1',
          name: 'Caminito',
          osmType: 'way',
          osmId: 1,
          geometry: {
            type: 'LineString',
            coordinates: [
              [DEST.longitude, DEST.latitude],
              [DEST.longitude + 0.001, DEST.latitude + 0.001],
            ],
          },
          tags: { highway: 'pedestrian' },
        },
      ],
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'La Boca, Buenos Aires, Argentina',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: [],
      intents: [],
      additionalPreferences: 'caminata por Caminito',
    });

    await harness.generate(tourId);

    expect(acquireSpy).toHaveBeenCalled();
    const call = acquireSpy.mock.calls[0][0];
    expect(call.anchor).toEqual(
      expect.objectContaining({
        status: 'resolved',
        rawName: 'Caminito',
        usage: 'named_path',
        kind: 'route',
        canonicalName: 'Caminito',
        priority: 'must',
      }),
    );
    expect(call.deficit.key).toBe('route_like');
    expect(call.deficit).toEqual({
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'route_like',
      reason:
        'Preference facet [intent:route_like] has no strong catalog match yet.',
    });
  });

  it('3. never calls AreaRouteWalkAcquisitionService for an unrelated/generic deficit (no anchors)', async () => {
    const areaRouteWalk = harness.app.get(AreaRouteWalkAcquisitionService);
    const acquireSpy = jest.spyOn(areaRouteWalk, 'acquireOrReuse');

    harness.configure({
      groundedSearch: { evidence: [] },
      discoveryExtractor: { candidates: [] },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'San Telmo, Buenos Aires, Argentina',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['food'],
      intents: [],
    });

    await harness.generate(tourId);

    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it('3b. walk + route_like + visit/history without an AREA/ROUTE anchor -> independent DEDICATED_INTENT walk and route_like work plus one generic unit (no global intent ambiguity)', async () => {
    harness.fakes.langChain.generateChatResponse.mockResolvedValueOnce(
      interpreterResponse({
        preferredFacets: [
          {
            dimension: 'intent',
            key: 'walk',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['caminar'],
          },
          {
            dimension: 'intent',
            key: 'route_like',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['ruta'],
          },
          {
            dimension: 'intent',
            key: 'visit',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['visitar'],
          },
          {
            dimension: 'theme',
            key: 'history',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['historia'],
          },
        ],
        positiveSemanticQuery: 'walks, scenic routes and historic visits',
      }),
    );
    harness.configure({
      groundedSearch: { evidence: [] },
      discoveryExtractor: { candidates: [] },
    });
    const acquireSpy = jest.spyOn(
      harness.app.get(AreaRouteWalkAcquisitionService),
      'acquireOrReuse',
    );
    const plannerSpy = jest.spyOn(
      harness.app.get(ExperienceAcquisitionPlannerService),
      'buildAcquisitionPlan',
    );

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'San Telmo, Buenos Aires, Argentina',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: [],
      intents: [],
      additionalPreferences:
        'caminar, una ruta escenica, visitar museos de historia',
    });

    await harness.generate(tourId);

    expect(acquireSpy).not.toHaveBeenCalled();
    const planDeficitKeys = plannerSpy.mock.calls.map((call) =>
      (call[0].deficits ?? [])
        .map((d: any) =>
          d.origin === 'preference_facet'
            ? `${d.dimension}:${d.key}`
            : d.origin,
        )
        .sort()
        .join(','),
    );
    // Each policy-bearing intent is acquired by its OWN plan...
    expect(planDeficitKeys).toContain('intent:walk');
    expect(planDeficitKeys).toContain('intent:route_like');
    // ...and never coalesced with any other deficit.
    for (const keys of planDeficitKeys) {
      if (keys.includes('intent:walk') || keys.includes('intent:route_like')) {
        expect(['intent:walk', 'intent:route_like']).toContain(keys);
      }
    }
    // The remaining (non-policy) open deficits form one generic unit.
    expect(planDeficitKeys.some((keys) => keys.includes('theme:history'))).toBe(
      true,
    );

    const tour = await harness.loadTour(tourId);
    const routing = harness
      .traceSteps(tour.trace)
      .find((step) => step.component === 'partitionDeficitsIntoWorkUnits');
    expect(
      routing.outputs.workUnits.map((unit: any) => [
        unit.kind,
        unit.geographicGrant.kind === 'NONE'
          ? 'NONE'
          : unit.geographicGrant.intent,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['DEDICATED_INTENT', 'walk'],
        ['DEDICATED_INTENT', 'route_like'],
        ['GENERIC', 'NONE'],
      ]),
    );
    const passes = harness
      .traceSteps(tour.trace)
      .filter((step) => step.name === 'acquisition.pass');
    for (const pass of passes) {
      const grant = pass.facts.geographicGrant;
      if (pass.facts.strategy === 'generic') {
        expect(grant).toEqual({ kind: 'NONE' });
      } else if (pass.facts.strategy === 'dedicated_intent') {
        expect(grant.kind).toBe('OWNED_INTENT');
        expect(pass.facts.requestedIntents).toEqual([grant.intent]);
      }
    }
  });

  it('4. a global_capacity deficit never routes through AreaRouteWalkAcquisitionService even with a relevant anchor present', async () => {
    // All requested facets satisfied by ONE strong match, but the global
    // eligible portfolio is still thin -- exactly the M2 global_capacity
    // scenario, this time with an (irrelevant-to-capacity) AREA anchor also
    // present on the request.
    await seedVerifiedExperience(harness.prisma, {
      canonicalName: 'Museo de San Telmo',
      themes: ['history'],
      intents: [],
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      qualityScore: 4.0,
    });

    harness.fakes.langChain.generateChatResponse.mockResolvedValueOnce(
      interpreterResponse({
        preferredFacets: [
          {
            dimension: 'theme',
            key: 'history',
            confidence: 0.9,
            strength: 'strong',
            evidence: ['history'],
          },
        ],
        anchoredPlaces: [
          { rawName: 'San Telmo', usage: 'geographic_scope', priority: 'soft' },
        ],
      }),
    );

    const areaRouteWalk = harness.app.get(AreaRouteWalkAcquisitionService);
    const acquireSpy = jest.spyOn(areaRouteWalk, 'acquireOrReuse');
    const plannerSpy = jest.spyOn(
      harness.app.get(ExperienceAcquisitionPlannerService),
      'buildAcquisitionPlan',
    );

    harness.configure({
      wikivoyage: { status: 'ok', title: 'San Telmo', entries: [] },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'San Telmo, Buenos Aires, Argentina',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: [],
      additionalPreferences: 'historia de San Telmo',
    });

    await harness.generate(tourId);

    expect(acquireSpy).not.toHaveBeenCalled();
    // The global_capacity deficit still reaches the GENERIC path, exactly
    // as it did before M3.
    const sawGlobalCapacity = plannerSpy.mock.calls.some((call) =>
      (call[0].deficits ?? []).some((d: any) => d.origin === 'global_capacity'),
    );
    expect(sawGlobalCapacity).toBe(true);
  });

  it('6. warm catalog reuse (real AreaRouteWalkAcquisitionService, mode C) reuses the canonical route', async () => {
    const anchorName = 'Ruta del Vino de Mendoza';

    // A real, already-classified tourism-route Experience -- multi-
    // component, real geography, quality above the floor, and a CURRENT,
    // valid classification satisfying canReuseClassification. Real
    // AreaRouteWalkAcquisitionService (not mocked) must find this via its
    // mode-C strict-name catalog lookup BEFORE any acquisition call.
    const routeExperienceId = await seedVerifiedExperience(harness.prisma, {
      canonicalName: anchorName,
      themes: [],
      intents: ['route_like'],
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      qualityScore: 4.5,
      extraComponents: [
        {
          name: 'Bodega A',
          latitude: DEST.latitude + 0.01,
          longitude: DEST.longitude + 0.01,
        },
      ],
    });
    await harness.prisma.experience.update({
      where: { id: routeExperienceId },
      data: {
        metadata: {
          source: 'seed',
          themes: [],
          traits: [],
          intents: ['route_like'],
          classification: {
            state: 'classified',
            promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
            modelId: 'groq/qwen',
            themes: [],
            intents: ['route_like'],
            traits: [],
            reasoningEvidence: [
              {
                facet: 'intent:route_like',
                evidenceKeys: ['wine-1'],
                reason: 'Real evidence describes a wine route.',
              },
            ],
          },
        } as any,
      },
    });

    // basePortfolioTarget(days=1, 'moderate') = 4 -- 3 filler rows + the
    // tourism-route Experience itself = 4 real, distinct eligible rows.
    for (let i = 0; i < 3; i++) {
      await seedVerifiedExperience(harness.prisma, {
        canonicalName: `Mendoza filler ${i}`,
        themes: [],
        intents: [],
        latitude: DEST.latitude + i * 0.002,
        longitude: DEST.longitude + i * 0.002,
        qualityScore: 4.0,
      });
    }

    harness.fakes.langChain.generateChatResponse.mockResolvedValueOnce(
      interpreterResponse({
        preferredFacets: [
          {
            dimension: 'intent',
            key: 'route_like',
            confidence: 0.95,
            strength: 'strong',
            evidence: ['route'],
          },
        ],
        anchoredPlaces: [
          { rawName: anchorName, usage: 'named_path', priority: 'must' },
        ],
      }),
    );

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Mendoza, Argentina',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 20000,
      days: 1,
      interests: [],
      intents: ['route_like'],
      additionalPreferences: 'recorrer la Ruta del Vino de Mendoza',
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    const tour = await harness.loadTour(tourId);
    expect(
      tour.tourExperiences.some(
        (item) => item.experienceId === routeExperienceId,
      ),
    ).toBe(true);
    const coverageSteps = harness
      .traceSteps(tour.trace)
      .filter((step: any) => step.stage === 'coverage_analysis');
    expect(coverageSteps[0].decision.outcome).toBe('none');
  });

  it('7. no legacy coverage symbols remain reachable (imported/instantiated) from the live orchestrator source', () => {
    // Strip full-line `//` comments first -- a comment may legitimately
    // mention a deleted symbol's NAME for historical narrative (e.g. "this
    // replaces what CoverageAnalyzer used to do"); this check is about
    // whether the symbol is actually imported/used as live code, not prose.
    const source = fs
      .readFileSync(
        path.join(
          __dirname,
          '../../../src/modules/tours/services/experience-generation.service.ts',
        ),
        'utf8',
      )
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    for (const banned of [
      'CoverageAnalyzer',
      'CoverageReport',
      'CoverageDeficit',
      'CoverageAcquisitionDecision',
      'legacyDeficits',
      'legacyDeficit',
      'buildCoverageAnalysisStep',
      'projectCoverageDeficits',
    ]) {
      expect(source).not.toContain(banned);
    }
  });
});
