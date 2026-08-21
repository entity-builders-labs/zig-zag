import { shortlistNeighborhoods, NeighborhoodScoringInput } from './neighborhood-shortlist.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

function candidate(name: string): OsmCandidate {
  return {
    id: `osm:relation:${name}`,
    name,
    osmType: 'relation',
    osmId: 1,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    tags: { name },
  };
}

describe('shortlistNeighborhoods', () => {
  it('prioritizes a neighborhood with an existing curated family over one with more raw POIs', () => {
    const inputs: NeighborhoodScoringInput[] = [
      { candidate: candidate('Cold but POI-dense'), hasExistingFamily: false, poiCount: 100 },
      { candidate: candidate('San Telmo'), hasExistingFamily: true, poiCount: 5 },
    ];

    const result = shortlistNeighborhoods(inputs);

    expect(result[0].name).toBe('San Telmo');
  });

  it('among neighborhoods with the same existing-family status, ranks by POI density', () => {
    const inputs: NeighborhoodScoringInput[] = [
      { candidate: candidate('Sparse'), hasExistingFamily: false, poiCount: 2 },
      { candidate: candidate('Dense'), hasExistingFamily: false, poiCount: 50 },
    ];

    const result = shortlistNeighborhoods(inputs);

    expect(result.map((c) => c.name)).toEqual(['Dense', 'Sparse']);
  });

  it('caps the result to k (default 6)', () => {
    const inputs: NeighborhoodScoringInput[] = Array.from({ length: 20 }, (_, i) => ({
      candidate: candidate(`Neighborhood ${i}`),
      hasExistingFamily: false,
      poiCount: i,
    }));

    const result = shortlistNeighborhoods(inputs);

    expect(result).toHaveLength(6);
  });

  it('respects an explicit k override', () => {
    const inputs: NeighborhoodScoringInput[] = Array.from({ length: 10 }, (_, i) => ({
      candidate: candidate(`Neighborhood ${i}`),
      hasExistingFamily: false,
      poiCount: i,
    }));

    const result = shortlistNeighborhoods(inputs, 3);

    expect(result).toHaveLength(3);
  });
});
