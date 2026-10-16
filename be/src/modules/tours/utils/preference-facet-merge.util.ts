import { PreferenceAssertion } from '../preferences/preference-assertion.interface';
import { canonicalTargetKey } from '../preferences/preference-facet-vocabulary';

/**
 * The assertion a typed structured selection carries: the traveller chose a
 * typed domain option, so it is DIRECT by construction with no language
 * interpretation (not because of the channel). The request boundary already
 * rejects values outside the schema, so a value that is not a key here is a
 * pipeline error and fails explicitly; it is never dropped or translated.
 */
export function structuredSelectionAssertion(input: {
  field: string;
  dimension: string;
  key: string;
  polarity: PreferenceAssertion['polarity'];
  constraint: PreferenceAssertion['constraint'];
}): PreferenceAssertion {
  const key = canonicalTargetKey(input.dimension, input.key);
  if (!key || key !== input.key) {
    throw new InvalidStructuredSelectionError(
      input.field,
      input.dimension,
      input.key,
    );
  }
  return {
    target: {
      dimension: input.dimension as PreferenceAssertion['target']['dimension'],
      key,
    },
    polarity: input.polarity,
    constraint: input.constraint,
    provenance: 'DIRECT',
    importance: 1.0,
    confidence: 1.0,
    evidence: [
      { kind: 'STRUCTURED_SELECTION', field: input.field, value: input.key },
    ],
  };
}

/** A structured selection that is not a typed identifier of the schema. */
export class InvalidStructuredSelectionError extends Error {
  readonly outcome = 'INVALID_STRUCTURED_SELECTION' as const;
  readonly retryable = false;

  constructor(
    readonly field: string,
    readonly dimension: string,
    readonly value: string,
  ) {
    super(
      `INVALID_STRUCTURED_SELECTION: ${field} value is not a ${dimension} identifier of the active facet schema`,
    );
    this.name = 'InvalidStructuredSelectionError';
  }
}
