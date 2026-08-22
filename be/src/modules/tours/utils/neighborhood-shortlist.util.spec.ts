import {
  buildNeighborhoodCatalogSignals,
  countCatalogActivitiesWithinNeighborhood,
  shortlistNeighborhoods,
  NeighborhoodScoringInput,
} from './neighborhood-shortlist.util';
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

describe('shortlistNeighborhoods', () => {
  it('prioritizes a neighborhood with an existing curated family over one with more raw POIs', () => {
    const inputs: NeighborhoodScoringInput[] = [
      {
        candidate: candidate('Cold but POI-dense'),
        hasExistingFamily: false,
        catalogPoiCount: 100,
        overpassPoiCount: null,
      },
      {
        candidate: candidate('San Telmo'),
        hasExistingFamily: true,
        catalogPoiCount: 5,
        overpassPoiCount: null,
      },
    ];

    const result = shortlistNeighborhoods(inputs);

    expect(result[0].name).toBe('San Telmo');
  });

  it('among neighborhoods with the same existing-family status, ranks by POI density', () => {
    const inputs: NeighborhoodScoringInput[] = [
      {
        candidate: candidate('Sparse'),
        hasExistingFamily: false,
        catalogPoiCount: 2,
        overpassPoiCount: null,
      },
      {
        candidate: candidate('Dense'),
        hasExistingFamily: false,
        catalogPoiCount: 50,
        overpassPoiCount: null,
      },
    ];

    const result = shortlistNeighborhoods(inputs);

    expect(result.map((c) => c.name)).toEqual(['Dense', 'Sparse']);
  });

  it('prefers review-backed landmark prominence over a larger set of unrated POIs', () => {
    const prominent = candidate('Prominent');
    const noisy = candidate('Noisy');
    const prominentSignals = buildNeighborhoodCatalogSignals(
      prominent,
      [
        {
          id: 'landmark',
          kind: 'POI',
          latitude: 0.5,
          longitude: 0.5,
          rating: 4.8,
          ratingCount: 20_000,
        },
      ],
      null,
    );

    expect(
      shortlistNeighborhoods([
        {
          candidate: noisy,
          hasExistingFamily: false,
          catalogPoiCount: 3,
          catalogProminenceScore: 0,
          interestSimilarity: null,
          overpassPoiCount: null,
        },
        {
          candidate: prominent,
          hasExistingFamily: false,
          ...prominentSignals,
          overpassPoiCount: null,
        },
      ])[0].name,
    ).toBe('Prominent');
  });

  it('uses the strongest catalog embedding matches to personalize neighborhood relevance', () => {
    const architecture = candidate('Architecture');
    const generic = candidate('Generic');
    const activity = (id: string) => ({
      id,
      kind: 'POI',
      latitude: 0.5,
      longitude: 0.5,
      rating: 4.5,
      ratingCount: 100,
    });

    const architectureSignals = buildNeighborhoodCatalogSignals(
      architecture,
      [activity('architecture-poi')],
      new Map([['architecture-poi', 0.9]]),
    );
    const genericSignals = buildNeighborhoodCatalogSignals(
      generic,
      [activity('generic-poi')],
      new Map([['generic-poi', 0.1]]),
    );

    expect(
      shortlistNeighborhoods([
        {
          candidate: generic,
          hasExistingFamily: false,
          ...genericSignals,
          overpassPoiCount: null,
        },
        {
          candidate: architecture,
          hasExistingFamily: false,
          ...architectureSignals,
          overpassPoiCount: null,
        },
      ])[0].name,
    ).toBe('Architecture');
  });

  it('caps the result to k (default 6)', () => {
    const inputs: NeighborhoodScoringInput[] = Array.from(
      { length: 20 },
      (_, i) => ({
        candidate: candidate(`Neighborhood ${i}`),
        hasExistingFamily: false,
        catalogPoiCount: i,
        overpassPoiCount: null as number | null,
      }),
    );

    const result = shortlistNeighborhoods(inputs);

    expect(result).toHaveLength(6);
  });

  it('respects an explicit k override', () => {
    const inputs: NeighborhoodScoringInput[] = Array.from(
      { length: 10 },
      (_, i) => ({
        candidate: candidate(`Neighborhood ${i}`),
        hasExistingFamily: false,
        catalogPoiCount: i,
        overpassPoiCount: null as number | null,
      }),
    );

    const result = shortlistNeighborhoods(inputs, 3);

    expect(result).toHaveLength(3);
  });

  it('does not rank unknown Overpass density as a trustworthy zero', () => {
    const inputs: NeighborhoodScoringInput[] = [
      {
        candidate: candidate('Unknown'),
        hasExistingFamily: false,
        catalogPoiCount: 0,
        overpassPoiCount: null,
      },
      {
        candidate: candidate('Known'),
        hasExistingFamily: false,
        catalogPoiCount: 0,
        overpassPoiCount: 0,
      },
    ];

    expect(shortlistNeighborhoods(inputs)[0].name).toBe('Known');
  });

  it('counts only validated catalog locations inside the neighborhood polygon', () => {
    const neighborhood = candidate('Square');

    expect(
      countCatalogActivitiesWithinNeighborhood(neighborhood, [
        { latitude: 0.5, longitude: 0.5 },
        { latitude: 2, longitude: 2 },
        { latitude: null, longitude: null },
      ]),
    ).toBe(1);
  });

  it('does not double-count an existing composite centroid as catalog POI evidence', () => {
    const neighborhood = candidate('Square');

    expect(
      buildNeighborhoodCatalogSignals(
        neighborhood,
        [
          {
            id: 'walk',
            kind: 'NEIGHBORHOOD_WALK',
            latitude: 0.5,
            longitude: 0.5,
            rating: 5,
            ratingCount: 1000,
          },
        ],
        new Map([['walk', 1]]),
      ),
    ).toEqual({
      catalogPoiCount: 0,
      catalogProminenceScore: 0,
      interestSimilarity: 0,
    });
  });
});
