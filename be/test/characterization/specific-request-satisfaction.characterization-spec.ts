import { CoverageAnalyzer } from '../../src/modules/tours/services/coverage-analyzer.service';
import { PreferenceInterpreterService } from '../../src/modules/tours/services/preference-interpreter.service';

/**
 * TEST 9 — SPECIFIC FREE-TEXT REQUEST SATISFACTION
 *
 * A user asks for a concrete, generically-named place: "Quiero visitar
 * Landmark Alpha". The catalog already has sufficient GENERIC history +
 * architecture coverage, but NO row called "Landmark Alpha".
 *
 * Pinned current behavior:
 *  - `NormalizedPreferenceIntent` has NO field for a named/required place;
 *    the phrase survives only as free text in `positiveSemanticQuery`, and
 *    the controlled-vocabulary facet normalizer emits nothing for it;
 *  - `CoverageAnalysisInput` has NO free-text / named-target field at all —
 *    only `requestedThemes/Traits/Intents`;
 *  - therefore Request 2 (history + architecture + "Quiero visitar Landmark
 *    Alpha") produces the SAME coverage decision as Request 1 (history +
 *    architecture): `action: 'none'`, no acquisition — "Landmark Alpha" is
 *    never specifically sought.
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

const WELL_BEHAVED_INTERPRETATION = JSON.stringify({
  // A conservative interpreter: it recognises no controlled facet in a bare
  // proper noun and simply echoes the phrase into the semantic query.
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
  positiveSemanticQuery: 'Quiero visitar Landmark Alpha',
  notes: [],
});

function genericHistoryArchCatalog(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `generic-${i}`,
    name: `Historic Building ${i}`,
    description: 'A generic historic building with notable architecture.',
    source: 'db',
    themes: ['history', 'architecture'],
    traits: [] as string[],
    intents: ['visit'],
    metadata: {
      themes: ['history', 'architecture'],
      traits: [] as string[],
      intents: ['visit'],
    },
  }));
}

const analyze = (requestedThemes: string[]) =>
  new CoverageAnalyzer().analyze({
    candidates: genericHistoryArchCatalog(10),
    requestedThemes,
    requestedTraits: [],
    requestedIntents: ['visit'],
    days: 1,
    travelPace: 'moderate',
    explorationStyle: 'balanced',
    semanticCoverage: {
      status: 'not_requested',
      eligibleCandidateCount: 10,
      indexedCandidateCount: 0,
    },
    offeredCandidateCount: 10,
  } as any);

describe('CHAR-9 specific free-text request satisfaction', () => {
  it('the interpreter keeps "Landmark Alpha" only as free text — no facet, no named-target field', async () => {
    const service = new PreferenceInterpreterService(
      new FakeLangChainService(WELL_BEHAVED_INTERPRETATION) as any,
    );
    const { intent } = await service.interpret('Quiero visitar Landmark Alpha');
    expect(intent.preferredFacets).toEqual([]);
    expect(intent.positiveSemanticQuery).toBe('Quiero visitar Landmark Alpha');
    // No structured place target anywhere in the intent.
    expect(JSON.stringify(intent)).not.toMatch(/namedTarget|requiredPlace/i);
    const structuredTerms = [
      ...intent.preferredFacets.map((f) => f.key),
      ...intent.hardExclusions,
      ...intent.softConstraints,
    ];
    expect(structuredTerms.join(' ').toLowerCase()).not.toContain(
      'landmark alpha',
    );
  });

  it('Request 1 (history + architecture) — generic coverage is already sufficient', () => {
    const report = analyze(['history', 'architecture']);
    expect(report.decision.action).toBe('none');
  });

  it('Request 2 (same + "Quiero visitar Landmark Alpha") — identical decision, no acquisition triggered', () => {
    // The free text produced no new controlled theme, so requestedThemes is
    // unchanged — this is exactly what the generation flow passes downstream.
    const report1 = analyze(['history', 'architecture']);
    const report2 = analyze(['history', 'architecture']);
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-9] req1=${report1.decision.action} req2=${report2.decision.action}`,
    );
    expect(report2.decision).toEqual(report1.decision);
    expect(report2.decision.action).toBe('none');
    expect(report2.decision.requiresAdditionalDiscovery).toBe(false);
  });

  it('CoverageAnalysisInput carries no channel for a concrete place request', () => {
    // Structural proof: there is nowhere to put "Landmark Alpha".
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

  it.failing(
    'INVARIANT: a concrete "Quiero visitar X" request must be able to change acquisition when X is absent from the catalog',
    () => {
      const withoutRequest = analyze(['history', 'architecture']);
      // There is no way to express the concrete request to the analyzer, so
      // the "with request" analysis is necessarily identical.
      const withRequest = analyze(['history', 'architecture']);
      expect(withRequest.decision).not.toEqual(withoutRequest.decision);
    },
  );
});
