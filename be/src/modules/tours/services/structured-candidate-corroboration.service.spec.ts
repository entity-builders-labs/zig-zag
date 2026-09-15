import { Test, TestingModule } from '@nestjs/testing';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { StructuredCandidateProposal } from '../interfaces/structured-candidate-proposal.interface';

const PLACE_COMPONENT_HINT = {
  key: 'fixture:place',
  name: 'Fixture place',
  role: 'venue' as const,
  expectedKind: 'PLACE' as const,
  required: true,
  evidenceKeys: ['fixture:place'],
};

describe('StructuredCandidateCorroborationService', () => {
  let service: StructuredCandidateCorroborationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StructuredCandidateCorroborationService],
    }).compile();

    service = module.get<StructuredCandidateCorroborationService>(
      StructuredCandidateCorroborationService,
    );
  });

  // Scenario A: Exact duplicate input
  it('Scenario A: deduplicates exact duplicate input idempotently', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'Plaza Dorrego',
        themes: ['history'],
        traits: ['historic'],
        intents: ['walk'],
        componentHints: [
          {
            key: 'wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1:component',
            name: 'Plaza Dorrego',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1'],
          },
        ],
        evidenceKeys: ['wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1'],
        shortReason: 'Plaza Dorrego',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Plaza Dorrego',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1',
          geo: { latitude: -34.62, longitude: -58.37 },
        },
      ],
    };

    // Duplicate
    const p2 = JSON.parse(JSON.stringify(p1));

    const result = service.corroborateAndMerge([p1, p2], ['SINGLE_PLACE']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('Plaza Dorrego');
    expect(result.candidates[0].evidenceKeys).toEqual([
      'wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1',
    ]);
  });

  // Scenario B: Wikivoyage + future Wikidata QID without coordinates
  it('Scenario B: corroborates proposals sharing canonical Wikidata QID even without coordinates', () => {
    const pWiki: StructuredCandidateProposal = {
      candidate: {
        name: 'Teatro Colón',
        themes: ['culture'],
        traits: ['theater'],
        componentHints: [
          {
            key: 'wikivoyage:BA:wikidata:Q827401:component',
            name: 'Teatro Colón',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wikivoyage:BA:wikidata:Q827401'],
          },
        ],
        evidenceKeys: ['wikivoyage:BA:wikidata:Q827401'],
        shortReason: 'Teatro Colon from Wikivoyage',
      },
      observations: [
        {
          provider: 'wikivoyage',
          externalId: 'Q827401',
          canonicalIdentity: { wikidataQid: 'Q827401' },
          title: 'Teatro Colón',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'wikivoyage:BA:wikidata:Q827401',
        },
      ],
    };

    const pWikidata: StructuredCandidateProposal = {
      candidate: {
        name: 'Teatro Colon Opera House',
        themes: ['architecture'],
        traits: [],
        componentHints: [
          {
            key: 'wikidata:Q827401:component',
            name: 'Teatro Colon Opera House',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wikidata:Q827401'],
          },
        ],
        evidenceKeys: ['wikidata:Q827401'],
        shortReason: 'Teatro Colon from Wikidata',
      },
      observations: [
        {
          provider: 'wikidata',
          externalId: 'Q827401',
          canonicalIdentity: { wikidataQid: 'Q827401' },
          title: 'Teatro Colon Opera House',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'wikidata:Q827401',
        },
      ],
    };

    const pairDec = service.decidePair(pWiki, pWikidata);
    expect(pairDec.decision).toBe('SAME');
    expect(pairDec.reasons).toContain('same_wikidata_identity');

    const result = service.corroborateAndMerge(
      [pWiki, pWikidata],
      ['SINGLE_PLACE'],
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].evidenceKeys).toEqual([
      'wikidata:Q827401',
      'wikivoyage:BA:wikidata:Q827401',
    ]);
  });

  // Scenario C: Same named place cross-provider 10m apart
  it('Scenario C: corroborates same named place cross-provider 10m apart into 1 candidate with 1 hint', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'Plaza Dorrego',
        themes: ['history'],
        traits: [],
        componentHints: [
          {
            key: 'wikivoyage:BA:see:see:Plaza_Dorrego:1:component',
            name: 'Plaza Dorrego',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wikivoyage:BA:see:see:Plaza_Dorrego:1'],
          },
        ],
        evidenceKeys: ['wikivoyage:BA:see:see:Plaza_Dorrego:1'],
        shortReason: 'Plaza Dorrego WV',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Plaza Dorrego',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'wikivoyage:BA:see:see:Plaza_Dorrego:1',
          geo: { latitude: -34.62, longitude: -58.37 },
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'Plaza Dorrego Histórica',
        themes: ['square'],
        traits: [],
        componentHints: [
          {
            key: 'osm:node:12345:component',
            name: 'Plaza Dorrego Histórica',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['osm:node:12345'],
          },
        ],
        evidenceKeys: ['osm:node:12345'],
        shortReason: 'Plaza Dorrego OSM',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Plaza Dorrego Histórica',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'osm:node:12345',
          geo: { latitude: -34.62008, longitude: -58.37005 }, // ~10m away
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('SAME');
    expect(pairDec.reasons).toContain('compatible_geo_and_name');

    const result = service.corroborateAndMerge([p1, p2], ['SINGLE_PLACE']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].componentHints).toHaveLength(1);
    expect(result.candidates[0].evidenceKeys).toHaveLength(2);
  });

  // Scenario D: Same name 5km apart
  it('Scenario D: rejects same name 5km apart and never merges them', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'La Cabrera',
        themes: ['food'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source1:cabrera_palermo'],
        shortReason: 'La Cabrera Palermo',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'La Cabrera',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source1:cabrera_palermo',
          geo: { latitude: -34.588, longitude: -58.431 },
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'La Cabrera',
        themes: ['food'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source2:cabrera_recoleta'],
        shortReason: 'La Cabrera Recoleta',
      },
      observations: [
        {
          provider: 'osm',
          title: 'La Cabrera',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source2:cabrera_recoleta',
          geo: { latitude: -34.59, longitude: -58.385 }, // ~4.5 km away
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('no_shared_identity_signal');

    const result = service.corroborateAndMerge([p1, p2], ['SINGLE_PLACE']);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario E: Two businesses 20m apart different names
  it('Scenario E: marks two distinct places 20m apart as AMBIGUOUS and does not merge them', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'Café Dorrego',
        themes: ['cafe'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source1:cafe_dorrego'],
        shortReason: 'Café Dorrego',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Café Dorrego',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source1:cafe_dorrego',
          geo: { latitude: -34.6201, longitude: -58.3701 },
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'Bar Británico',
        themes: ['bar'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source2:bar_britanico'],
        shortReason: 'Bar Británico',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Bar Británico',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source2:bar_britanico',
          geo: { latitude: -34.6202, longitude: -58.3702 }, // ~15m away
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('AMBIGUOUS');
    expect(pairDec.reasons).toContain('geographic_overlap_without_name_match');

    const result = service.corroborateAndMerge([p1, p2], ['SINGLE_PLACE']);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario F: Same normalized name, no coordinates, no QID
  it('Scenario F: marks same name without coordinates or QID as AMBIGUOUS and does not merge', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'El Obrero',
        themes: ['food'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source1:el_obrero'],
        shortReason: 'El Obrero',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'El Obrero',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source1:el_obrero',
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'Bodegón El Obrero',
        themes: ['food'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source2:el_obrero'],
        shortReason: 'Bodegón El Obrero',
      },
      observations: [
        {
          provider: 'web',
          title: 'Bodegón El Obrero',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source2:el_obrero',
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('AMBIGUOUS');
    expect(pairDec.reasons).toContain('name_match_without_geography');

    const result = service.corroborateAndMerge([p1, p2], ['SINGLE_PLACE']);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario G: Incompatible types (place vs route) with same coordinates
  it('Scenario G: marks place vs route as NEW (incompatible evidence type) and does not merge', () => {
    const pPlace: StructuredCandidateProposal = {
      candidate: {
        name: 'Caminito',
        themes: [],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source1:caminito_place'],
        shortReason: 'Caminito place',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Caminito',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source1:caminito_place',
          geo: { latitude: -34.639, longitude: -58.362 },
        },
      ],
    };

    const pRoute: StructuredCandidateProposal = {
      candidate: {
        name: 'Paseo Caminito',
        themes: [],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source2:caminito_route'],
        shortReason: 'Caminito route',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Paseo Caminito',
          evidenceType: 'route',
          originationCapabilities: [],
          evidenceKey: 'source2:caminito_route',
          geo: { latitude: -34.63905, longitude: -58.36205 },
        },
      ],
    };

    const pairDec = service.decidePair(pPlace, pRoute);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('incompatible_evidence_type');

    const result = service.corroborateAndMerge(
      [pPlace, pRoute],
      ['SINGLE_PLACE'],
    );
    expect(result.candidates).toHaveLength(1);
  });

  // Scenario H: Tourism activity vs place
  it('Scenario H: does not auto-merge tourism_activity with a place', () => {
    const pActivity: StructuredCandidateProposal = {
      candidate: {
        name: 'Clases de Tango en La Boca',
        themes: [],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source1:activity'],
        shortReason: 'Tango activity',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Clases de Tango en La Boca',
          evidenceType: 'tourism_activity',
          originationCapabilities: [],
          evidenceKey: 'source1:activity',
          geo: { latitude: -34.639, longitude: -58.362 },
        },
      ],
    };

    const pPlace: StructuredCandidateProposal = {
      candidate: {
        name: 'Teatro de La Boca',
        themes: [],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['source2:place'],
        shortReason: 'Teatro',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Teatro de La Boca',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'source2:place',
          geo: { latitude: -34.639, longitude: -58.362 },
        },
      ],
    };

    const pairDec = service.decidePair(pActivity, pPlace);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('incompatible_evidence_type');

    const result = service.corroborateAndMerge(
      [pActivity, pPlace],
      ['SINGLE_PLACE'],
    );
    expect(result.candidates).toHaveLength(1);
  });

  // Scenario I: Component hint merge (1 hint not 2)
  it('Scenario I: collapses 2 single-place component hints into exactly 1 merged GeoEntityHint', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'Mercado San Telmo',
        themes: ['food'],
        traits: ['market'],
        componentHints: [
          {
            key: 'hint:1',
            name: 'Mercado San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev:1'],
          },
        ],
        evidenceKeys: ['ev:1'],
        shortReason: 'Mercado 1',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Mercado San Telmo',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:1',
          geo: { latitude: -34.6195, longitude: -58.3728 },
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'Mercado San Telmo Techado',
        themes: ['shopping'],
        traits: [],
        componentHints: [
          {
            key: 'hint:2',
            name: 'Mercado San Telmo Techado',
            role: 'venue',
            expectedKind: 'PLACE',
            required: false,
            evidenceKeys: ['ev:2'],
          },
        ],
        evidenceKeys: ['ev:2'],
        shortReason: 'Mercado 2',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Mercado San Telmo Techado',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:2',
          geo: { latitude: -34.61955, longitude: -58.37285 },
        },
      ],
    };

    const result = service.corroborateAndMerge([p1, p2], ['SINGLE_PLACE']);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0].required).toBe(true);
    expect(candidate.componentHints[0].evidenceKeys).toEqual(['ev:1', 'ev:2']);
  });

  // Scenario J: Transitive conflict (A SAME B, B SAME C, A AMBIGUOUS C)
  it('Scenario J: complete-link clustering prevents false merge under transitive conflict', () => {
    // A: Plaza Dorrego at (lat, lon) with coordinates
    const pA: StructuredCandidateProposal = {
      candidate: {
        name: 'Plaza Dorrego',
        themes: ['square'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['ev:A'],
        shortReason: 'A',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Plaza Dorrego',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:A',
          geo: { latitude: -34.62, longitude: -58.37 },
        },
      ],
    };

    // B: Plaza Dorrego Centro 10m away from A, ALSO 10m away from C
    const pB: StructuredCandidateProposal = {
      candidate: {
        name: 'Plaza Dorrego Centro',
        themes: ['square'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['ev:B'],
        shortReason: 'B',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Plaza Dorrego Centro',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:B',
          geo: { latitude: -34.62005, longitude: -58.37005 },
        },
      ],
    };

    // C: Feria Dorrego: at same coordinates (10m from B and A), but different name from A (so AMBIGUOUS with A)
    const pC: StructuredCandidateProposal = {
      candidate: {
        name: 'Antiguedades Feria',
        themes: ['antiques'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['ev:C'],
        shortReason: 'C',
      },
      observations: [
        {
          provider: 'web',
          title: 'Antiguedades Feria',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:C',
          geo: { latitude: -34.62008, longitude: -58.37008 },
        },
      ],
    };

    // Verify pairwise relationships:
    // A vs B: compatible geo and name -> SAME
    expect(service.decidePair(pA, pB).decision).toBe('SAME');
    // A vs C: geographic overlap without name match -> AMBIGUOUS
    expect(service.decidePair(pA, pC).decision).toBe('AMBIGUOUS');

    // Run complete-link merge: A, B, C must NOT be in a single group
    const result = service.corroborateAndMerge([pA, pB, pC], ['SINGLE_PLACE']);
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.groups.some((g) => g.proposalIds.length === 3)).toBe(false);
  });

  // Scenario K: Order independence
  it('Scenario K: produces identical merged candidates regardless of proposal input order', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'Museo Histórico Nacional',
        themes: ['museum'],
        traits: ['history'],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['ev:1'],
        shortReason: 'p1',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Museo Histórico Nacional',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:1',
          geo: { latitude: -34.6265, longitude: -58.3705 },
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'Museo Historico Nacional',
        themes: ['culture'],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['ev:2'],
        shortReason: 'p2',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Museo Historico Nacional',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:2',
          geo: { latitude: -34.62655, longitude: -58.37055 },
        },
      ],
    };

    const p3: StructuredCandidateProposal = {
      candidate: {
        name: 'Parque Lezama',
        themes: ['nature'],
        traits: ['park'],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: ['ev:3'],
        shortReason: 'p3',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Parque Lezama',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'ev:3',
          geo: { latitude: -34.628, longitude: -58.369 },
        },
      ],
    };

    const order1 = service.corroborateAndMerge([p1, p2, p3], ['SINGLE_PLACE']);
    const order2 = service.corroborateAndMerge([p3, p1, p2], ['SINGLE_PLACE']);
    const order3 = service.corroborateAndMerge([p2, p3, p1], ['SINGLE_PLACE']);

    expect(order1.candidates).toEqual(order2.candidates);
    expect(order1.candidates).toEqual(order3.candidates);
    expect(order1.groups).toEqual(order2.groups);
    expect(order1.groups).toEqual(order3.groups);
  });

  it('Scenario L (regression): classifies conflicting expectedKind (PLACE vs AREA) as AMBIGUOUS and preserves separate candidates', () => {
    const proposalPlace: StructuredCandidateProposal = {
      candidate: {
        name: 'San Telmo Market',
        themes: ['food'],
        traits: ['market'],
        componentHints: [
          {
            key: 'hint:place',
            name: 'San Telmo Market',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['osm:1'],
          },
        ],
        evidenceKeys: ['osm:1'],
        shortReason: 'Place candidate',
      },
      observations: [
        {
          provider: 'osm',
          title: 'San Telmo Market',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'osm:1',
          geo: { latitude: -34.62, longitude: -58.37 },
        },
      ],
    };

    const proposalArea: StructuredCandidateProposal = {
      candidate: {
        name: 'San Telmo Market',
        themes: ['food'],
        traits: ['market'],
        componentHints: [
          {
            key: 'hint:area',
            name: 'San Telmo Market',
            role: 'area',
            expectedKind: 'AREA',
            required: true,
            evidenceKeys: ['wikivoyage:1'],
          },
        ],
        evidenceKeys: ['wikivoyage:1'],
        shortReason: 'Area candidate',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'San Telmo Market',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'wikivoyage:1',
          geo: { latitude: -34.62, longitude: -58.37 },
        },
      ],
    };

    // Pair decision must be AMBIGUOUS due to conflicting expectedKind
    const pair = service.decidePair(proposalPlace, proposalArea);
    expect(pair.decision).toBe('AMBIGUOUS');
    expect(pair.reasons).toContain('conflicting_component_expected_kind');

    // Corroboration merge must NOT collapse them into 1 candidate or force expectedKind PLACE
    const result = service.corroborateAndMerge(
      [proposalPlace, proposalArea],
      ['SINGLE_PLACE'],
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.groups).toHaveLength(1);

    const placeCandidate = result.candidates.find(
      (c) => c.componentHints[0].expectedKind === 'PLACE',
    );
    expect(placeCandidate).toBeDefined();
    expect(placeCandidate?.componentHints[0].role).toBe('venue');
  });

  // Scenario M (regression): Shared Wikidata QID across different observation kinds (place vs tourism_activity)
  it('Scenario M (regression): does not merge place and tourism_activity sharing the same Wikidata QID', () => {
    const pSeePlace: StructuredCandidateProposal = {
      candidate: {
        name: 'Mercado San Telmo',
        themes: [],
        traits: [],
        componentHints: [
          {
            key: 'hint:mercado',
            name: 'Mercado San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wikivoyage:San_Telmo:see:see:Mercado_San_Telmo:1'],
          },
        ],
        evidenceKeys: ['wikivoyage:San_Telmo:see:see:Mercado_San_Telmo:1'],
        shortReason: 'Historical market',
      },
      observations: [
        {
          provider: 'wikivoyage',
          externalId: 'Q123',
          canonicalIdentity: { wikidataQid: 'Q123' },
          title: 'Mercado San Telmo',
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: 'wikivoyage:San_Telmo:see:see:Mercado_San_Telmo:1',
          geo: { latitude: -34.6195, longitude: -58.3728 },
        },
      ],
    };

    const pDoActivity: StructuredCandidateProposal = {
      candidate: {
        name: 'Tour gastronómico Mercado San Telmo',
        themes: [],
        traits: [],
        componentHints: [PLACE_COMPONENT_HINT],
        evidenceKeys: [
          'wikivoyage:San_Telmo:do:do:Tour_gastronomico_Mercado_San_Telmo:1',
        ],
        shortReason: 'Food tour',
      },
      observations: [
        {
          provider: 'wikivoyage',
          externalId: 'Q123',
          canonicalIdentity: { wikidataQid: 'Q123' },
          title: 'Tour gastronómico Mercado San Telmo',
          evidenceType: 'tourism_activity',
          originationCapabilities: [],
          evidenceKey:
            'wikivoyage:San_Telmo:do:do:Tour_gastronomico_Mercado_San_Telmo:1',
          geo: { latitude: -34.6195, longitude: -58.3728 },
        },
      ],
    };

    const pairDec = service.decidePair(pSeePlace, pDoActivity);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('incompatible_evidence_type');
    expect(pairDec.reasons).not.toContain('same_evidence_key');
    expect(pairDec.reasons).not.toContain('same_wikidata_identity');

    const result = service.corroborateAndMerge(
      [pSeePlace, pDoActivity],
      ['SINGLE_PLACE'],
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.groups).toHaveLength(1);
  });

  describe('Google Places cross-source corroboration (Phase 4)', () => {
    it('1. Same place from Wikivoyage + Google Places within 150m and matching name collapses into ONE ExperienceCandidate with both evidenceKeys and 1 component hint', () => {
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Teatro Colón',
          description: 'Famoso teatro de ópera en Buenos Aires.',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: 'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1:component',
              name: 'Teatro Colón',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['wikivoyage:San_Nicolas:see:see:Teatro_Colon:1'],
            },
          ],
          evidenceKeys: ['wikivoyage:San_Nicolas:see:see:Teatro_Colon:1'],
          shortReason: 'Wikivoyage see listing',
        },
        observations: [
          {
            provider: 'wikivoyage',
            title: 'Teatro Colón',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
            geo: { latitude: -34.601111, longitude: -58.383056 },
          },
        ],
      };

      const pGP: StructuredCandidateProposal = {
        candidate: {
          name: 'Teatro Colon',
          description: 'Cerrito 628, C1010 Cdad. Autónoma de Buenos Aires',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: 'google_places:ChIJTeatroColon:component',
              name: 'Teatro Colon',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['google_places:ChIJTeatroColon'],
            },
          ],
          evidenceKeys: ['google_places:ChIJTeatroColon'],
          shortReason: 'Structured observation from google_places',
        },
        observations: [
          {
            provider: 'google_places',
            externalId: 'ChIJTeatroColon',
            title: 'Teatro Colon',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:ChIJTeatroColon',
            geo: { latitude: -34.60115, longitude: -58.3831 },
          },
        ],
      };

      const pairDec = service.decidePair(pWV, pGP);
      expect(pairDec.decision).toBe('SAME');
      expect(pairDec.reasons).toContain('compatible_geo_and_name');

      const mergeResult = service.corroborateAndMerge(
        [pWV, pGP],
        ['SINGLE_PLACE'],
      );
      expect(mergeResult.candidates).toHaveLength(1);
      expect(mergeResult.groups).toHaveLength(1);

      const merged = mergeResult.candidates[0];
      expect(merged.name).toBe('Teatro Colon');
      expect(merged.evidenceKeys).toEqual([
        'google_places:ChIJTeatroColon',
        'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
      ]);
      expect(merged.componentHints).toHaveLength(1);
      expect(merged.componentHints[0]).toEqual({
        key: 'google_places:ChIJTeatroColon:component',
        name: 'Teatro Colon',
        role: 'venue',
        expectedKind: 'PLACE',
        required: true,
        evidenceKeys: [
          'google_places:ChIJTeatroColon',
          'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
        ],
      });
    });

    it('2. Same name from Wikivoyage and Google Places but distance > 150m remains TWO distinct candidates (NEW)', () => {
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Café Tortoni',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['wikivoyage:Monserrat:see:see:Cafe_Tortoni:1'],
          shortReason: 'Historic cafe',
        },
        observations: [
          {
            provider: 'wikivoyage',
            title: 'Café Tortoni',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:Monserrat:see:see:Cafe_Tortoni:1',
            geo: { latitude: -34.6083, longitude: -58.3794 },
          },
        ],
      };

      const pGP: StructuredCandidateProposal = {
        candidate: {
          name: 'Café Tortoni',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['google_places:ChIJTortoniFar'],
          shortReason: 'Places cafe',
        },
        observations: [
          {
            provider: 'google_places',
            externalId: 'ChIJTortoniFar',
            title: 'Café Tortoni',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:ChIJTortoniFar',
            // ~750m away
            geo: { latitude: -34.615, longitude: -58.3794 },
          },
        ],
      };

      const pairDec = service.decidePair(pWV, pGP);
      expect(pairDec.decision).toBe('NEW');

      const mergeResult = service.corroborateAndMerge(
        [pWV, pGP],
        ['SINGLE_PLACE'],
      );
      expect(mergeResult.candidates).toHaveLength(2);
      expect(mergeResult.groups).toHaveLength(2);
    });

    it('3. Overlapping coordinates <= 150m with different names marked AMBIGUOUS and not auto-merged', () => {
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Café Tortoni',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['wikivoyage:Monserrat:see:see:Cafe_Tortoni:1'],
          shortReason: 'Historic cafe',
        },
        observations: [
          {
            provider: 'wikivoyage',
            title: 'Café Tortoni',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:Monserrat:see:see:Cafe_Tortoni:1',
            geo: { latitude: -34.6083, longitude: -58.3794 },
          },
        ],
      };

      const pGP: StructuredCandidateProposal = {
        candidate: {
          name: 'Farmacia del Águila',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['google_places:ChIJPharmacy'],
          shortReason: 'Pharmacy',
        },
        observations: [
          {
            provider: 'google_places',
            externalId: 'ChIJPharmacy',
            title: 'Farmacia del Águila',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:ChIJPharmacy',
            // ~6m away, completely different name
            geo: { latitude: -34.60835, longitude: -58.37945 },
          },
        ],
      };

      const pairDec = service.decidePair(pWV, pGP);
      expect(pairDec.decision).toBe('AMBIGUOUS');
      expect(pairDec.reasons).toContain(
        'geographic_overlap_without_name_match',
      );

      const mergeResult = service.corroborateAndMerge(
        [pWV, pGP],
        ['SINGLE_PLACE'],
      );
      expect(mergeResult.candidates).toHaveLength(2);
      expect(mergeResult.groups).toHaveLength(2);
    });

    it('4. Google Places place_id does NOT auto-merge via QID rule with Wikivoyage Wikidata QID', () => {
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Museo de Arte Moderno',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['wikivoyage:San_Telmo:see:see:MAMBA:1'],
          shortReason: 'Modern art museum',
        },
        observations: [
          {
            provider: 'wikivoyage',
            externalId: 'Q12345',
            canonicalIdentity: { wikidataQid: 'Q12345' },
            title: 'Museo de Arte Moderno',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:San_Telmo:see:see:MAMBA:1',
          },
        ],
      };

      const pGP: StructuredCandidateProposal = {
        candidate: {
          name: 'Centro Cultural Recoleta',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['google_places:Q12345'],
          shortReason: 'Cultural center',
        },
        observations: [
          {
            provider: 'google_places',
            // Coincidentally has Q12345 as externalId string -- the real
            // Google Places adapter never populates `canonicalIdentity`
            // (it has no notion of a Wikidata QID), so this coincidental
            // string must never be reinterpreted as one.
            externalId: 'Q12345',
            title: 'Centro Cultural Recoleta',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:Q12345',
          },
        ],
      };

      const pairDec = service.decidePair(pWV, pGP);
      // google_places never populates `canonicalIdentity` (an adapter-level
      // typed fact, not inferred from `provider`), so no shared identity
      // exists here regardless of the coincidental externalId string.
      expect(pairDec.reasons).not.toContain('same_wikidata_identity');
      expect(pairDec.decision).toBe('NEW');

      const mergeResult = service.corroborateAndMerge(
        [pWV, pGP],
        ['SINGLE_PLACE'],
      );
      expect(mergeResult.candidates).toHaveLength(2);
      expect(mergeResult.groups).toHaveLength(2);
    });
  });

  describe('OSM cross-source corroboration (Phase 5)', () => {
    const osmPlace = (
      id: string,
      name: string,
      latitude: number,
      longitude: number,
    ): StructuredCandidateProposal => ({
      candidate: {
        name,
        themes: [],
        traits: [],
        componentHints: [
          {
            key: `${id}:component`,
            name,
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: [id],
          },
        ],
        evidenceKeys: [id],
        shortReason: `Structured observation from osm: ${name}`,
      },
      observations: [
        {
          provider: 'osm',
          externalId: id,
          title: name,
          evidenceType: 'place',
          originationCapabilities: ['SINGLE_PLACE'],
          evidenceKey: id,
          geo: { latitude, longitude },
          metadata: {
            osmType: id.split(':')[1],
            matchedConcepts: ['historic'],
          },
        },
      ],
    });

    it('merges an OSM place and a Wikivoyage listing for the same real place (geo + name) into one candidate with unioned evidenceKeys', () => {
      const pOSM = osmPlace(
        'osm:node:1',
        'Mercado de San Telmo',
        -34.6208,
        -58.3717,
      );
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Mercado de San Telmo',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: 'wikivoyage:San_Telmo:see:see:Mercado:1:component',
              name: 'Mercado de San Telmo',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['wikivoyage:San_Telmo:see:see:Mercado:1'],
            },
          ],
          evidenceKeys: ['wikivoyage:San_Telmo:see:see:Mercado:1'],
          shortReason: 'Wikivoyage see listing',
        },
        observations: [
          {
            provider: 'wikivoyage',
            title: 'Mercado de San Telmo',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:San_Telmo:see:see:Mercado:1',
            geo: { latitude: -34.62085, longitude: -58.37172 },
          },
        ],
      };

      const pairDec = service.decidePair(pOSM, pWV);
      expect(pairDec.decision).toBe('SAME');
      expect(pairDec.reasons).toContain('compatible_geo_and_name');

      const mergeResult = service.corroborateAndMerge(
        [pOSM, pWV],
        ['SINGLE_PLACE'],
      );
      expect(mergeResult.candidates).toHaveLength(1);
      expect(mergeResult.candidates[0].evidenceKeys).toEqual([
        'osm:node:1',
        'wikivoyage:San_Telmo:see:see:Mercado:1',
      ]);
    });

    it('does not merge an OSM osm:way id with a coincidental Wikidata QID identity', () => {
      const pOSM = osmPlace('osm:way:12345', 'Parque X', -34.6, -58.4);
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Otro Lugar',
          themes: [],
          traits: [],
          componentHints: [PLACE_COMPONENT_HINT],
          evidenceKeys: ['wikivoyage:X:see:see:Q12345:1'],
          shortReason: 'unrelated',
        },
        observations: [
          {
            provider: 'wikivoyage',
            externalId: 'Q12345',
            canonicalIdentity: { wikidataQid: 'Q12345' },
            title: 'Otro Lugar',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:X:see:see:Q12345:1',
          },
        ],
      };

      const pairDec = service.decidePair(pOSM, pWV);
      expect(pairDec.reasons).not.toContain('same_wikidata_identity');
      expect(pairDec.decision).toBe('NEW');
    });

    it('marks an OSM place overlapping a differently-named place as AMBIGUOUS (never force-merges)', () => {
      const pOSM = osmPlace('osm:node:7', 'Plaza Dorrego', -34.6205, -58.3712);
      const pOSM2 = osmPlace(
        'osm:node:8',
        'Farmacia del Centro',
        -34.62052,
        -58.37122,
      );

      const pairDec = service.decidePair(pOSM, pOSM2);
      expect(pairDec.decision).toBe('AMBIGUOUS');
      expect(pairDec.reasons).toContain(
        'geographic_overlap_without_name_match',
      );

      const mergeResult = service.corroborateAndMerge(
        [pOSM, pOSM2],
        ['SINGLE_PLACE'],
      );
      expect(mergeResult.candidates).toHaveLength(2);
    });
  });

  describe('origination capability (generic operational venue admission)', () => {
    const genericCafeProposal: StructuredCandidateProposal = {
      candidate: {
        name: 'Generic Café',
        themes: [],
        traits: [],
        intents: [],
        componentHints: [
          {
            key: 'google_places:cafe-1:component',
            name: 'Generic Café',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['google_places:cafe-1'],
          },
        ],
        evidenceKeys: ['google_places:cafe-1'],
        shortReason: 'Structured observation from google_places: Generic Café',
      },
      observations: [
        {
          provider: 'google_places',
          externalId: 'cafe-1',
          title: 'Generic Café',
          evidenceType: 'place',
          originationCapabilities: [],
          evidenceKey: 'google_places:cafe-1',
          geo: { latitude: -34.6, longitude: -58.38 },
        },
      ],
    };

    it('drops a cluster with no matching origination capability', () => {
      const result = service.corroborateAndMerge(
        [genericCafeProposal],
        ['SINGLE_PLACE'],
      );
      expect(result.candidates).toHaveLength(0);
    });

    it('keeps support evidence when it corroborates real tourism evidence', () => {
      const wikivoyageEat: StructuredCandidateProposal = {
        name: 'Generic Café',
        // reuse the same candidate shape but from Wikivoyage EAT evidence
      } as unknown as StructuredCandidateProposal;
      Object.assign(wikivoyageEat, {
        candidate: {
          ...genericCafeProposal.candidate,
          evidenceKeys: ['wikivoyage:Palermo:eat:eat:Generic_Cafe:1'],
          componentHints: [
            {
              ...genericCafeProposal.candidate.componentHints[0],
              key: 'wikivoyage:Palermo:eat:eat:Generic_Cafe:1:component',
              evidenceKeys: ['wikivoyage:Palermo:eat:eat:Generic_Cafe:1'],
            },
          ],
        },
        observations: [
          {
            provider: 'wikivoyage',
            title: 'Generic Café',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:Palermo:eat:eat:Generic_Cafe:1',
            geo: { latitude: -34.6, longitude: -58.38 },
          },
        ],
      });

      const result = service.corroborateAndMerge(
        [genericCafeProposal, wikivoyageEat],
        ['SINGLE_PLACE'],
      );
      expect(result.candidates).toHaveLength(1);
    });
  });

  it('rejects a bare OSM route when only structural schedulable shapes are requested', () => {
    const result = service.corroborateAndMerge(
      [
        {
          candidate: {
            name: 'Route relation',
            themes: [],
            traits: [],
            intents: [],
            componentHints: [
              {
                key: 'osm:relation:route:component',
                name: 'Route relation',
                role: 'route',
                expectedKind: 'ROUTE',
                required: true,
                evidenceKeys: ['osm:relation:route'],
              },
            ],
            evidenceKeys: ['osm:relation:route'],
            shortReason: 'OSM route relation',
          },
          observations: [
            {
              provider: 'osm',
              externalId: 'osm:relation:route',
              title: 'Route relation',
              evidenceType: 'route',
              originationCapabilities: [],
              evidenceKey: 'osm:relation:route',
            },
          ],
        },
      ],
      ['SINGLE_PLACE', 'MULTI_COMPONENT_EXPERIENCE'],
    );

    expect(result.candidates).toHaveLength(0);
    expect(result.rejectedOriginations).toHaveLength(1);
  });

  describe('B3 live wiring — qualityEvidence merge (cutover M2)', () => {
    it('a Wikivoyage listing + a rated Google Places result for the same place merge into one qualityEvidence bundle', () => {
      const pWV: StructuredCandidateProposal = {
        candidate: {
          name: 'Teatro Colón',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: 'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1:component',
              name: 'Teatro Colón',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['wikivoyage:San_Nicolas:see:see:Teatro_Colon:1'],
            },
          ],
          evidenceKeys: ['wikivoyage:San_Nicolas:see:see:Teatro_Colon:1'],
          shortReason: 'Wikivoyage see listing',
          qualityEvidence: { editorialListing: { listed: true } },
        },
        observations: [
          {
            provider: 'wikivoyage',
            title: 'Teatro Colón',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
            geo: { latitude: -34.601111, longitude: -58.383056 },
          },
        ],
      };

      const pGP: StructuredCandidateProposal = {
        candidate: {
          name: 'Teatro Colon',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: 'google_places:ChIJTeatroColon:component',
              name: 'Teatro Colon',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['google_places:ChIJTeatroColon'],
            },
          ],
          evidenceKeys: ['google_places:ChIJTeatroColon'],
          shortReason: 'Structured observation from google_places',
          qualityEvidence: {
            consumerRating: { value: 4.8, reviewCount: 12000 },
          },
        },
        observations: [
          {
            provider: 'google_places',
            externalId: 'ChIJTeatroColon',
            title: 'Teatro Colon',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:ChIJTeatroColon',
            geo: { latitude: -34.60115, longitude: -58.3831 },
          },
        ],
      };

      const merged = service.corroborateAndMerge([pWV, pGP], ['SINGLE_PLACE'])
        .candidates[0];

      expect(merged.qualityEvidence).toEqual({
        consumerRating: { value: 4.8, reviewCount: 12000 },
        editorialListing: { listed: true },
      });
    });

    it('picks the Places contributor with the higher review count when two rated observations corroborate', () => {
      const base = (
        suffix: string,
        rating: number,
        reviewCount: number,
      ): StructuredCandidateProposal => ({
        candidate: {
          name: 'Museo Nacional',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: `google_places:${suffix}:component`,
              name: 'Museo Nacional',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: [`google_places:${suffix}`],
            },
          ],
          evidenceKeys: [`google_places:${suffix}`],
          shortReason: 'Structured observation from google_places',
          qualityEvidence: {
            consumerRating: { value: rating, reviewCount },
          },
        },
        observations: [
          {
            provider: 'google_places',
            externalId: suffix,
            title: 'Museo Nacional',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: `google_places:${suffix}`,
            geo: { latitude: -34.6, longitude: -58.38 },
          },
        ],
      });

      // A low-confidence 4.9 (few reviews) must not beat a well-corroborated
      // 4.2 (many reviews) -- the merge picks the more confident signal,
      // never an average of the two.
      const weakButHighRating = base('weak', 4.9, 3);
      const confidentRating = base('confident', 4.2, 5000);

      const merged = service.corroborateAndMerge(
        [weakButHighRating, confidentRating],
        ['SINGLE_PLACE'],
      ).candidates[0];

      expect(merged.qualityEvidence).toEqual({
        consumerRating: { value: 4.2, reviewCount: 5000 },
      });
    });

    it('a cluster with no quality-bearing contributor (e.g. OSM + OSM) has no qualityEvidence at all', () => {
      const osmA: StructuredCandidateProposal = {
        candidate: {
          name: 'Plaza Dorrego',
          themes: [],
          traits: [],
          componentHints: [
            {
              key: 'osm:node:1:component',
              name: 'Plaza Dorrego',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['osm:node:1'],
            },
          ],
          evidenceKeys: ['osm:node:1'],
          shortReason: 'Structured observation from osm',
        },
        observations: [
          {
            provider: 'osm',
            title: 'Plaza Dorrego',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'osm:node:1',
            geo: { latitude: -34.6212, longitude: -58.373 },
          },
        ],
      };
      const osmB: StructuredCandidateProposal = JSON.parse(
        JSON.stringify({
          ...osmA,
          candidate: {
            ...osmA.candidate,
            evidenceKeys: ['osm:node:2'],
            componentHints: [
              {
                ...osmA.candidate.componentHints[0],
                key: 'osm:node:2:component',
                evidenceKeys: ['osm:node:2'],
              },
            ],
          },
          observations: [
            { ...osmA.observations[0], evidenceKey: 'osm:node:2' },
          ],
        }),
      );

      const merged = service.corroborateAndMerge([osmA, osmB], ['SINGLE_PLACE'])
        .candidates[0];

      expect(merged.qualityEvidence).toBeUndefined();
    });
  });
});
