import {
  buildEmbeddingsStep,
  buildLlmGenerationStep,
  buildNeighborhoodShortlistStep,
  buildOsmBoundaryStep,
  buildOsmStreetsStep,
  buildPlacesCrawlStep,
} from './generation-trace-builder.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

function candidate(name: string): OsmCandidate {
  return {
    id: `osm:relation:${name}`,
    name,
    osmType: 'relation',
    osmId: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    tags: { name },
  };
}

describe('buildNeighborhoodShortlistStep', () => {
  it('lists every real neighborhood found, marking which ones were shortlisted', () => {
    const sanTelmo = candidate('San Telmo');
    const laBoca = candidate('La Boca');
    const recoleta = candidate('Recoleta');

    const step = buildNeighborhoodShortlistStep(
      [sanTelmo, laBoca, recoleta],
      [sanTelmo, laBoca],
    );

    expect(step.stage).toBe('neighborhood_shortlist');
    expect(step.summary).toContain('3');
    expect(step.summary).toContain('2');
    const offeredNames = step.candidates?.map((c) => c.name);
    expect(offeredNames).toEqual(['San Telmo', 'La Boca', 'Recoleta']);
    const sanTelmoCandidate = step.candidates?.find(
      (c) => c.name === 'San Telmo',
    );
    const recoletaCandidate = step.candidates?.find(
      (c) => c.name === 'Recoleta',
    );
    expect(sanTelmoCandidate?.chosen).toBe(true);
    expect(recoletaCandidate?.chosen).toBe(false);
  });

  it('summarizes finding zero neighborhoods without erroring', () => {
    const step = buildNeighborhoodShortlistStep([], []);

    expect(step.summary).toContain('0');
    expect(step.candidates).toEqual([]);
  });
});

describe('buildPlacesCrawlStep', () => {
  it('reports the actual Geoapify provider and cache provenance', () => {
    const step = buildPlacesCrawlStep([{ id: 'a1', name: 'Museo' }], {
      provider: 'geoapify',
      cacheStatus: 'hit',
      requestedCount: 20,
      receivedCount: 4,
      acceptedCount: 1,
      rejectedCountByReason: { existing_activity: 3 },
    });

    expect(step.stage).toBe('places_crawl');
    expect(step.label).toContain('Geoapify');
    expect(step.label).not.toContain('Google');
    expect(step.summary).toContain('cache hit');
    expect(step.candidates?.[0].source).toBe('geoapify');
    expect(step.placesProvenance?.acceptedCount).toBe(1);
  });

  it('reports a strict Google cache miss as a failure without claiming results', () => {
    const step = buildPlacesCrawlStep(
      [],
      {
        provider: 'google',
        cacheStatus: 'strict-miss',
        requestedCount: 20,
        receivedCount: 0,
        acceptedCount: 0,
        rejectedCountByReason: {},
      },
      true,
    );

    expect(step.label).toContain('Google Places');
    expect(step.summary).toContain('falló');
    expect(step.summary).toContain('strict cache miss');
    expect(step.summary).not.toContain('encontró');
  });
});

describe('buildEmbeddingsStep', () => {
  it('does not claim semantic ranking was applied when no offered candidate is indexed', () => {
    const step = buildEmbeddingsStep(15, 0, true);

    expect(step.summary).toContain('No hubo señal semántica disponible');
    expect(step.summary).toContain('rating y proximidad');
    expect(step.summary).not.toContain('usado junto');
  });

  it('reports indexed embeddings conservatively without claiming the query provider responded', () => {
    const step = buildEmbeddingsStep(15, 10, true);

    expect(step.summary).toContain('estaban disponibles');
    expect(step.summary).toContain('no prueba');
  });
});

describe('OSM trace steps', () => {
  it('distinguishes an Overpass failure from a successful empty street result', () => {
    const failed = buildOsmStreetsStep([], 'timeout');
    const empty = buildOsmStreetsStep([], undefined, true);

    expect(failed.providerStatus).toBe('failed');
    expect(failed.summary).toContain('no significa que no existan');
    expect(empty.providerStatus).toBe('success');
    expect(empty.summary).toContain('respondió sin calles');
  });

  it('does not claim there is no containing boundary when Overpass failed', () => {
    const step = buildOsmBoundaryStep(null, 'rate limited');

    expect(step.providerStatus).toBe('failed');
    expect(step.degradedReason).toBe('rate limited');
    expect(step.summary).toContain('No se pudo consultar');
    expect(step.summary).not.toContain('Sin un límite');
  });
});

describe('buildLlmGenerationStep', () => {
  it('labels model reasoning as unverified rather than deterministic evidence', () => {
    const step = buildLlmGenerationStep(
      'All activities fit public-transport zones and opening hours.',
    );

    expect(step.label).toContain('no verificada');
    expect(step.summary).toContain('no constituyen verificación');
    expect(step.summary).toContain('transporte');
    expect(step.summary).toContain('horarios');
  });
});
