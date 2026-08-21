import { buildNeighborhoodShortlistStep } from './generation-trace-builder.util';
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
