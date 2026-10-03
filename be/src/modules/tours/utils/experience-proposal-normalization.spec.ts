import { withDefaultGeographicAuthorization } from './geographic-validation-authorization.util';
import { extractExperienceCandidates } from './experience-candidate-extraction.util';
import {
  isUnsupportedComponentSourceSupportResult,
  verifyTextualComponentSourceSupport,
} from './component-source-support.util';
import { buildDiscoveryInstructions } from '../prompts/experience-discovery-extraction.prompt';
import { ExperienceProposalResolverService } from '../services/experience-proposal-resolver.service';
import { projectEntityResolutionStepInput } from './experience-generation-trace.util';

const ev = (key: string, text: string, title?: string) => ({
  key,
  text,
  title,
});

describe('RW3-N5 Source Typo Normalization Contract', () => {
  // Test 1: Extraction parses and preserves both sourceName and normalized name
  it('1. Extraction parses and preserves both sourceName and normalized name', () => {
    const rawCandidate = {
      candidates: [
        {
          name: 'La Boca Cultural Walk',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              role: 'waypoint',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-5'],
              supportSpan: 'Visit Caminito',
            },
            {
              key: 'la-bombonera',
              name: 'La Bombonera',
              sourceName: 'La Bambonera stadium',
              normalizationKind: 'TYPO_CORRECTION' as const,
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-5'],
              supportSpan: 'and La Bambonera stadium',
            },
          ],
          evidenceKeys: ['ev-5'],
          shortReason: 'Two supported stops in La Boca',
        },
      ],
    };

    const evidence = [
      ev(
        'ev-5',
        'Visit Caminito, Benito Quinquela Martin Museum, and La Bambonera stadium',
      ),
    ];

    const result = extractExperienceCandidates(rawCandidate, evidence, 8);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    const bomboneraHint = candidate.componentHints.find(
      (h) => h.key === 'la-bombonera',
    );
    expect(bomboneraHint).toBeDefined();
    expect(bomboneraHint?.name).toBe('La Bombonera');
    expect(bomboneraHint?.sourceName).toBe('La Bambonera stadium');
    expect(bomboneraHint?.normalizationKind).toBe('TYPO_CORRECTION');

    // Audit also preserves sourceName and normalizationKind
    const audit = result.sourceSupportAudits[0].components.find(
      (c) => c.key === 'la-bombonera',
    );
    expect(audit).toBeDefined();
    expect(audit?.name).toBe('La Bombonera');
    expect(audit?.sourceName).toBe('La Bambonera stadium');
    expect(audit?.normalizationKind).toBe('TYPO_CORRECTION');
    expect(audit?.status).toBe('SUPPORTED');
  });

  // Test 2: Missing sourceName defaults safely (e.g. sourceName = name)
  it('2. Missing sourceName defaults safely (e.g. sourceName = name)', () => {
    const rawCandidate = {
      candidates: [
        {
          name: 'Caminito Walk',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              role: 'waypoint',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Walk down Caminito',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Caminito walk',
        },
      ],
    };

    const evidence = [ev('ev-1', 'Walk down Caminito to see colorful houses.')];
    const result = extractExperienceCandidates(rawCandidate, evidence, 8);
    expect(result.candidates).toHaveLength(1);
    const hint = result.candidates[0].componentHints[0];
    expect(hint.name).toBe('Caminito');
    expect(hint.sourceName).toBe('Caminito');
    expect(hint.normalizationKind).toBeUndefined();
  });

  // Test 3: verifiedSupportSpan matches the source-literal wording, NOT the normalized identity
  it('3. verifiedSupportSpan matches the source-literal wording, NOT the normalized identity', () => {
    const evidenceText =
      'Visit Caminito, Benito Quinquela Martin Museum, and La Bambonera stadium';
    const evidenceByKey = new Map([['ev-5', ev('ev-5', evidenceText)]]);

    // When supportSpan uses the literal wording from evidence
    const validSupport = verifyTextualComponentSourceSupport(
      'La Bambonera stadium',
      ['ev-5'],
      evidenceByKey,
    );
    expect(validSupport.supported).toBe(true);
    if (validSupport.supported) {
      expect(validSupport.verifiedSupportSpan).toBe('La Bambonera stadium');
    }

    // When supportSpan attempts to use the normalized name "La Bombonera", which does NOT appear in evidence
    const invalidSupport = verifyTextualComponentSourceSupport(
      'La Bombonera',
      ['ev-5'],
      evidenceByKey,
    );
    expect(invalidSupport.supported).toBe(false);
    expect(isUnsupportedComponentSourceSupportResult(invalidSupport)).toBe(
      true,
    );
    if (isUnsupportedComponentSourceSupportResult(invalidSupport)) {
      expect(invalidSupport.reason).toBe('SPAN_NOT_FOUND_IN_CITED_EVIDENCE');
    }
  });

  // Test 4: Unambiguous obvious typo produces proposed canonical name (with real ev-5 fixture)
  it('4. Unambiguous obvious typo produces proposed canonical name with real ev-5 fixture', () => {
    const ev5Snippet =
      'Visit Caminito, Benito Quinquela Martin Museum, and La Bambonera stadium';
    const rawCandidate = {
      candidates: [
        {
          name: 'La Boca Itinerary',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              sourceName: 'Caminito',
              role: 'waypoint',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-5'],
              supportSpan: 'Visit Caminito',
            },
            {
              key: 'quinquela',
              name: 'Benito Quinquela Martin Museum',
              sourceName: 'Benito Quinquela Martin Museum',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-5'],
              supportSpan: 'Benito Quinquela Martin Museum',
            },
            {
              key: 'la-bombonera',
              name: 'La Bombonera',
              sourceName: 'La Bambonera stadium',
              normalizationKind: 'TYPO_CORRECTION' as const,
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-5'],
              supportSpan: 'and La Bambonera stadium',
            },
          ],
          evidenceKeys: ['ev-5'],
          shortReason: 'Three stops from ev-5',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [ev('ev-5', ev5Snippet)],
      8,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.sourceSupportAudits[0].status).toBe('SUPPORTED');

    const bombonera = result.candidates[0].componentHints.find(
      (h) => h.key === 'la-bombonera',
    );
    expect(bombonera?.name).toBe('La Bombonera');
    expect(bombonera?.sourceName).toBe('La Bambonera stadium');
    expect(bombonera?.normalizationKind).toBe('TYPO_CORRECTION');
  });

  // Test 5: Negative case N5.2: similar-looking but different entity is NOT normalized
  it('5. Negative case N5.2: similar-looking but different entity is NOT normalized', () => {
    // 5a: Prompt instruction forbids rewriting to different entities
    const instructions = buildDiscoveryInstructions();
    const promptText = instructions.join('\n');
    expect(promptText).toMatch(
      /Never use typo correction or normalization to introduce a different entity/i,
    );
    expect(promptText).toMatch(
      /keep the exact name the evidence uses and let the backend geographic resolver decide/i,
    );

    // 5b: Extractor correctly preserves "Museo Naval" without rewriting to "Museo Nacional"
    const evidenceText =
      'Visit the historic docklands and the Museo Naval to see maritime history.';
    const rawCandidate = {
      candidates: [
        {
          name: 'Maritime History',
          themes: ['history'],
          traits: [] as string[],
          intents: ['visit'],
          componentHints: [
            {
              key: 'museo-naval',
              name: 'Museo Naval',
              sourceName: 'Museo Naval',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Museo Naval',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Maritime visit',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [ev('ev-1', evidenceText)],
      8,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].componentHints[0].name).toBe('Museo Naval');
    expect(result.candidates[0].componentHints[0].sourceName).toBe(
      'Museo Naval',
    );
    expect(
      result.candidates[0].componentHints[0].normalizationKind,
    ).toBeUndefined();

    // 5c: If an unsafe extractor rewrote supportSpan to "Museo Nacional", it is rejected
    const unsafeCandidate = {
      candidates: [
        {
          name: 'National Museum Visit',
          themes: ['history'],
          traits: [] as string[],
          intents: ['visit'],
          componentHints: [
            {
              key: 'museo-nacional',
              name: 'Museo Nacional',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Museo Nacional',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Unsafe rewrite',
        },
      ],
    };
    const unsafeResult = extractExperienceCandidates(
      unsafeCandidate,
      [ev('ev-1', evidenceText)],
      8,
    );
    expect(unsafeResult.candidates).toHaveLength(0);
    expect(unsafeResult.sourceSupportAudits[0].status).toBe(
      'SOURCE_CONTRACT_VIOLATION',
    );
  });

  // Test 6: Negative case N5.3: ambiguous typo fails closed or stays unnormalized
  it('6. Negative case N5.3: ambiguous typo fails closed or stays unnormalized', () => {
    // When an ambiguous typo exists, prompt instructs preserving exact name.
    // When extracted with unnormalized name:
    const rawCandidate = {
      candidates: [
        {
          name: 'Ambiguous Visit',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['visit'],
          componentHints: [
            {
              key: 'bambonera',
              name: 'Bambonera',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Bambonera',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Ambiguous name kept verbatim',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [ev('ev-1', 'Visit Bambonera during your trip.')],
      8,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].componentHints[0].name).toBe('Bambonera');
    expect(result.candidates[0].componentHints[0].sourceName).toBe('Bambonera');
    expect(
      result.candidates[0].componentHints[0].normalizationKind,
    ).toBeUndefined();
  });

  // Test 7: Negative case N5.4: nearby landmark absent from evidence is NOT invented
  it('7. Negative case N5.4: nearby landmark absent from evidence is NOT invented', () => {
    const evidenceText =
      'Walk down Caminito alley to see the colorful houses and street performers.';

    // Extractor attempts to invent "La Bombonera" which is not mentioned in evidence
    const hallucinatedCandidate = {
      candidates: [
        {
          name: 'Caminito and Stadium Walk',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              role: 'waypoint',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Walk down Caminito alley',
            },
            {
              key: 'bombonera',
              name: 'La Bombonera',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'La Bombonera', // Not in ev-1!
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Invented nearby landmark',
        },
      ],
    };

    const result = extractExperienceCandidates(
      hallucinatedCandidate,
      [ev('ev-1', evidenceText)],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.sourceSupportAudits[0].status).toBe(
      'SOURCE_CONTRACT_VIOLATION',
    );
    expect(result.sourceSupportAudits[0].unsupportedComponentCount).toBe(1);
    expect(result.sourceSupportAudits[0].components[1].status).toBe(
      'UNSUPPORTED',
    );
    expect(result.sourceSupportAudits[0].components[1].reason).toBe(
      'SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
    );
  });

  // Test 8: End-to-end entity resolution path:
  // proposal with typo-normalized name resolves against GeoEntity while trace
  // preserves original source wording.
  it('8. End-to-end entity resolution path: proposal with typo-normalized name resolves against GeoEntity while trace preserves original source wording', async () => {
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
      tags: {},
    };

    // Mock OSM search returning the stadium under canonical name "La Bombonera"
    const osmPlaces: any = {
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:way:248598885',
            name: 'La Bombonera',
            osmType: 'way',
            osmId: 248598885,
            geometry: { type: 'Point', coordinates: [-58.3649, -34.6355] },
            tags: { leisure: 'stadium' },
          },
        ],
      }),
    };

    const catalog: any = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-bombonera' }),
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      rememberVerifiedHintName: jest.fn().mockResolvedValue(undefined),
      findGeoEntityCandidatesForHint: jest
        .fn()
        .mockResolvedValue({ candidates: [] }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'experience-bombonera',
        dedupeDecision: 'NEW',
      }),
    };

    const geographicValidator: any = {
      validate: jest.fn().mockReturnValue({
        proposalName: 'Visita La Bombonera',
        kind: 'EXPERIENCE',
        status: 'GEO_VERIFIED',
        accepted: true,
        strategy: 'venue_centric',
        anchors: [],
        groundedEvidenceKeys: ['ev-5'],
        rejectionReasons: [],
        validatorVersion: 2,
      }),
    };

    const service = new ExperienceProposalResolverService(
      osmPlaces,
      catalog,
      geographicValidator,
    );

    // Candidate has proposed name 'La Bombonera', but sourceName 'La Bambonera stadium'
    const resolutionResponse = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: withDefaultGeographicAuthorization([
        {
          name: 'Visita La Bombonera',
          themes: ['sports'],
          traits: [] as string[],
          intents: ['visit'],
          componentHints: [
            {
              key: 'bombonera',
              name: 'La Bombonera',
              sourceName: 'La Bambonera stadium',
              normalizationKind: 'TYPO_CORRECTION',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-5'],
            },
          ],
          evidenceKeys: ['ev-5'],
          shortReason: 'Stadium visit',
        },
      ]),
      evidence: [
        {
          key: 'ev-5',
          source: 'serper',
          title: 'Buenos Aires Attractions',
          snippet:
            'Visit Caminito, Benito Quinquela Martin Museum, and La Bambonera stadium',
        },
      ],
    });

    expect(resolutionResponse.entityResolution).toBeDefined();
    const forensicAudits = resolutionResponse.entityResolution.forensicAudit;
    expect(forensicAudits).toHaveLength(1);
    const componentAudit = forensicAudits[0].componentAudits[0];

    // Verified resolution against GeoEntity
    expect(componentAudit.hintName).toBe('La Bombonera');
    expect(componentAudit.sourceName).toBe('La Bambonera stadium');
    expect(componentAudit.normalizationKind).toBe('TYPO_CORRECTION');
    expect(componentAudit.finalStatus).toBe('resolved');
    expect(componentAudit.resolvedGeoEntity?.canonicalName).toBe(
      'La Bombonera',
    );

    // Generation trace reflects the sourceName and normalizationKind
    const traceStep = projectEntityResolutionStepInput(resolutionResponse);
    const facts = traceStep.facts as any;
    expect(facts.entityResolutionAudit).toBeDefined();
    const traceHint = facts.entityResolutionAudit[0].hints[0];
    expect(traceHint.name).toBe('La Bombonera');
    expect(traceHint.sourceName).toBe('La Bambonera stadium');
    expect(traceHint.normalizationKind).toBe('TYPO_CORRECTION');
    expect(traceHint.status).toBe('resolved');
    expect(traceHint.resolvedGeoEntity?.canonicalName).toBe('La Bombonera');
  });

  // Test 9: sourceName == name results in normalizationKind absent, even if an explicit kind was supplied
  it('9. sourceName == name results in normalizationKind absent, even if kind was supplied', () => {
    const rawCandidate = {
      candidates: [
        {
          name: 'Caminito Tour',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              sourceName: 'Caminito',
              normalizationKind: 'TYPO_CORRECTION' as const, // Should be discarded because sourceName == name
              role: 'waypoint',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Caminito',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Identical sourceName and name',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [ev('ev-1', 'Explore Caminito in La Boca.')],
      8,
    );
    expect(result.candidates).toHaveLength(1);
    const hint = result.candidates[0].componentHints[0];
    expect(hint.name).toBe('Caminito');
    expect(hint.sourceName).toBe('Caminito');
    expect(hint.normalizationKind).toBeUndefined();
    expect(
      result.sourceSupportAudits[0].components[0].normalizationKind,
    ).toBeUndefined();
  });

  // Test 10: sourceName != name with valid TRANSLATION and CANONICAL_NAME are accepted
  it('10. sourceName != name with valid TRANSLATION and CANONICAL_NAME are accepted', () => {
    const rawCandidate = {
      candidates: [
        {
          name: 'Translated Tour',
          themes: ['nature'],
          traits: [] as string[],
          intents: ['visit'],
          componentHints: [
            {
              key: 'park',
              name: 'Parque Nacional El Leoncito',
              sourceName: 'El Leoncito National Park',
              normalizationKind: 'TRANSLATION' as const,
              role: 'area',
              expectedKind: 'AREA',
              evidenceKeys: ['ev-1'],
              supportSpan: 'El Leoncito National Park',
            },
            {
              key: 'catedral',
              name: 'Catedral Metropolitana de Buenos Aires',
              sourceName: 'Metropolitan Cathedral',
              normalizationKind: 'CANONICAL_NAME' as const,
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Metropolitan Cathedral',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Valid translation and canonical naming',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [
        ev(
          'ev-1',
          'Visit El Leoncito National Park and Metropolitan Cathedral.',
        ),
      ],
      8,
    );
    expect(result.candidates).toHaveLength(1);
    const hints = result.candidates[0].componentHints;
    expect(hints[0].normalizationKind).toBe('TRANSLATION');
    expect(hints[0].sourceName).toBe('El Leoncito National Park');
    expect(hints[0].name).toBe('Parque Nacional El Leoncito');
    expect(hints[1].normalizationKind).toBe('CANONICAL_NAME');
    expect(hints[1].sourceName).toBe('Metropolitan Cathedral');
  });

  // Test 11: sourceName != name with missing normalizationKind is rejected as SOURCE_CONTRACT_VIOLATION
  it('11. sourceName != name with missing normalizationKind is rejected as SOURCE_CONTRACT_VIOLATION', () => {
    const rawCandidate = {
      candidates: [
        {
          name: 'Missing Kind Candidate',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'bombonera',
              name: 'La Bombonera',
              sourceName: 'La Bambonera stadium',
              // normalizationKind is missing!
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'La Bambonera stadium',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Missing normalizationKind on changed name',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [ev('ev-1', 'Visit La Bambonera stadium.')],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.sourceSupportAudits).toHaveLength(1);
    expect(result.sourceSupportAudits[0].status).toBe(
      'SOURCE_CONTRACT_VIOLATION',
    );
    expect(result.sourceSupportAudits[0].components[0].status).toBe(
      'UNSUPPORTED',
    );
    expect(result.sourceSupportAudits[0].components[0].reason).toBe(
      'MISSING_NORMALIZATION_KIND',
    );
  });

  // Test 12: sourceName != name with invalid normalizationKind is rejected as SOURCE_CONTRACT_VIOLATION
  it('12. sourceName != name with invalid normalizationKind is rejected as SOURCE_CONTRACT_VIOLATION', () => {
    const rawCandidate = {
      candidates: [
        {
          name: 'Invalid Kind Candidate',
          themes: ['culture'],
          traits: [] as string[],
          intents: ['walk'],
          componentHints: [
            {
              key: 'bombonera',
              name: 'La Bombonera',
              sourceName: 'La Bambonera stadium',
              normalizationKind: 'MAGIC_INVENTED_KIND' as any,
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'La Bambonera stadium',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Invalid normalizationKind on changed name',
        },
      ],
    };

    const result = extractExperienceCandidates(
      rawCandidate,
      [ev('ev-1', 'Visit La Bambonera stadium.')],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.sourceSupportAudits).toHaveLength(1);
    expect(result.sourceSupportAudits[0].status).toBe(
      'SOURCE_CONTRACT_VIOLATION',
    );
    expect(result.sourceSupportAudits[0].components[0].status).toBe(
      'UNSUPPORTED',
    );
    expect(result.sourceSupportAudits[0].components[0].reason).toBe(
      'INVALID_NORMALIZATION_KIND',
    );
  });
});
