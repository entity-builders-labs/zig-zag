import { Test, TestingModule } from '@nestjs/testing';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';

describe('StructuredExperienceCandidateSynthesizerService', () => {
  let service: StructuredExperienceCandidateSynthesizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StructuredExperienceCandidateSynthesizerService],
    }).compile();

    service = module.get<StructuredExperienceCandidateSynthesizerService>(
      StructuredExperienceCandidateSynthesizerService,
    );
  });

  it('mechanically maps place observation to ExperienceCandidate with venue component hint', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      externalId: 'Q263127',
      title: 'Manzana de las Luces',
      description: 'Complejo histórico.',
      geo: { latitude: -34.610556, longitude: -58.374444 },
      evidenceType: 'place',
      originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
      evidenceKey: 'wikivoyage:San_Telmo:Manzana_de_las_Luces',
    };

    const [candidate] = service.synthesize([observation]);

    expect(candidate).toBeDefined();
    expect(candidate.name).toBe('Manzana de las Luces');
    expect(candidate.description).toBe('Complejo histórico.');
    expect(candidate.themes).toEqual([]);
    expect(candidate.traits).toEqual([]);
    expect(candidate.intents).toEqual([]);
    expect(candidate.evidenceKeys).toEqual([
      'wikivoyage:San_Telmo:Manzana_de_las_Luces',
    ]);
    expect(candidate.shortReason).toBe(
      'Structured observation from wikivoyage: Manzana de las Luces',
    );
    expect(candidate.orderedByEvidence).toBe(false);

    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0]).toEqual({
      key: 'wikivoyage:San_Telmo:Manzana_de_las_Luces:component',
      name: 'Manzana de las Luces',
      role: 'venue',
      expectedKind: 'PLACE',
      evidenceKeys: ['wikivoyage:San_Telmo:Manzana_de_las_Luces'],
    });
  });

  it('maps area observation to AREA component hint', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      title: 'Distrito de las Artes',
      evidenceType: 'area',
      originationCapabilities: [],
      evidenceKey: 'wikivoyage:La_Boca:Distrito_de_las_Artes',
    };

    const [candidate] = service.synthesize([observation]);

    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0]).toEqual({
      key: 'wikivoyage:La_Boca:Distrito_de_las_Artes:component',
      name: 'Distrito de las Artes',
      role: 'area',
      expectedKind: 'AREA',
      evidenceKeys: ['wikivoyage:La_Boca:Distrito_de_las_Artes'],
    });
  });

  it('maps route observation to ROUTE component hint', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      title: 'Caminito Peatonal',
      evidenceType: 'route',
      originationCapabilities: [],
      evidenceKey: 'wikivoyage:La_Boca:Caminito_Peatonal',
    };

    const [candidate] = service.synthesize([observation]);

    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0]).toEqual({
      key: 'wikivoyage:La_Boca:Caminito_Peatonal:component',
      name: 'Caminito Peatonal',
      role: 'route',
      expectedKind: 'ROUTE',
      evidenceKeys: ['wikivoyage:La_Boca:Caminito_Peatonal'],
    });
  });

  it('leaves componentHints empty for tourism_activity even with coordinates and title', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      title: 'Clases de Tango al Aire Libre',
      description: 'Clase de baile guiada.',
      geo: { latitude: -34.62, longitude: -58.37 },
      evidenceType: 'tourism_activity',
      originationCapabilities: [],
      evidenceKey: 'wikivoyage:San_Telmo:Clases_de_Tango',
    };

    const [candidate] = service.synthesize([observation]);

    expect(candidate.name).toBe('Clases de Tango al Aire Libre');
    expect(candidate.componentHints).toEqual([]);
    expect(candidate.themes).toEqual([]);
    expect(candidate.traits).toEqual([]);
    expect(candidate.intents).toEqual([]);
  });

  it('leaves componentHints empty for operator and editorial evidence types', () => {
    const observations: SourceObservation[] = [
      {
        provider: 'wikivoyage',
        title: 'Operador Turístico Local',
        evidenceType: 'operator',
        originationCapabilities: [],
        evidenceKey: 'wikivoyage:test:operator',
      },
      {
        provider: 'wikivoyage',
        title: 'Artículo Editorial',
        evidenceType: 'editorial',
        originationCapabilities: [],
        evidenceKey: 'wikivoyage:test:editorial',
      },
    ];

    const candidates = service.synthesize(observations);

    expect(candidates[0].componentHints).toEqual([]);
    expect(candidates[1].componentHints).toEqual([]);
  });

  it('synthesizeProposals returns StructuredCandidateProposal envelopes with raw observations', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      title: 'Plaza Dorrego',
      evidenceType: 'place',
      originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
      evidenceKey: 'wikivoyage:San_Telmo:see:see:Plaza_Dorrego:1',
      geo: { latitude: -34.62, longitude: -58.37 },
    };

    const proposals = service.synthesizeProposals([observation]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].candidate.name).toBe('Plaza Dorrego');
    expect(proposals[0].observations).toEqual([observation]);
  });

  it('synthesizes Google Places SourceObservation into candidate with venue component hint and empty facets', () => {
    const observation: SourceObservation = {
      provider: 'google_places',
      externalId: 'ChIJPlace123',
      title: 'Teatro Colón',
      description: 'Cerrito 628, Buenos Aires',
      geo: { latitude: -34.601111, longitude: -58.383056 },
      evidenceType: 'place',
      originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
      evidenceKey: 'google_places:ChIJPlace123',
      // Already normalized at the adapter boundary
      // (GooglePlacesAcquisitionProvider) -- this test never re-derives it
      // from raw metadata.
      qualityEvidence: { consumerRating: { value: 4.9 } },
      metadata: {
        rating: 4.9,
      },
    };

    const proposals = service.synthesizeProposals([observation]);

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    const candidate = proposal.candidate;

    expect(candidate.name).toBe('Teatro Colón');
    expect(candidate.description).toBe('Cerrito 628, Buenos Aires');
    expect(candidate.themes).toEqual([]);
    expect(candidate.traits).toEqual([]);
    expect(candidate.intents).toEqual([]);
    expect(candidate.evidenceKeys).toEqual(['google_places:ChIJPlace123']);
    expect(candidate.shortReason).toBe(
      'Structured observation from google_places: Teatro Colón',
    );
    expect(candidate.orderedByEvidence).toBe(false);

    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0]).toEqual({
      key: 'google_places:ChIJPlace123:component',
      name: 'Teatro Colón',
      role: 'venue',
      expectedKind: 'PLACE',
      evidenceKeys: ['google_places:ChIJPlace123'],
    });
    expect(proposal.observations).toEqual([observation]);
    // B3 live wiring (cutover M2): the ALREADY-normalized qualityEvidence
    // the adapter attached is carried onto the candidate unchanged.
    expect(candidate.qualityEvidence).toEqual({
      consumerRating: { value: 4.9 },
    });
  });

  describe('B3 live wiring — qualityEvidence is a pure pass-through', () => {
    it('carries whatever normalized qualityEvidence the observation already has', () => {
      const observation: SourceObservation = {
        provider: 'geoapify',
        title: 'Museo Nacional',
        evidenceType: 'place',
        originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
        evidenceKey: 'geoapify:1',
        qualityEvidence: { consumerRating: { value: 4.2, reviewCount: 830 } },
      };

      const [candidate] = service.synthesize([observation]);

      expect(candidate.qualityEvidence).toEqual({
        consumerRating: { value: 4.2, reviewCount: 830 },
      });
    });

    it('never derives qualityEvidence from raw metadata -- only the typed field counts', () => {
      // A Geoapify-shaped observation whose adapter found no rating (the
      // normal case) never sets `qualityEvidence` -- even if `metadata`
      // happens to carry rating-shaped keys, this layer must not decode
      // them. Proves this layer never re-implements the adapter's own
      // normalization.
      const observation: SourceObservation = {
        provider: 'geoapify',
        title: 'Parque Lezama',
        evidenceType: 'place',
        originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
        evidenceKey: 'geoapify:2',
        metadata: { rating: 4.2, userRatingCount: 830 },
      };

      const [candidate] = service.synthesize([observation]);

      expect(candidate.qualityEvidence).toBeUndefined();
    });

    it('carries an editorial-listing evidence bundle unchanged', () => {
      const observation: SourceObservation = {
        provider: 'wikivoyage',
        title: 'Manzana de las Luces',
        evidenceType: 'place',
        originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
        evidenceKey: 'wikivoyage:1',
        qualityEvidence: { editorialListing: { listed: true } },
      };

      const [candidate] = service.synthesize([observation]);

      expect(candidate.qualityEvidence).toEqual({
        editorialListing: { listed: true },
      });
    });

    it('has no qualityEvidence when the observation carries none (e.g. OSM)', () => {
      const observation: SourceObservation = {
        provider: 'osm' as any,
        title: 'Plaza Dorrego',
        evidenceType: 'place',
        originationCapabilities: ['SINGLE_PLACE', 'SINGLE_PLACE'],
        evidenceKey: 'osm:node:1',
      };

      const [candidate] = service.synthesize([observation]);

      expect(candidate.qualityEvidence).toBeUndefined();
    });
  });
});
