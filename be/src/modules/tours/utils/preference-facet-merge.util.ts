import { PreferenceAssertion } from '../preferences/preference-assertion.interface';
import { canonicalTargetKey } from '../preferences/preference-facet-vocabulary';

/**
 * The assertion a typed structured selection carries: the traveller chose a
 * typed domain option, so it is DIRECT by construction with no language
 * interpretation (not because of the channel). Returns undefined when the
 * value is not a key of the schema; nothing is translated.
 */
export function structuredSelectionAssertion(input: {
  field: string;
  dimension: string;
  key: string;
  polarity: PreferenceAssertion['polarity'];
  constraint: PreferenceAssertion['constraint'];
}): PreferenceAssertion | undefined {
  const key = canonicalTargetKey(input.dimension, input.key);
  if (!key) return undefined;
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
