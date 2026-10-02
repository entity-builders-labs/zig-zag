import {
  partitionDeficitsIntoWorkUnits,
  selectAcquisitionStrategy,
  workUnitGeographicGrant,
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
  usage: 'unknown',
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
  usage: 'unknown',
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
  usage: 'unknown',
  kind: 'venue',
  priority: 'soft',
  status: 'resolved',
  canonicalName: 'Teatro Colón',
  geoEntityId: 'geo-teatro-colon',
  provider: 'google_places',
};
const unresolvedNamedPathAnchor: ResolvedAnchor = {
  status: 'unresolved',
  rawName: 'Ruta de los Siete Lagos',
  usage: 'named_path',
  priority: 'must',
  unresolvedReason: 'NO_CONFIDENT_ROUTE_MATCH',
};
const unresolvedIrrelevantAnchor: ResolvedAnchor = {
  status: 'unresolved',
  rawName: 'Unknown thing',
  usage: 'specific_destination',
  priority: 'soft',
  unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
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
      anchorMode: 'canonical',
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
      anchorMode: 'canonical',
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

  it('routes an intent:walk deficit to its own DEDICATED_INTENT unit when the only anchor is a venue (never GENERIC)', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [venueAnchor]);
    expect(strategy).toEqual({ kind: 'DEDICATED_INTENT', deficit });
  });

  it('routes an intent:walk deficit to DEDICATED_INTENT when no anchors are present at all', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, []);
    expect(strategy).toEqual({ kind: 'DEDICATED_INTENT', deficit });
    expect(strategy.deficit).toBe(deficit);
  });

  it('routes an intent:route_like deficit to DEDICATED_INTENT when no anchors are present at all', () => {
    const deficit = routeLikeDeficit();
    const strategy = selectAcquisitionStrategy(deficit, []);
    expect(strategy).toEqual({ kind: 'DEDICATED_INTENT', deficit });
  });

  it('routes an unresolved named_path through the explicit tourism-route mode', () => {
    const strategy = selectAcquisitionStrategy(walkDeficit(), [
      unresolvedNamedPathAnchor,
    ]);
    expect(strategy).toMatchObject({
      kind: 'AREA_ROUTE_WALK',
      anchor: unresolvedNamedPathAnchor,
      anchorMode: 'tourism_route',
    });
  });

  it('does not route an unrelated unresolved anchor through AREA_ROUTE_WALK', () => {
    const deficit = walkDeficit();
    expect(
      selectAcquisitionStrategy(deficit, [unresolvedIrrelevantAnchor]),
    ).toEqual({
      kind: 'DEDICATED_INTENT',
      deficit,
    });
  });

  it('routes an intent:walk deficit to DEDICATED_INTENT when 2+ relevant area/route anchors exist (mode D is not AREA_ROUTE_WALK)', () => {
    const deficit = walkDeficit();
    const strategy = selectAcquisitionStrategy(deficit, [
      areaAnchor,
      routeAnchor,
    ]);
    expect(strategy).toEqual({ kind: 'DEDICATED_INTENT', deficit });
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

describe('partitionDeficitsIntoWorkUnits', () => {
  it('gives each policy-bearing deficit its own unit and coalesces the rest into one GENERIC unit, preserving each deficit unmodified', () => {
    const walk = walkDeficit();
    const theme = themeDeficit('food');
    const capacity = globalCapacityDeficit();

    const units = partitionDeficitsIntoWorkUnits(
      [walk, theme, capacity],
      [areaAnchor],
    );

    expect(units).toEqual([
      {
        kind: 'AREA_ROUTE_WALK',
        deficit: walk,
        anchor: areaAnchor,
        anchorMode: 'canonical',
      },
      { kind: 'GENERIC', deficits: [theme, capacity] },
    ]);
    expect(units[0].kind === 'AREA_ROUTE_WALK' && units[0].deficit).toBe(walk);
    const generic = units[1];
    expect(generic.kind === 'GENERIC' && generic.deficits[0]).toBe(theme);
    expect(generic.kind === 'GENERIC' && generic.deficits[1]).toBe(capacity);
  });

  // Test A / B: a lone policy deficit without an AREA/ROUTE anchor.
  it('A/B: route_like or walk alone without an anchor -> exactly one DEDICATED_INTENT unit, no GENERIC unit', () => {
    const routeLike = routeLikeDeficit();
    expect(partitionDeficitsIntoWorkUnits([routeLike], [])).toEqual([
      { kind: 'DEDICATED_INTENT', deficit: routeLike },
    ]);
    const walk = walkDeficit();
    expect(partitionDeficitsIntoWorkUnits([walk], [])).toEqual([
      { kind: 'DEDICATED_INTENT', deficit: walk },
    ]);
  });

  // Test C: walk + route_like + visit -> independent work, no ambiguity.
  it('C: walk + route_like + visit -> a walk unit, a route_like unit and one generic visit unit, each with its own grant', () => {
    const walk = walkDeficit();
    const routeLike = routeLikeDeficit();
    const visit: AcquisitionDeficit = {
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'visit',
      reason:
        'Preference facet [intent:visit] has no strong catalog match yet.',
    };

    const units = partitionDeficitsIntoWorkUnits([walk, routeLike, visit], []);

    expect(units).toEqual([
      { kind: 'DEDICATED_INTENT', deficit: walk },
      { kind: 'DEDICATED_INTENT', deficit: routeLike },
      { kind: 'GENERIC', deficits: [visit] },
    ]);
    expect(units.map(workUnitGeographicGrant)).toEqual([
      {
        kind: 'OWNED_INTENT',
        intent: 'walk',
        ownedDeficit: walk,
        workUnit: 'DEDICATED_INTENT',
      },
      {
        kind: 'OWNED_INTENT',
        intent: 'route_like',
        ownedDeficit: routeLike,
        workUnit: 'DEDICATED_INTENT',
      },
      { kind: 'NONE' },
    ]);
  });

  it('C: with one AREA anchor, walk and route_like each get their own AREA_ROUTE_WALK unit and grant', () => {
    const walk = walkDeficit();
    const routeLike = routeLikeDeficit();
    const theme = themeDeficit('wine');

    const units = partitionDeficitsIntoWorkUnits(
      [theme, routeLike, walk],
      [areaAnchor],
    );

    expect(units.map((unit) => unit.kind)).toEqual([
      'AREA_ROUTE_WALK',
      'AREA_ROUTE_WALK',
      'GENERIC',
    ]);
    expect(units.map(workUnitGeographicGrant)).toEqual([
      expect.objectContaining({
        intent: 'route_like',
        workUnit: 'AREA_ROUTE_WALK',
      }),
      expect.objectContaining({ intent: 'walk', workUnit: 'AREA_ROUTE_WALK' }),
      { kind: 'NONE' },
    ]);
  });

  it('never puts a walk/route_like deficit into the GENERIC unit, whatever the anchors', () => {
    const anchorSets: ResolvedAnchor[][] = [
      [],
      [areaAnchor],
      [routeAnchor],
      [venueAnchor],
      [areaAnchor, routeAnchor],
      [unresolvedNamedPathAnchor],
      [unresolvedIrrelevantAnchor],
    ];
    for (const anchors of anchorSets) {
      const units = partitionDeficitsIntoWorkUnits(
        [walkDeficit(), routeLikeDeficit(), themeDeficit('wine')],
        anchors,
      );
      for (const unit of units) {
        if (unit.kind !== 'GENERIC') continue;
        expect(
          unit.deficits.some(
            (deficit) =>
              deficit.origin === 'preference_facet' &&
              deficit.dimension === 'intent' &&
              (deficit.key === 'walk' || deficit.key === 'route_like'),
          ),
        ).toBe(false);
      }
    }
  });

  // Test D / I: generic and planner-capacity units grant nothing.
  it('D/I: GENERIC and PLANNER_CAPACITY units grant NONE even when route_like is open elsewhere', () => {
    const units = partitionDeficitsIntoWorkUnits(
      [routeLikeDeficit(), themeDeficit('wine')],
      [],
    );
    const generic = units.find((unit) => unit.kind === 'GENERIC')!;
    expect(workUnitGeographicGrant(generic)).toEqual({ kind: 'NONE' });
    expect(
      workUnitGeographicGrant({
        kind: 'PLANNER_CAPACITY',
        deficit: {
          origin: 'global_capacity',
          reason: 'Planner residual capacity',
          currentEligibleCount: 3,
          requiredEligibleCount: 4,
        },
      }),
    ).toEqual({ kind: 'NONE' });
  });

  it('returns no units for no deficits', () => {
    expect(partitionDeficitsIntoWorkUnits([], [areaAnchor])).toEqual([]);
  });
});
