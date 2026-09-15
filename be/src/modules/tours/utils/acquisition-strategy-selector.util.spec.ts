import {
  partitionDeficitsByStrategy,
  selectAcquisitionStrategy,
} from './acquisition-strategy-selector.util';
import { AcquisitionDeficit } from '../interfaces/experience-acquisition-plan.interface';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';

function walkDeficit(): AcquisitionDeficit {
  return {
    origin: 'preference_facet',
    dimension: 'intent',
    key: 'walk',
    reason: 'Preference facet [intent:walk] has no strong catalog match yet.',
  };
}

function routeLikeDeficit(): AcquisitionDeficit {
  return {
    origin: 'preference_facet',
    dimension: 'intent',
    key: 'route_like',
    reason:
      'Preference facet [intent:route_like] has no strong catalog match yet.',
  };
}

function themeDeficit(key = 'history'): AcquisitionDeficit {
  return {
    origin: 'preference_facet',
    dimension: 'theme',
    key,
    reason: `Preference facet [theme:${key}] has no strong catalog match yet.`,
  };
}

function globalCapacityDeficit(): AcquisitionDeficit {
  return {
    origin: 'global_capacity',
    reason: 'Global portfolio capacity shortage.',
    currentEligibleCount: 1,
    requiredEligibleCount: 4,
  };
}

const areaAnchor: ResolvedAnchor = {
  rawName: 'San Telmo',
  kind: 'area',
  priority: 'must',
  status: 'resolved',
  canonicalName: 'San Telmo',
  geoEntityId: 'geo-san-telmo',
  provider: 'openstreetmap',
  geometry: { type: 'Polygon', coordinates: [] },
};
const routeAnchor: ResolvedAnchor = {
  rawName: 'Caminito',
  kind: 'route',
  priority: 'must',
  status: 'resolved',
  canonicalName: 'Caminito',
  geoEntityId: 'geo-caminito',
  provider: 'openstreetmap',
  geometry: { type: 'LineString', coordinates: [] },
};
const venueAnchor: ResolvedAnchor = {
  rawName: 'Teatro Colón',
  kind: 'venue',
  priority: 'soft',
  status: 'resolved',
  canonicalName: 'Teatro Colón',
  geoEntityId: 'geo-teatro-colon',
  provider: 'google_places',
};

describe('selectAcquisitionStrategy', () => {
  // 1. AREA + walk deficit
  it('routes an intent:walk deficit through AREA_ROUTE_WALK when exactly one relevant AREA anchor exists', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [areaAnchor]);
    expect(strategy).toEqual({
      kind: 'AREA_ROUTE_WALK',
      deficit,
      anchor: areaAnchor,
      intentKey: 'walk',
    });
    // Reference identity: the original object is passed through, never
    // reconstructed.
    expect(strategy.kind === 'AREA_ROUTE_WALK' && strategy.deficit).toBe(
      deficit,
    );
  });

  // 2. ROUTE + route_like deficit
  it('routes an intent:route_like deficit through AREA_ROUTE_WALK when exactly one relevant ROUTE anchor exists', () => {
    const deficit = routeLikeDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [routeAnchor]);
    expect(strategy).toEqual({
      kind: 'AREA_ROUTE_WALK',
      deficit,
      anchor: routeAnchor,
      intentKey: 'route_like',
    });
    expect(strategy.kind === 'AREA_ROUTE_WALK' && strategy.deficit).toBe(
      deficit,
    );
  });

  // 3. Unrelated/generic deficits never route through AREA_ROUTE_WALK
  it('keeps a theme deficit GENERIC even when a relevant AREA anchor exists', () => {
    const deficit = themeDeficit('history');
    const strategy = selectAcquisitionStrategy(deficit, [areaAnchor]);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  it('keeps an intent:walk deficit GENERIC when the only anchor is a venue (not area/route)', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [venueAnchor]);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  it('keeps an intent:walk deficit GENERIC when no anchors are present at all', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, []);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  it('keeps an intent:walk deficit GENERIC when 2+ relevant area/route anchors exist (mode D, not handled by this primitive)', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [
      areaAnchor,
      routeAnchor,
    ]);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  it('keeps a non-walk/route_like intent deficit GENERIC even with a relevant anchor', () => {
    const deficit: AcquisitionDeficit = {
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'visit',
      reason:
        'Preference facet [intent:visit] has no strong catalog match yet.',
    };
    const strategy = selectAcquisitionStrategy(deficit, [areaAnchor]);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  // 4. global_capacity never accidentally routes through the area/route strategy
  it('keeps a global_capacity deficit GENERIC even when a relevant AREA anchor exists', () => {
    const deficit = globalCapacityDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [areaAnchor]);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  it('keeps a global_capacity deficit GENERIC when a relevant ROUTE anchor exists', () => {
    const deficit = globalCapacityDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [routeAnchor]);
    expect(strategy).toEqual({ kind: 'GENERIC', deficit });
  });

  // 5. The original canonical deficit object is passed through, never reconstructed
  it('never reconstructs the deficit object -- GENERIC carries the exact same reference', () => {
    const deficit = themeDeficit('food');
    const strategy = selectAcquisitionStrategy(deficit, [areaAnchor]);
    expect(strategy.deficit).toBe(deficit);
  });
});

describe('partitionDeficitsByStrategy', () => {
  it('splits a mixed deficit list into areaRouteWalk and generic buckets, preserving each deficit unmodified', () => {
    const walk = walkDeficit();
    const theme = themeDeficit('food');
    const capacity = globalCapacityDeficit();

    const { areaRouteWalk, generic } = partitionDeficitsByStrategy(
      [walk, theme, capacity],
      [areaAnchor],
    );

    expect(areaRouteWalk).toEqual([
      { deficit: walk, anchor: areaAnchor, intentKey: 'walk' },
    ]);
    expect(areaRouteWalk[0].deficit).toBe(walk);
    expect(generic).toEqual([theme, capacity]);
    expect(generic[0]).toBe(theme);
    expect(generic[1]).toBe(capacity);
  });

  it('routes everything GENERIC when no anchors are present', () => {
    const walk = walkDeficit();
    const routeLike = routeLikeDeficit();
    const { areaRouteWalk, generic } = partitionDeficitsByStrategy(
      [walk, routeLike],
      [],
    );
    expect(areaRouteWalk).toEqual([]);
    expect(generic).toEqual([walk, routeLike]);
  });
});
