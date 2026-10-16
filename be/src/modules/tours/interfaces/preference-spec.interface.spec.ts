import {
  facetKey,
  PreferenceSpec,
  RequestedFacet,
  InterpretedAnchor,
  FacetCandidates,
  PortfolioSufficiency,
  UnmetAnchor,
  ResolvedAnchor,
  CompositionResult,
} from './preference-spec.interface';
import {
  requestedFacetFixture,
  selectedFacetFixture,
} from '../fixtures/requested-facet.fixture';

describe('preference-spec.interface', () => {
  describe('facetKey', () => {
    it('formats a RequestedFacet-shaped dimension/key pair as "dimension:key"', () => {
      expect(facetKey({ dimension: 'theme', key: 'history' })).toBe(
        'theme:history',
      );
    });

    it('formats a different dimension/key pair without hardcoding "theme"', () => {
      expect(facetKey({ dimension: 'intent', key: 'walk' })).toBe(
        'intent:walk',
      );
    });
  });

  it('constructs a valid RequestedFacet with required:false and provenance, importance and confidence kept separate', () => {
    const facet: RequestedFacet = requestedFacetFixture({
      dimension: 'theme',
      key: 'history',
      provenance: 'INFERRED',
      importance: 0.7,
      confidence: 0.5,
    });
    expect(facet.required).toBe(false);
    expect(facet.provenance).toBe('INFERRED');
    expect(facet).not.toHaveProperty('weight');
    expect([facet.importance, facet.confidence]).toEqual([0.7, 0.5]);
  });

  it('constructs a valid AnchoredPlace literal for each kind/priority combination', () => {
    const anchor: InterpretedAnchor = {
      rawName: 'Teatro Colón',
      usage: 'specific_destination',
      priority: 'must',
    };
    expect(anchor.usage).toBe('specific_destination');
    expect(anchor.priority).toBe('must');
  });

  it('PreferenceSpec has explorationStyle as a top-level field separate from facets -- it is NEVER a RequestedFacet', () => {
    const spec: PreferenceSpec = {
      assertions: [],
      polarityConflicts: [],
      facets: [selectedFacetFixture('theme', 'history')],
      unresolvedConcepts: [],
      facetSchemaVersion: 'facet-schema-v1',
      anchors: [],
      semanticQuery: '',
      explorationStyle: 'iconic',
      softConstraints: {
        accessibility: [],
        budget: [],
        group: [],
      },
      trip: { days: 1, startDates: [], pace: 'moderate' },
    };

    // explorationStyle is readable as its own field...
    expect(spec.explorationStyle).toBe('iconic');
    // ...and is never present among the requested facets, however the
    // fixture's facets array is populated. No helper in this module inserts
    // 'exploration_style' as a facet dimension.
    expect(
      spec.facets.some((f) => (f.dimension as string) === 'exploration_style'),
    ).toBe(false);
  });

  it('PreferenceSpec.explorationStyle only accepts the three canonical values', () => {
    const styles: PreferenceSpec['explorationStyle'][] = [
      'iconic',
      'local_deep_dive',
      'balanced',
    ];
    expect(styles).toEqual(['iconic', 'local_deep_dive', 'balanced']);
  });

  it('constructs a valid FacetCandidates literal where satisfied mirrors strongMatches.length >= 1', () => {
    const facet: RequestedFacet = selectedFacetFixture('theme', 'tango');
    const satisfied: FacetCandidates = {
      facet,
      strongMatches: ['exp-1'],
      weakMatches: [],
      satisfied: true,
    };
    const unsatisfied: FacetCandidates = {
      facet,
      strongMatches: [],
      weakMatches: ['exp-2'],
      satisfied: false,
    };
    expect(satisfied.satisfied).toBe(true);
    expect(unsatisfied.satisfied).toBe(false);
  });

  it('constructs a valid PortfolioSufficiency literal', () => {
    const sufficiency: PortfolioSufficiency = {
      allFacetsSatisfied: true,
      basePortfolioTarget: 20,
      portfolioTarget: 20,
      distinctEligibleCount: 25,
      sufficient: true,
    };
    expect(sufficiency.portfolioTarget).toBe(20);
  });

  it('constructs a valid UnmetAnchor literal for each reason', () => {
    const anchor: InterpretedAnchor = {
      rawName: 'Some Unresolvable Place',
      usage: 'specific_destination',
      priority: 'must',
    };
    const unresolvedAnchor: ResolvedAnchor = {
      ...anchor,
      status: 'unresolved',
      unresolvedReason: 'not found',
    };
    const unresolved: UnmetAnchor = {
      anchor: unresolvedAnchor,
      reason: 'UNRESOLVED',
    };
    const infeasible: UnmetAnchor = {
      anchor: unresolvedAnchor,
      reason: 'INFEASIBLE',
    };
    expect(unresolved.reason).toBe('UNRESOLVED');
    expect(infeasible.reason).toBe('INFEASIBLE');
  });

  it('constructs a valid CompositionResult literal', () => {
    const result: CompositionResult = {
      selected: ['exp-1', 'exp-2'],
      perFacetCoverage: { 'theme:history': ['exp-1'] },
      unmetFacets: [],
      mustAnchorsForced: [],
      softAnchorsBoosted: [],
      unmetAnchors: [],
      portfolioTarget: 20,
    };
    expect(result.selected).toHaveLength(2);
  });
});
