import {
  AcquisitionDeficit,
  GlobalCapacityDeficit,
} from '../interfaces/experience-acquisition-plan.interface';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';
import {
  GeographicIntentDeficit,
  WorkUnitGeographicGrant,
} from '../interfaces/geographic-validation-authorization.interface';
import {
  isGeographicIntentDeficit,
  NO_GEOGRAPHIC_GRANT,
  ownedIntentGrant,
} from './geographic-validation-authorization.util';

/**
 * Cutover M3 + geographic-authorization contract
 * (docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md)
 * -- the ONE place deficits are assigned to acquisition work units. Every
 * open deficit has exactly one owner:
 *
 *   - `intent:walk` / `intent:route_like` + exactly one canonical area/route
 *     or unresolved named_path anchor -> its own `AREA_ROUTE_WALK` unit;
 *   - `intent:walk` / `intent:route_like` otherwise -> its own
 *     `DEDICATED_INTENT` unit (never coalesced into generic work, so its
 *     query, requested intents, evidence requirement and geographic grant
 *     all retain that one deficit's provenance);
 *   - every other deficit -> the single coalesced `GENERIC` unit.
 *
 * Planner residual capacity is its own explicit `PLANNER_CAPACITY` unit
 * (built by the planner backfill, never by this partition).
 *
 * Deficit objects are carried through untouched (never reconstructed).
 */
type CanonicalAreaRouteAnchor = Extract<
  ResolvedAnchor,
  { status: 'resolved' }
> & {
  kind: 'area' | 'route';
};
type UnresolvedNamedPathAnchor = Extract<
  ResolvedAnchor,
  { status: 'unresolved' }
> & {
  usage: 'named_path';
};
export type AreaRouteWalkAnchor =
  | { mode: 'canonical'; anchor: CanonicalAreaRouteAnchor }
  | { mode: 'tourism_route'; anchor: UnresolvedNamedPathAnchor };

export interface AreaRouteWalkWorkUnit {
  kind: 'AREA_ROUTE_WALK';
  deficit: GeographicIntentDeficit;
  anchor: CanonicalAreaRouteAnchor | UnresolvedNamedPathAnchor;
  anchorMode: AreaRouteWalkAnchor['mode'];
}

export interface DedicatedIntentWorkUnit {
  kind: 'DEDICATED_INTENT';
  deficit: GeographicIntentDeficit;
}

export interface GenericWorkUnit {
  kind: 'GENERIC';
  /** Never contains a GeographicIntentDeficit (enforced by the partition). */
  deficits: AcquisitionDeficit[];
}

export interface PlannerCapacityWorkUnit {
  kind: 'PLANNER_CAPACITY';
  deficit: GlobalCapacityDeficit;
}

export type AcquisitionWorkUnit =
  | AreaRouteWalkWorkUnit
  | DedicatedIntentWorkUnit
  | GenericWorkUnit
  | PlannerCapacityWorkUnit;

/** Per-deficit routing decision (one owner per deficit). */
export type AcquisitionStrategy =
  | AreaRouteWalkWorkUnit
  | DedicatedIntentWorkUnit
  | { kind: 'GENERIC'; deficit: AcquisitionDeficit };

/**
 * Deterministic, canonical-fact-only routing of ONE deficit. Reads only the
 * deficit's own origin/dimension/key and `PreferenceSpec.anchors` -- never
 * recomputes the deficit, never branches on provider, never inspects
 * candidate/catalog data. The AREA_ROUTE_WALK single-anchor precondition
 * (B5) is unchanged; a policy-bearing deficit that does not meet it (no
 * relevant anchor, or 2+ relevant anchors) is DEDICATED_INTENT, never
 * GENERIC. A `global_capacity` deficit is always GENERIC here.
 */
export function selectAcquisitionStrategy(
  deficit: AcquisitionDeficit,
  anchors: ResolvedAnchor[],
): AcquisitionStrategy {
  if (!isGeographicIntentDeficit(deficit)) {
    return { kind: 'GENERIC', deficit };
  }

  const relevantAnchors = anchors.filter(
    (anchor): anchor is CanonicalAreaRouteAnchor | UnresolvedNamedPathAnchor =>
      (anchor.status === 'resolved' &&
        (anchor.kind === 'area' || anchor.kind === 'route')) ||
      (anchor.status === 'unresolved' && anchor.usage === 'named_path'),
  );
  if (relevantAnchors.length !== 1) {
    return { kind: 'DEDICATED_INTENT', deficit };
  }

  return {
    kind: 'AREA_ROUTE_WALK',
    deficit,
    anchor: relevantAnchors[0],
    anchorMode:
      relevantAnchors[0].status === 'unresolved'
        ? 'tourism_route'
        : 'canonical',
  };
}

/**
 * Partitions one coverage pass's open deficits into acquisition work units:
 * one AREA_ROUTE_WALK or DEDICATED_INTENT unit per policy-bearing deficit,
 * then at most one GENERIC unit coalescing every other deficit. The
 * orchestrator's only entry point into deficit ownership.
 */
export function partitionDeficitsIntoWorkUnits(
  deficits: AcquisitionDeficit[],
  anchors: ResolvedAnchor[],
): AcquisitionWorkUnit[] {
  const owned: Array<AreaRouteWalkWorkUnit | DedicatedIntentWorkUnit> = [];
  const generic: AcquisitionDeficit[] = [];

  for (const deficit of deficits) {
    const strategy = selectAcquisitionStrategy(deficit, anchors);
    if (strategy.kind === 'GENERIC') generic.push(strategy.deficit);
    else owned.push(strategy);
  }

  return generic.length > 0
    ? [...owned, { kind: 'GENERIC', deficits: generic }]
    : owned;
}

/**
 * The geographic grant of a work unit: only a unit that exclusively owns a
 * policy-bearing deficit grants anything, and only that deficit's intent.
 */
export function workUnitGeographicGrant(
  unit: AcquisitionWorkUnit,
): WorkUnitGeographicGrant {
  switch (unit.kind) {
    case 'AREA_ROUTE_WALK':
    case 'DEDICATED_INTENT':
      return ownedIntentGrant(unit.kind, unit.deficit);
    case 'GENERIC':
    case 'PLANNER_CAPACITY':
      return NO_GEOGRAPHIC_GRANT;
  }
}

/** Every deficit a work unit owns, in order. */
export function workUnitDeficits(
  unit: AcquisitionWorkUnit,
): AcquisitionDeficit[] {
  return unit.kind === 'GENERIC' ? unit.deficits : [unit.deficit];
}
