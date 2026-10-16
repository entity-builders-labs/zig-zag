import { RequestedFacet } from '../interfaces/preference-spec.interface';
import { PreferenceProvenance } from '../preferences/preference-assertion.interface';
import { AssertionTargetDimension } from '../preferences/preference-facet-vocabulary';

/**
 * A SOFT INCLUDE facet as the spec builder projects it. Provenance,
 * importance and confidence are explicit.
 */
export function requestedFacetFixture(input: {
  dimension: AssertionTargetDimension;
  key: string;
  provenance: PreferenceProvenance;
  importance: number;
  confidence: number;
}): RequestedFacet {
  return {
    dimension: input.dimension,
    key: input.key,
    provenance: input.provenance,
    importance: input.importance,
    confidence: input.confidence,
    evidence:
      input.provenance === 'DIRECT'
        ? [
            {
              kind: 'STRUCTURED_SELECTION',
              field: 'fixture',
              value: input.key,
            },
          ]
        : [{ kind: 'USER_TEXT_SPAN', text: input.key }],
    required: false,
  };
}

/** A structured selection: DIRECT, importance and confidence 1. */
export function selectedFacetFixture(
  dimension: AssertionTargetDimension,
  key: string,
): RequestedFacet {
  return requestedFacetFixture({
    dimension,
    key,
    provenance: 'DIRECT',
    importance: 1,
    confidence: 1,
  });
}
