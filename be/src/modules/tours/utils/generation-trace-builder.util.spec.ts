import {
  buildEmbeddingsStep,
  buildDestinationResolutionStep,
  buildLlmGenerationStep,
  buildNeighborhoodShortlistStep,
  buildOsmBoundaryStep,
  buildOsmStreetsStep,
  buildPlacesCrawlStep,
  buildWikidataEnrichmentStep,
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

  it('explains the deterministic evidence used to shortlist each neighborhood', () => {
    const sanTelmo = candidate('San Telmo');
    const step = buildNeighborhoodShortlistStep([sanTelmo], [sanTelmo], {
      existingFamilyCount: 1,
      catalogCoveredCount: 1,
      scoringInputs: [
        {
          candidate: sanTelmo,
          hasExistingFamily: true,
          catalogPoiCount: 3,
          catalogProminenceScore: 1.234,
          interestSimilarity: 0.876,
          overpassPoiCount: null,
        },
      ],
    });

    expect(step.summary).toContain('prominencia');
    expect(step.candidates?.[0].detail).toContain('familia existente');
    expect(step.candidates?.[0].detail).toContain('3 POI(s)');
    expect(step.candidates?.[0].detail).toContain('prominencia 1.23');
    expect(step.candidates?.[0].detail).toContain('afinidad semántica 0.88');
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

  it('reports provider request failures separately from rejected candidate results', () => {
    const step = buildPlacesCrawlStep([], {
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 320,
      receivedCount: 55,
      acceptedCount: 8,
      rejectedCountByReason: {
        out_of_area: 46,
        existing_activity: 1,
        provider_request_failed: 13,
      },
    });

    expect(step.summary).toContain('descartó 47');
    expect(step.summary).toContain('13 consulta(s) al proveedor fallaron');
    expect(step.summary).not.toContain('descartó 60');
  });

  it('reports anchors, bounded provider calls, validation, deduplication and embeddings', () => {
    const step = buildPlacesCrawlStep([], {
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 20,
      receivedCount: 12,
      acceptedCount: 5,
      rejectedCount: 7,
      validatedCount: 6,
      deduplicatedCount: 2,
      embeddedCount: 5,
      providerCallCount: 4,
      anchors: [
        {
          id: 'casco',
          label: 'Casco Antiguo',
          latitude: 1,
          longitude: 2,
          radiusMeters: 2500,
        },
        {
          id: 'triana',
          label: 'Triana',
          latitude: 1,
          longitude: 3,
          radiusMeters: 2500,
        },
      ],
      rejectedCountByReason: { duplicate_result: 2, existing_activity: 1 },
    });

    expect(step.summary).toContain('2 anchor(s): Casco Antiguo, Triana');
    expect(step.summary).toContain('4 consulta(s) acotadas');
    expect(step.summary).toContain('Validó 6');
    expect(step.summary).toContain('2 duplicado(s)');
    expect(step.summary).toContain('5 embedding(s)');
    expect(step.summary).toContain('descartó 7');
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

describe('destination and Wikidata trace steps', () => {
  it('records normalized destination attempts and the coordinate mismatch reason', () => {
    const step = buildDestinationResolutionStep('Montevideo', {
      scale: 'point',
      attemptedQueries: ['forward:Montevideo', 'reverse:-34.905900,-56.191300'],
      degradationReason: 'candidate_mismatched_coordinates',
    });

    expect(step.summary).toContain('reverse:-34.905900,-56.191300');
    expect(step.summary).toContain('no coincidían con las coordenadas');
  });

  it('distinguishes missing QIDs, unsafe extracts, and safety provider failure', () => {
    const withQid = candidate('Defensa');
    withQid.tags.wikidata = 'Q1';
    const withoutQid = candidate('San Telmo');
    const step = buildWikidataEnrichmentStep([withQid, withoutQid], {
      withoutQid: 1,
      withQid: 1,
      fetched: 1,
      acceptedSafe: 0,
      rejectedUnsafe: 0,
      providerFailed: 0,
      safetyCheckFailed: 1,
      fetchedQids: new Set(['Q1']),
      safeQids: new Set(),
      rejectedUnsafeQids: new Set(),
      safetyCheckFailedQids: new Set(['Q1']),
    });

    expect(step.summary).toContain('1 sin QID');
    expect(step.summary).toContain('1 afectados por fallo del control');
    expect(step.providerStatus).toBe('failed');
    expect(step.candidates?.[0].detail).toContain('control de seguridad falló');
    expect(step.summary).toContain('no elimina candidatos');
  });
});

describe('OSM trace steps', () => {
  it('distinguishes an Overpass failure from a successful empty street result', () => {
    const failed = buildOsmStreetsStep([], 'timeout');
    const empty = buildOsmStreetsStep([], undefined, true);

    expect(failed.providerStatus).toBe('failed');
    expect(failed.summary).toContain('no significa que no existan');
    expect(empty.providerStatus).toBe('success');
    expect(empty.summary).toContain('respondió sin calles, vías o POIs');
  });

  it('preserves and reports real OSM candidates when only part of Overpass degraded', () => {
    const step = buildOsmStreetsStep(
      [candidate('San Telmo')],
      'one neighborhood timed out',
      false,
    );

    expect(step.providerStatus).toBe('failed');
    expect(step.summary).toContain('1 calles, vías o POIs OSM reales');
    expect(step.summary).toContain('cobertura puede estar incompleta');
    expect(step.candidates?.[0].offered).toBe(true);
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
