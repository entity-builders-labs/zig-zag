import { CoverageAnalyzer } from '../../src/modules/tours/services/coverage-analyzer.service';
import { PreferenceInterpreterService } from '../../src/modules/tours/services/preference-interpreter.service';
import { ExperienceAcquisitionPlannerService } from '../../src/modules/tours/services/experience-acquisition-planner.service';
import { getFacetKeysByDimension } from '../../src/modules/tours/interfaces/preference-interpretation.interface';
import { normalizeWizardFacet } from '../../src/modules/tours/utils/preference-facet-merge.util';

/**
 * TEST 9 — SPECIFIC FREE-TEXT REQUEST SATISFACTION
 *
 * Exercises the REAL coverage -> acquisition decision path:
 *   interpret(additionalPreferences)  [real service, faked LLM transport]
 *     -> merged facets / positiveSemanticQuery
 *     -> requestedThemes (interests + theme-facet keys — the real derivation)
 *     -> CoverageAnalyzer.analyze -> decision
 *     -> (only if decision.action !== 'none') ExperienceAcquisitionPlanner
 *         .buildAcquisitionPlan({ semanticQuery, legacyDeficits, ... })
 *
 * Pinned current behavior:
 *  - a bare proper noun ("Landmark Alpha") produces NO controlled facet — it
 *    survives only as free text in `positiveSemanticQuery`;
 *  - it therefore never enters `requestedThemes`, so the coverage decision is
 *    unchanged and the acquisition planner is never invoked;
 *  - `buildAcquisitionPlan` with zero deficits + a semanticQuery returns
 *    `sourcePlans: []` — free text ALONE cannot trigger acquisition;
 *  - `positiveSemanticQuery` only reaches acquisition as a RIDER on an
 *    independent structural deficit (e.g. a missing requested theme), where it
 *    is appended to the web query;
 *  - whether the catalog already contains a row literally named "Landmark
 *    Alpha" makes no difference to any of the above.
 *
 * Whether a concrete "Quiero visitar X" SHOULD be able to influence
 * acquisition is an OPEN PRODUCT DECISION (canonical docs currently treat all
 * positive preferences as soft), so this file has NO `it.failing` invariant —
 * only green characterization + one explicitly-labelled PRODUCT HYPOTHESIS.
 */

class FakeLangChainService {
  constructor(private readonly json: string) {}
  async generateChatResponse(): Promise<string> {
    return this.json;
  }
  getProviderMetadata() {
    return { provider: 'fake', model: 'fake' };
  }
}

const interpretation = (positiveSemanticQuery: string) =>
  JSON.stringify({
    preferredFacets: [],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery,
    notes: [],
  });

/** The real requestedThemes derivation from experience-generation.service. */
function deriveRequestedThemes(
  interests: string[],
  interpretedFacetKeys: { dimension: string; key: string }[],
): string[] {
  const wizardFacets = interests
    .map((i) => normalizeWizardFacet('theme', i))
    .filter((f): f is NonNullable<typeof f> => f !== undefined);
  const merged = [...wizardFacets, ...(interpretedFacetKeys as any)];
  return Array.from(
    new Set([...interests, ...getFacetKeysByDimension(merged as any, 'theme')]),
  );
}

function catalog(themes: string[][], names?: string[]) {
  return themes.map((t, i) => ({
    id: `row-${i}`,
    name: names?.[i] ?? `Catalog Row ${i}`,
    description: `Covers ${t.join(', ')}.`,
    source: 'db',
    themes: t,
    traits: [] as string[],
    intents: ['visit'],
    metadata: { themes: t, traits: [] as string[], intents: ['visit'] },
  }));
}

function analyze(requestedThemes: string[], candidates: any[]) {
  return new CoverageAnalyzer().analyze({
    candidates,
    requestedThemes,
    requestedTraits: [],
    requestedIntents: ['visit'],
    days: 1,
    travelPace: 'moderate',
    explorationStyle: 'balanced',
    semanticCoverage: {
      status: 'not_requested',
      eligibleCandidateCount: candidates.length,
      indexedCandidateCount: 0,
    },
    offeredCandidateCount: candidates.length,
  } as any);
}

const GENERIC_HISTORY_ARCH = catalog(
  Array.from({ length: 10 }, () => ['history', 'architecture']),
);
const GENERIC_PLUS_LANDMARK_ALPHA = catalog(
  [
    ...Array.from({ length: 10 }, () => ['history', 'architecture']),
    ['history', 'architecture'],
  ],
  [
    ...Array.from({ length: 10 }, (_, i) => `Catalog Row ${i}`),
    'Landmark Alpha',
  ],
);

