import {
  InvalidStructuredSelectionError,
  structuredSelectionAssertion,
} from './preference-facet-merge.util';

describe('structuredSelectionAssertion', () => {
  it('turns a typed structured selection into a DIRECT assertion with its selection as evidence', () => {
    expect(
      structuredSelectionAssertion({
        field: 'intent.interests',
        dimension: 'theme',
        key: 'history',
        polarity: 'INCLUDE',
        constraint: 'SOFT',
      }),
    ).toEqual({
      target: { dimension: 'theme', key: 'history' },
      polarity: 'INCLUDE',
      constraint: 'SOFT',
      provenance: 'DIRECT',
      importance: 1,
      confidence: 1,
      evidence: [
        {
          kind: 'STRUCTURED_SELECTION',
          field: 'intent.interests',
          value: 'history',
        },
      ],
    });
  });

  it('accepts only the exact typed identifier: no recasing or separator rewriting', () => {
    expect(() =>
      structuredSelectionAssertion({
        field: 'intent.intents',
        dimension: 'intent',
        key: 'Day-Trip',
        polarity: 'INCLUDE',
        constraint: 'SOFT',
      }),
    ).toThrow(InvalidStructuredSelectionError);
  });

  it.each([
    // Localized words and synonyms are never translated to schema keys.
    ['theme', 'arquitectura'],
    ['theme', 'historia'],
    ['intent', 'caminata'],
    ['theme', 'not-a-key'],
    // Open and meta dimensions are not assertion targets.
    ['trait', 'quiet'],
    ['exploration_style', 'iconic'],
    ['unknown_dimension', 'history'],
  ])(
    'fails explicitly for %s:%s, which is not a key of the typed schema (never dropped)',
    (dimension, key) => {
      expect(() =>
        structuredSelectionAssertion({
          field: 'intent.interests',
          dimension,
          key,
          polarity: 'INCLUDE',
          constraint: 'SOFT',
        }),
      ).toThrow(/INVALID_STRUCTURED_SELECTION/);
    },
  );

  it('keeps the polarity and constraint the structured field declares', () => {
    expect(
      structuredSelectionAssertion({
        field: 'dietaryRestrictions',
        dimension: 'dietary_suitability',
        key: 'vegan',
        polarity: 'INCLUDE',
        constraint: 'HARD',
      }),
    ).toEqual(
      expect.objectContaining({
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        polarity: 'INCLUDE',
        constraint: 'HARD',
        provenance: 'DIRECT',
      }),
    );
  });
});
