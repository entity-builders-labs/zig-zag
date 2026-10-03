import { Test, TestingModule } from '@nestjs/testing';
import { OsmMembershipService } from './osm-membership.service';
import { OsmCandidate } from './osm-places.service';
import {
  SAN_TELMO_BOUNDARY,
  LA_BOCA_BOUNDARY,
  POINT_IN_SAN_TELMO,
  POINT_IN_LA_BOCA,
  POINT_OUTSIDE_NEIGHBORHOODS,
  rectBoundary,
} from '../fixtures/osm-membership.fixture';

describe('OsmMembershipService', () => {
  let service: OsmMembershipService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OsmMembershipService],
    }).compile();
    service = module.get(OsmMembershipService);
  });

  const boundaries = [SAN_TELMO_BOUNDARY, LA_BOCA_BOUNDARY];

  it('classifies a point inside exactly one boundary', () => {
    expect(
      service.membershipOf(
        POINT_IN_SAN_TELMO.latitude,
        POINT_IN_SAN_TELMO.longitude,
        boundaries,
      ),
    ).toEqual({
      outcome: 'inside',
      containing: [SAN_TELMO_BOUNDARY],
    });
  });

  it('classifies a point inside the other boundary', () => {
    expect(
      service.membershipOf(
        POINT_IN_LA_BOCA.latitude,
        POINT_IN_LA_BOCA.longitude,
        boundaries,
      ),
    ).toEqual({
      outcome: 'inside',
      containing: [LA_BOCA_BOUNDARY],
    });
  });

  it('classifies a point outside every boundary', () => {
    expect(
      service.membershipOf(
        POINT_OUTSIDE_NEIGHBORHOODS.latitude,
        POINT_OUTSIDE_NEIGHBORHOODS.longitude,
        boundaries,
      ),
    ).toEqual({ outcome: 'outside', containing: [] });
  });

  it('reports ambiguity when two boundaries contain the point', () => {
    const overlap = rectBoundary({
      id: 'osm:relation:3001',
      name: 'Overlap',
      adminLevel: '9',
      west: -58.38,
      east: -58.35,
      south: -34.63,
      north: -34.6,
    });
    // Point sits inside both San Telmo and Overlap.
    expect(
      service.membershipOf(-34.62, -58.37, [SAN_TELMO_BOUNDARY, overlap]),
    ).toEqual({
      outcome: 'ambiguous',
      containing: [SAN_TELMO_BOUNDARY, overlap],
      reason: 'multiple_containing',
    });
  });

  it('reports unavailable for a non-finite point', () => {
    expect(service.membershipOf(Number.NaN, -58.37, boundaries)).toEqual({
      outcome: 'unavailable',
      containing: [],
      reason: 'invalid_point',
    });
  });

  it('reports unavailable when no boundaries are supplied', () => {
    expect(service.membershipOf(-34.62, -58.37, [])).toEqual({
      outcome: 'unavailable',
      containing: [],
      reason: 'no_boundaries',
    });
  });

  it('reports unavailable when no boundary has authoritative polygon geometry', () => {
    const pointOnly: OsmCandidate = {
      ...SAN_TELMO_BOUNDARY,
      geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
    };
    expect(service.membershipOf(-34.62, -58.37, [pointOnly])).toEqual({
      outcome: 'unavailable',
      containing: [],
      reason: 'no_authoritative_geometry',
    });
  });
});
