import { Test, TestingModule } from '@nestjs/testing';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { StructuredCandidateProposal } from '../interfaces/structured-candidate-proposal.interface';

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
          evidenceKey: 'wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1',
          geo: { latitude: -34.62, longitude: -58.37 },
        },
      ],
    };

    // Duplicate
    const p2 = JSON.parse(JSON.stringify(p1));

    const result = service.corroborateAndMerge([p1, p2]);
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
          title: 'Teatro Colón',
          evidenceType: 'place',
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
          title: 'Teatro Colon Opera House',
          evidenceType: 'place',
          evidenceKey: 'wikidata:Q827401',
        },
      ],
    };

    const pairDec = service.decidePair(pWiki, pWikidata);
    expect(pairDec.decision).toBe('SAME');
    expect(pairDec.reasons).toContain('same_wikidata_identity');

    const result = service.corroborateAndMerge([pWiki, pWikidata]);
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
          evidenceKey: 'osm:node:12345',
          geo: { latitude: -34.62008, longitude: -58.37005 }, // ~10m away
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('SAME');
    expect(pairDec.reasons).toContain('compatible_geo_and_name');

    const result = service.corroborateAndMerge([p1, p2]);
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
        componentHints: [],
        evidenceKeys: ['source1:cabrera_palermo'],
        shortReason: 'La Cabrera Palermo',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'La Cabrera',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['source2:cabrera_recoleta'],
        shortReason: 'La Cabrera Recoleta',
      },
      observations: [
        {
          provider: 'osm',
          title: 'La Cabrera',
          evidenceType: 'place',
          evidenceKey: 'source2:cabrera_recoleta',
          geo: { latitude: -34.59, longitude: -58.385 }, // ~4.5 km away
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('no_shared_identity_signal');

    const result = service.corroborateAndMerge([p1, p2]);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario E: Two businesses 20m apart different names
  it('Scenario E: marks two distinct places 20m apart as AMBIGUOUS and does not merge them', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'Café Dorrego',
        themes: ['cafe'],
        traits: [],
        componentHints: [],
        evidenceKeys: ['source1:cafe_dorrego'],
        shortReason: 'Café Dorrego',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Café Dorrego',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['source2:bar_britanico'],
        shortReason: 'Bar Británico',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Bar Británico',
          evidenceType: 'place',
          evidenceKey: 'source2:bar_britanico',
          geo: { latitude: -34.6202, longitude: -58.3702 }, // ~15m away
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('AMBIGUOUS');
    expect(pairDec.reasons).toContain('geographic_overlap_without_name_match');

    const result = service.corroborateAndMerge([p1, p2]);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario F: Same normalized name, no coordinates, no QID
  it('Scenario F: marks same name without coordinates or QID as AMBIGUOUS and does not merge', () => {
    const p1: StructuredCandidateProposal = {
      candidate: {
        name: 'El Obrero',
        themes: ['food'],
        traits: [],
        componentHints: [],
        evidenceKeys: ['source1:el_obrero'],
        shortReason: 'El Obrero',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'El Obrero',
          evidenceType: 'place',
          evidenceKey: 'source1:el_obrero',
        },
      ],
    };

    const p2: StructuredCandidateProposal = {
      candidate: {
        name: 'Bodegón El Obrero',
        themes: ['food'],
        traits: [],
        componentHints: [],
        evidenceKeys: ['source2:el_obrero'],
        shortReason: 'Bodegón El Obrero',
      },
      observations: [
        {
          provider: 'web',
          title: 'Bodegón El Obrero',
          evidenceType: 'place',
          evidenceKey: 'source2:el_obrero',
        },
      ],
    };

    const pairDec = service.decidePair(p1, p2);
    expect(pairDec.decision).toBe('AMBIGUOUS');
    expect(pairDec.reasons).toContain('name_match_without_geography');

    const result = service.corroborateAndMerge([p1, p2]);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario G: Incompatible types (place vs route) with same coordinates
  it('Scenario G: marks place vs route as NEW (incompatible evidence type) and does not merge', () => {
    const pPlace: StructuredCandidateProposal = {
      candidate: {
        name: 'Caminito',
        themes: [],
        traits: [],
        componentHints: [],
        evidenceKeys: ['source1:caminito_place'],
        shortReason: 'Caminito place',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Caminito',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['source2:caminito_route'],
        shortReason: 'Caminito route',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Paseo Caminito',
          evidenceType: 'route',
          evidenceKey: 'source2:caminito_route',
          geo: { latitude: -34.63905, longitude: -58.36205 },
        },
      ],
    };

    const pairDec = service.decidePair(pPlace, pRoute);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('incompatible_evidence_type');

    const result = service.corroborateAndMerge([pPlace, pRoute]);
    expect(result.candidates).toHaveLength(2);
  });

  // Scenario H: Tourism activity vs place
  it('Scenario H: does not auto-merge tourism_activity with a place', () => {
    const pActivity: StructuredCandidateProposal = {
      candidate: {
        name: 'Clases de Tango en La Boca',
        themes: [],
        traits: [],
        componentHints: [],
        evidenceKeys: ['source1:activity'],
        shortReason: 'Tango activity',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Clases de Tango en La Boca',
          evidenceType: 'tourism_activity',
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
        componentHints: [],
        evidenceKeys: ['source2:place'],
        shortReason: 'Teatro',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Teatro de La Boca',
          evidenceType: 'place',
          evidenceKey: 'source2:place',
          geo: { latitude: -34.639, longitude: -58.362 },
        },
      ],
    };

    const pairDec = service.decidePair(pActivity, pPlace);
    expect(pairDec.decision).toBe('NEW');
    expect(pairDec.reasons).toContain('incompatible_evidence_type');

    const result = service.corroborateAndMerge([pActivity, pPlace]);
    expect(result.candidates).toHaveLength(2);
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
          evidenceKey: 'ev:2',
          geo: { latitude: -34.61955, longitude: -58.37285 },
        },
      ],
    };

    const result = service.corroborateAndMerge([p1, p2]);
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
        componentHints: [],
        evidenceKeys: ['ev:A'],
        shortReason: 'A',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Plaza Dorrego',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['ev:B'],
        shortReason: 'B',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Plaza Dorrego Centro',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['ev:C'],
        shortReason: 'C',
      },
      observations: [
        {
          provider: 'web',
          title: 'Antiguedades Feria',
          evidenceType: 'place',
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
    const result = service.corroborateAndMerge([pA, pB, pC]);
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
        componentHints: [],
        evidenceKeys: ['ev:1'],
        shortReason: 'p1',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Museo Histórico Nacional',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['ev:2'],
        shortReason: 'p2',
      },
      observations: [
        {
          provider: 'osm',
          title: 'Museo Historico Nacional',
          evidenceType: 'place',
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
        componentHints: [],
        evidenceKeys: ['ev:3'],
        shortReason: 'p3',
      },
      observations: [
        {
          provider: 'wikivoyage',
          title: 'Parque Lezama',
          evidenceType: 'place',
          evidenceKey: 'ev:3',
          geo: { latitude: -34.628, longitude: -58.369 },
        },
      ],
    };

    const order1 = service.corroborateAndMerge([p1, p2, p3]);
    const order2 = service.corroborateAndMerge([p3, p1, p2]);
    const order3 = service.corroborateAndMerge([p2, p3, p1]);

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
    const result = service.corroborateAndMerge([proposalPlace, proposalArea]);
    expect(result.candidates).toHaveLength(2);
    expect(result.groups).toHaveLength(2);

    const placeCandidate = result.candidates.find(
      (c) => c.componentHints[0].expectedKind === 'PLACE',
    );
    const areaCandidate = result.candidates.find(
      (c) => c.componentHints[0].expectedKind === 'AREA',
    );

    expect(placeCandidate).toBeDefined();
    expect(areaCandidate).toBeDefined();
    expect(placeCandidate?.componentHints[0].role).toBe('venue');
    expect(areaCandidate?.componentHints[0].role).toBe('area');
  });
});