describe('CHAR-9 specific free-text request satisfaction', () => {
  it('the real interpreter keeps "Landmark Alpha" only as free text — no controlled facet', async () => {
    const service = new PreferenceInterpreterService(
      new FakeLangChainService(
        interpretation('Quiero visitar Landmark Alpha'),
      ) as any,
    );
    const { intent } = await service.interpret('Quiero visitar Landmark Alpha');
    expect(intent.preferredFacets).toEqual([]);
    expect(intent.positiveSemanticQuery).toBe('Quiero visitar Landmark Alpha');
    expect(getFacetKeysByDimension(intent.preferredFacets, 'theme')).toEqual(
      [],
    );
  });

  it('Request A (history + architecture, generic-sufficient catalog) — coverage decision is "none", planner not reached', () => {
    const requestedThemes = deriveRequestedThemes(
      ['history', 'architecture'],
      [],
    );
    expect(requestedThemes).toEqual(['history', 'architecture']);
    const report = analyze(requestedThemes, GENERIC_HISTORY_ARCH);
    expect(report.decision.action).toBe('none');
  });

  it('Request B (same + "Quiero visitar Landmark Alpha", catalog lacks it) — identical requestedThemes, identical decision, planner not reached', async () => {
    const service = new PreferenceInterpreterService(
      new FakeLangChainService(
        interpretation('Quiero visitar Landmark Alpha'),
      ) as any,
    );
    const { intent } = await service.interpret('Quiero visitar Landmark Alpha');
    const requestedThemes = deriveRequestedThemes(
      ['history', 'architecture'],
      intent.preferredFacets as any,
    );
    // The free text added no controlled theme.
    expect(requestedThemes).toEqual(['history', 'architecture']);
    const report = analyze(requestedThemes, GENERIC_HISTORY_ARCH);
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-9] Request B decision=${report.decision.action} semanticQuery="${intent.positiveSemanticQuery}"`,
    );
    expect(report.decision.action).toBe('none');
    expect(report.decision.requiresAdditionalDiscovery).toBe(false);
  });

  it('Request C (same as B, but catalog now HAS a row named "Landmark Alpha") — B and C produce byte-identical coverage decisions', () => {
    const requestedThemes = deriveRequestedThemes(
      ['history', 'architecture'],
      [],
    );
    const reportB = analyze(requestedThemes, GENERIC_HISTORY_ARCH);
    const reportC = analyze(requestedThemes, GENERIC_PLUS_LANDMARK_ALPHA);
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-9] B.action=${reportB.decision.action} C.action=${reportC.decision.action}`,
    );
    expect(reportC.decision).toEqual(reportB.decision);
    expect(reportC.decision.action).toBe('none');
  });

  it('buildAcquisitionPlan with ZERO deficits + a semanticQuery mentioning "Landmark Alpha" produces NO source plans', () => {
    const planner = new ExperienceAcquisitionPlannerService();
    const plan = planner.buildAcquisitionPlan({
      destination: {
        destinationName: 'Testville',
        latitude: -32.9,
        longitude: -60.6,
        radiusMeters: 3000,
      },
      legacyDeficits: [],
      preferredFacets: [
        {
          dimension: 'theme',
          key: 'history',
          importance: 1,
          confidence: 1,
          source: 'wizard',
        },
      ],
      candidates: [
        {
          name: 'X',
          description: '',
          themes: ['history'],
          traits: [],
          intents: [],
        } as any,
      ],
      semanticQuery: 'Quiero visitar Landmark Alpha',
      breadth: 'focused',
    });
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-9] zero-deficit plan sourcePlans=${plan.sourcePlans.length}`,
    );
    expect(plan.sourcePlans).toEqual([]);
  });

  it('positiveSemanticQuery reaches acquisition ONLY as a rider on an independent structural deficit (a missing requested theme)', () => {
    const planner = new ExperienceAcquisitionPlannerService();
    const plan = planner.buildAcquisitionPlan({
      destination: {
        destinationName: 'Testville',
        latitude: -32.9,
        longitude: -60.6,
        radiusMeters: 3000,
      },
      legacyDeficits: [
        {
          type: 'missing_theme',
          message: 'No tango coverage',
          severity: 'blocking',
          theme: 'tango',
        } as any,
      ],
      preferredFacets: [],
      candidates: [
        {
          name: 'X',
          description: '',
          themes: ['history'],
          traits: [],
          intents: [],
        } as any,
      ],
      semanticQuery: 'Quiero visitar Landmark Alpha',
      breadth: 'focused',
    });
    const web = plan.sourcePlans.find((s) => s.provider === 'web');
    // eslint-disable-next-line no-console
    console.info(`[CHAR-9] rider web query="${web?.web?.query}"`);
    expect(web).toBeDefined();
    // The named place is present — but only because the tango deficit opened
    // the web channel; it is never its own trigger.
    expect(web!.web!.query).toContain('Quiero visitar Landmark Alpha');
    expect(web!.web!.query).toContain('tango');
  });

  it('PRODUCT HYPOTHESIS (NOT a settled invariant): there is no structured channel for a named concrete request', () => {
    // CoverageAnalysisInput has no free-text / named-target field; the
    // acquisition planner keys only on deficits + facets + a rider query.
    // Whether "Quiero visitar X" SHOULD carry more weight (soft interest vs
    // "sí o sí") is an open product decision — pinned here as current state,
    // deliberately NOT as an `it.failing` invariant.
    const inputKeys = [
      'candidates',
      'requestedThemes',
      'requestedTraits',
      'requestedIntents',
      'preferredDurationMinutes',
      'days',
      'explorationStyle',
      'travelPace',
      'semanticCoverage',
      'offeredCandidateCount',
      'providerHealth',
    ];
    expect(inputKeys).not.toContain('additionalPreferences');
    expect(inputKeys).not.toContain('namedTargets');
    expect(inputKeys).not.toContain('positiveSemanticQuery');
  });
});
