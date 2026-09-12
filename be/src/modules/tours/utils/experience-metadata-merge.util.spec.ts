import {
  mergeExperienceMetadata,
  ExperienceMetadataSnapshot,
} from './experience-metadata-merge.util';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from '../services/experience-classification.service';

/** Deep-equal both call orders and require them to be identical. */
function expectOrderIndependent(
  a: ExperienceMetadataSnapshot,
  b: ExperienceMetadataSnapshot,
) {
  const ab = mergeExperienceMetadata(a, b);
  const ba = mergeExperienceMetadata(b, a);
  expect(ab).toEqual(ba);
  return ab;
}

describe('experience-metadata-merge.util', () => {
  describe('order independence (merge(A,B) === merge(B,A))', () => {
    it('converges for two Places-observation-shaped bundles regardless of order', () => {
      const a: ExperienceMetadataSnapshot = {
        qualityScore: 4.2,
        metadata: {
          themes: ['history'],
          intents: ['visit'],
          traits: ['rooftop'],
          source: 'google_places_acquisition',
        },
      };
      const b: ExperienceMetadataSnapshot = {
        qualityScore: 3.1,
        metadata: {
          themes: ['architecture'],
          intents: [],
          traits: ['craft beer'],
          source: 'wikivoyage_acquisition',
        },
      };

      const merged = expectOrderIndependent(a, b);
      expect(merged.qualityScore).toBe(4.2);
      expect(merged.metadata.themes).toEqual(['architecture', 'history']);
      expect(merged.metadata.intents).toEqual(['visit']);
      expect(merged.metadata.traits).toEqual(['craft beer', 'rooftop']);
    });

    it('converges when one side has empty/absent metadata entirely', () => {
      const a: ExperienceMetadataSnapshot = { metadata: {} };
      const b: ExperienceMetadataSnapshot = {
        qualityScore: 3.5,
        metadata: { themes: ['food'], traits: ['family friendly'] },
      };

      const merged = expectOrderIndependent(a, b);
      expect(merged.qualityScore).toBe(3.5);
      expect(merged.metadata.themes).toEqual(['food']);
      expect(merged.metadata.traits).toEqual(['family friendly']);
    });

    it('converges with three overlapping observations merged pairwise in both directions', () => {
      const a: ExperienceMetadataSnapshot = {
        metadata: { themes: ['history', 'culture'], traits: ['rooftop'] },
      };
      const b: ExperienceMetadataSnapshot = {
        metadata: { themes: ['culture'], traits: ['ROOFTOP', 'tango'] },
      };

      const merged = expectOrderIndependent(a, b);
      expect(merged.metadata.themes).toEqual(['culture', 'history']);
      // "ROOFTOP" and "rooftop" are the same trait -- deduped, not doubled.
      expect(merged.metadata.traits).toEqual(['rooftop', 'tango']);
    });
  });

  describe('union rules for themes/intents/traits', () => {
    it('unions themes and intents from both sides, deduped', () => {
      const merged = mergeExperienceMetadata(
        { metadata: { themes: ['history'], intents: ['visit'] } },
        { metadata: { themes: ['history', 'food'], intents: ['walk'] } },
      );
      expect(merged.metadata.themes).toEqual(['food', 'history']);
      expect(merged.metadata.intents).toEqual(['visit', 'walk']);
    });

    it('reads legacy metadata.archetypes as an intents fallback, but never re-emits archetypes itself', () => {
      const merged = mergeExperienceMetadata(
        { metadata: { archetypes: ['walk'] } },
        { metadata: { intents: ['visit'] } },
      );
      expect(merged.metadata.intents).toEqual(['visit', 'walk']);
      expect(merged.metadata.archetypes).toBeUndefined();
    });

    it('dedupes traits case/whitespace-insensitively using the same normalization as the classifier', () => {
      const merged = mergeExperienceMetadata(
        { metadata: { traits: ['  Craft   Beer  '] } },
        { metadata: { traits: ['craft beer', 'rooftop'] } },
      );
      expect(merged.metadata.traits).toEqual(['craft beer', 'rooftop']);
    });

    it('never throws on malformed/non-array themes/intents/traits and treats them as absent', () => {
      const merged = mergeExperienceMetadata(
        { metadata: { themes: 'not-an-array' as any, traits: null as any } },
        { metadata: { intents: 42 as any } },
      );
      expect(merged.metadata.themes).toBeUndefined();
      expect(merged.metadata.intents).toBeUndefined();
      expect(merged.metadata.traits).toBeUndefined();
    });
  });

  describe('no invented trait dimensions', () => {
    it('never manufactures a dimensionedTraits entry from a plain traits[] string, even one that names a real dimension key', () => {
      // "iconic" is a real exploration_style/tourism_intensity vocabulary
      // value, but the classifier does not emit a dimension taxonomy in
      // v1 -- it must remain a plain freeform trait after merge, never get
      // promoted into structured dimensionedTraits.
      const merged = mergeExperienceMetadata(
        { metadata: { traits: ['iconic'] } },
        { metadata: { traits: ['local_deep_dive'] } },
      );
      expect(merged.metadata.traits).toEqual(['iconic', 'local_deep_dive']);
      expect(merged.metadata.dimensionedTraits).toBeUndefined();
    });

    it('preserves explicit dimensionedTraits verbatim from either side (a trusted source already supplied them), unioned and deduped by dimension+key', () => {
      const merged = mergeExperienceMetadata(
        {
          metadata: {
            dimensionedTraits: [
              { dimension: 'tourism_intensity', key: 'iconic' },
            ],
          },
        },
        {
          metadata: {
            dimensionedTraits: [
              { dimension: 'tourism_intensity', key: 'iconic' },
              { dimension: 'local_character', key: 'authentic' },
            ],
          },
        },
      );
      expect(merged.metadata.dimensionedTraits).toEqual([
        { dimension: 'local_character', key: 'authentic' },
        { dimension: 'tourism_intensity', key: 'iconic' },
      ]);
    });

    it('drops a malformed dimensionedTraits entry rather than inventing one from it', () => {
      const merged = mergeExperienceMetadata(
        {
          metadata: {
            dimensionedTraits: ['bad', {}, { dimension: 42 }] as any,
          },
        },
        { metadata: {} },
      );
      expect(merged.metadata.dimensionedTraits).toBeUndefined();
    });
  });

  describe('quality: strongest valid signal, order-independent', () => {
    it('keeps the higher of two valid qualityScores regardless of order', () => {
      const merged = mergeExperienceMetadata(
        { qualityScore: 2.5, metadata: {} },
        { qualityScore: 4.1, metadata: {} },
      );
      expect(merged.qualityScore).toBe(4.1);
      expect(
        mergeExperienceMetadata(
          { qualityScore: 4.1, metadata: {} },
          { qualityScore: 2.5, metadata: {} },
        ).qualityScore,
      ).toBe(4.1);
    });

    it('treats a missing qualityScore as unknown, never as 0, and keeps the other valid one', () => {
      expect(
        mergeExperienceMetadata(
          { qualityScore: null, metadata: {} },
          { qualityScore: 3.8, metadata: {} },
        ).qualityScore,
      ).toBe(3.8);
      expect(
        mergeExperienceMetadata(
          { metadata: {} },
          { qualityScore: 3.8, metadata: {} },
        ).qualityScore,
      ).toBe(3.8);
    });

    it('is null when neither side has a valid qualityScore', () => {
      expect(
        mergeExperienceMetadata({ metadata: {} }, { metadata: {} })
          .qualityScore,
      ).toBeNull();
    });
  });

  describe('classification: version-aware replacement, never arbitrary provider order', () => {
    const currentClassified = {
      themes: ['history'],
      intents: [] as string[],
      traits: [] as string[],
      reasoningEvidence: [
        { facet: 'theme:history', evidenceKeys: ['ev-1'], reason: 'x' },
      ],
      modelId: 'groq-classify-test',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'classified',
    };
    const staleClassified = {
      ...currentClassified,
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION - 1,
    };
    const currentDegraded = {
      themes: [] as string[],
      intents: [] as string[],
      traits: [] as string[],
      reasoningEvidence: [] as unknown[],
      modelId: 'groq-classify-test',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'degraded',
    };

    it('a current, valid classification wins over a stale-prompt-version one, regardless of order', () => {
      const merged = expectOrderIndependent(
        { metadata: { classification: staleClassified } },
        { metadata: { classification: currentClassified } },
      );
      expect(merged.metadata.classification).toEqual(currentClassified);
    });

    it('a current classification wins over an absent one, regardless of order', () => {
      const merged = expectOrderIndependent(
        { metadata: {} },
        { metadata: { classification: currentClassified } },
      );
      expect(merged.metadata.classification).toEqual(currentClassified);
    });

    it('a current classified result wins over a current degraded one, regardless of order', () => {
      const merged = expectOrderIndependent(
        { metadata: { classification: currentDegraded } },
        { metadata: { classification: currentClassified } },
      );
      expect(merged.metadata.classification).toEqual(currentClassified);
    });

    it('a current degraded result is still kept over an absent/stale one (so a later reclassification job can repair it)', () => {
      const merged = expectOrderIndependent(
        { metadata: { classification: staleClassified } },
        { metadata: { classification: currentDegraded } },
      );
      expect(merged.metadata.classification).toEqual(currentDegraded);
    });

    it('never invents/leaks internal fields between two different classification objects -- the winner is kept atomic, never merged field-by-field', () => {
      const otherCurrentClassified = {
        themes: ['food'],
        intents: ['visit'],
        traits: [] as string[],
        reasoningEvidence: [
          { facet: 'theme:food', evidenceKeys: ['ev-2'], reason: 'y' },
          { facet: 'intent:visit', evidenceKeys: ['ev-2'], reason: 'y' },
        ],
        modelId: 'groq-classify-test',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      };
      const merged = expectOrderIndependent(
        { metadata: { classification: currentClassified } },
        { metadata: { classification: otherCurrentClassified } },
      );
      // Whichever wins, it must be EXACTLY one of the two original objects,
      // never a hybrid with e.g. themes from one and intents from the other.
      expect([currentClassified, otherCurrentClassified]).toContainEqual(
        merged.metadata.classification,
      );
    });

    it('is absent from the output when neither side has a well-formed current classification', () => {
      const merged = expectOrderIndependent(
        { metadata: { classification: staleClassified } },
        { metadata: { classification: 'garbage' as any } },
      );
      expect(merged.metadata.classification).toBeUndefined();
    });
  });

  describe('generic unknown scalar fields (richer non-empty wins over empty, symmetric)', () => {
    it('takes the non-empty side when the other is absent', () => {
      const merged = expectOrderIndependent(
        { metadata: { source: 'google_places_acquisition' } },
        { metadata: {} },
      );
      expect(merged.metadata.source).toBe('google_places_acquisition');
    });

    it('keeps an identical value on both sides without conflict', () => {
      const merged = expectOrderIndependent(
        { metadata: { customFlag: 'same' } },
        { metadata: { customFlag: 'same' } },
      );
      expect(merged.metadata.customFlag).toBe('same');
    });

    it('resolves two different non-empty values deterministically, the same way regardless of order', () => {
      const merged = expectOrderIndependent(
        { metadata: { source: 'a_short_one' } },
        { metadata: { source: 'a_much_longer_and_richer_value' } },
      );
      expect(merged.metadata.source).toBe('a_much_longer_and_richer_value');
    });
  });

  describe('never throws on runtime-unknown input', () => {
    it('handles completely malformed snapshots without throwing', () => {
      expect(() =>
        mergeExperienceMetadata(null as any, undefined as any),
      ).not.toThrow();
      const merged = mergeExperienceMetadata(null as any, undefined as any);
      expect(merged.qualityScore).toBeNull();
      expect(merged.metadata).toEqual({});
    });

    it('handles a non-object metadata value without throwing', () => {
      expect(() =>
        mergeExperienceMetadata(
          { metadata: 'garbage' as any },
          { metadata: 42 as any },
        ),
      ).not.toThrow();
    });
  });
});
