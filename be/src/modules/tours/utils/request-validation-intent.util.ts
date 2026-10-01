import { RequestedFacet } from '../interfaces/preference-spec.interface';

/**
 * The geographic validation intent a tour REQUEST authorizes
 * (`ExperienceResolutionRequest.validationIntent`). It selects a threshold
 * policy (e.g. route-scale destination compatibility) downstream.
 */
export type RequestValidationIntent = 'walk' | 'route_like';

export type RequestValidationIntentDecision =
  | { status: 'NONE' }
  | { status: 'SINGLE'; intent: RequestValidationIntent }
  /**
   * The request carries both `walk` and `route_like`. No authoritative
   * policy chooses between them, so it fails closed: no validation intent,
   * hence no route-scale relaxation.
   */
  | { status: 'MIXED_UNSUPPORTED' };

/**
 * Derives the request-level geographic validation intent ONCE from the
 * normalized request preference (`PreferenceSpec.facets`).
 *
 * Authority is the request, never acquisition-strategy partitioning (a
 * strategy-local plan may not carry the request's intent deficit) and never
 * candidate self-description (extracted `intents` must not widen a
 * candidate's own geographic scope).
 */
export function deriveRequestValidationIntent(
  facets: ReadonlyArray<Pick<RequestedFacet, 'dimension' | 'key'>>,
): RequestValidationIntentDecision {
  const intents = new Set(
    facets
      .filter((facet) => facet.dimension === 'intent')
      .map((facet) => facet.key),
  );
  const route = intents.has('route_like');
  const walk = intents.has('walk');
  if (route && walk) return { status: 'MIXED_UNSUPPORTED' };
  if (route) return { status: 'SINGLE', intent: 'route_like' };
  if (walk) return { status: 'SINGLE', intent: 'walk' };
  return { status: 'NONE' };
}

export function validationIntentOf(
  decision: RequestValidationIntentDecision,
): RequestValidationIntent | undefined {
  return decision.status === 'SINGLE' ? decision.intent : undefined;
}
