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
      required: true,
      evidenceKeys: ['wikivoyage:San_Telmo:Manzana_de_las_Luces'],
    });
  });

  it('maps area observation to AREA component hint', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      title: 'Distrito de las Artes',
      evidenceType: 'area',
      evidenceKey: 'wikivoyage:La_Boca:Distrito_de_las_Artes',
    };

    const [candidate] = service.synthesize([observation]);

    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0]).toEqual({
      key: 'wikivoyage:La_Boca:Distrito_de_las_Artes:component',
      name: 'Distrito de las Artes',
      role: 'area',
      expectedKind: 'AREA',
      required: true,
      evidenceKeys: ['wikivoyage:La_Boca:Distrito_de_las_Artes'],
    });
  });

  it('maps route observation to ROUTE component hint', () => {
    const observation: SourceObservation = {
      provider: 'wikivoyage',
      title: 'Caminito Peatonal',
      evidenceType: 'route',
      evidenceKey: 'wikivoyage:La_Boca:Caminito_Peatonal',
    };

    const [candidate] = service.synthesize([observation]);

    expect(candidate.componentHints).toHaveLength(1);
    expect(candidate.componentHints[0]).toEqual({
      key: 'wikivoyage:La_Boca:Caminito_Peatonal:component',
      name: 'Caminito Peatonal',
      role: 'route',
      expectedKind: 'ROUTE',
      required: true,
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
        evidenceKey: 'wikivoyage:test:operator',
      },
      {
        provider: 'wikivoyage',
        title: 'Artículo Editorial',
        evidenceType: 'editorial',
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
      evidenceKey: 'google_places:ChIJPlace123',
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
      required: true,
      evidenceKeys: ['google_places:ChIJPlace123'],
    });
    expect(proposal.observations).toEqual([observation]);
  });
});
