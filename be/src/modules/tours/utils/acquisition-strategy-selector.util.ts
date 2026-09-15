import {
  AcquisitionDeficit,
  PreferenceFacetDeficit,
} from '../interfaces/experience-acquisition-plan.interface';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';

/**
 * Cutover M3 (spec §5 Q5/Q10) -- the ONE place anchor-kind/facet-key
 * combination logic lives for acquisition routing. Never duplicated inline
 * in the orchestrator's acquisition loop.
 *
 * `AREA_ROUTE_WALK` carries the ORIGINAL `PreferenceFacetDeficit` object
 * untouched (never reconstructed) plus the single relevant anchor;
 * `GENERIC` carries the original `AcquisitionDeficit` (of either variant)
 * untouched.
 */
export type AreaRouteWalkIntentKey = 'walk' | 'route_like';

export type AcquisitionStrategy =
  | {
      kind: 'AREA_ROUTE_WALK';
      deficit: PreferenceFacetDeficit;
      anchor: ResolvedAnchor;
      /**
       * Narrowed once, here -- the ONE place that reads `deficit.key` as a
       * specific area/route intent. Callers never re-derive or cast it.
       */
      intentKey: AreaRouteWalkIntentKey;
    }
  | { kind: 'GENERIC'; deficit: AcquisitionDeficit };

const AREA_ROUTE_WALK_INTENT_KEYS: ReadonlySet<string> =
  new Set<AreaRouteWalkIntentKey>(['walk', 'route_like']);

/**
 * Deterministic, canonical-fact-only acquisition-strategy selection.
 * Reads ONLY this one deficit's own `dimension`/`key` and
 * `PreferenceSpec.anchors` -- never recomputes/reinterprets the deficit,
 * never branches on provider, never inspects candidate/catalog data, never
 * consults anything but the two canonical facts passed in.
 *
 * A deficit routes through `AreaRouteWalkAcquisitionService` iff:
 *   - it is a real `preference_facet` deficit for `intent:walk` or
 *     `intent:route_like` (never a `global_capacity` deficit -- that
 *     variant is deliberately dimensionless and must never be routed
 *     through an anchor-specific strategy), AND
 *   - `anchors` contains EXACTLY ONE anchor of kind `area`/`route` (B5's
 *     own documented single-anchor precondition -- mode D, 2+ relevant
 *     anchors for one deficit, is not handled by this primitive and falls
 *     through to generic acquisition unchanged, per the plan's own
 *     non-goals).
 *
 * Every other deficit (any other `preference_facet` dimension/key, and
 * every `global_capacity` deficit) is `GENERIC`.
 */
export function selectAcquisitionStrategy(
  deficit: AcquisitionDeficit,
  anchors: ResolvedAnchor[],
): AcquisitionStrategy {
  if (deficit.origin !== 'preference_facet') {
    return { kind: 'GENERIC', deficit };
  }
  if (
    deficit.dimension !== 'intent' ||
    !AREA_ROUTE_WALK_INTENT_KEYS.has(deficit.key)
  ) {
    return { kind: 'GENERIC', deficit };
  }

  const relevantAnchors = anchors.filter(
    (anchor) => anchor.kind === 'area' || anchor.kind === 'route',
  );
  if (relevantAnchors.length !== 1) {
    return { kind: 'GENERIC', deficit };
  }

  return {
    kind: 'AREA_ROUTE_WALK',
    deficit,
    anchor: relevantAnchors[0],
    intentKey: deficit.key as AreaRouteWalkIntentKey,
  };
}

/**
 * Partitions a full deficit list (one coverage pass) by strategy, composing
 * `selectAcquisitionStrategy` per deficit -- the orchestrator's only entry
 * point into strategy selection.
 */
export interface AreaRouteWalkRoutedDeficit {
  deficit: PreferenceFacetDeficit;
  anchor: ResolvedAnchor;
  intentKey: AreaRouteWalkIntentKey;
}

export function partitionDeficitsByStrategy(
  deficits: AcquisitionDeficit[],
  anchors: ResolvedAnchor[],
): {
  areaRouteWalk: AreaRouteWalkRoutedDeficit[];
  generic: AcquisitionDeficit[];
} {
  const areaRouteWalk: AreaRouteWalkRoutedDeficit[] = [];
  const generic: AcquisitionDeficit[] = [];

  for (const deficit of deficits) {
    const strategy = selectAcquisitionStrategy(deficit, anchors);
    if (strategy.kind === 'AREA_ROUTE_WALK') {
      areaRouteWalk.push({
        deficit: strategy.deficit,
        anchor: strategy.anchor,
        intentKey: strategy.intentKey,
      });
    } else {
      generic.push(strategy.deficit);
    }
  }

  return { areaRouteWalk, generic };
}
