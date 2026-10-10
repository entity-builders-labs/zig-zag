import { computeQualityScore, QualityScoreInput } from './quality-score.util';
import { DEFAULT_QUALITY_FLOOR } from './preference-strong-match.util';

describe('quality-score.util', () => {
  describe('computeQualityScore', () => {
    it('returns null when there are zero usable grounded signals', () => {
      expect(computeQualityScore({})).toBeNull();
    });

    it('never throws on a runtime-unknown input and returns null', () => {
      expect(() => computeQualityScore(null as any)).not.toThrow();
      expect(computeQualityScore(null as any)).toBeNull();
      expect(computeQualityScore(undefined as any)).toBeNull();
      expect(computeQualityScore('bad' as any)).toBeNull();
    });

    describe('Places rating + review-count confidence', () => {
      it('scores the same high rating higher with many reviews than with two reviews', () => {
        const fewReviews = computeQualityScore({
          placesRating: 4.5,
          placesReviewCount: 2,
        });
        const manyReviews = computeQualityScore({
          placesRating: 4.5,
          placesReviewCount: 100_000,
        });

        expect(fewReviews).not.toBeNull();
        expect(manyReviews).not.toBeNull();
        expect(manyReviews as number).toBeGreaterThan(fewReviews as number);
        // Concrete values for the shrinkage-toward-neutral-prior policy.
        expect(fewReviews).toBeCloseTo(2.818, 2);
        expect(manyReviews).toBeCloseTo(4.5, 2);
      });

      it('trusts the raw rating as-is when review-count data is entirely absent (never shrinks with no confidence signal)', () => {
        const result = computeQualityScore({ placesRating: 4.2 });
        expect(result).toBe(4.2);
      });

      it('treats an explicit review count of zero as real (low-confidence) evidence, not missing data', () => {
        const result = computeQualityScore({
          placesRating: 4.5,
          placesReviewCount: 0,
        });
        // Zero confidence -> fully shrunk to the neutral prior.
        expect(result).toBeCloseTo(2.5, 2);
      });

      it('treats a missing rating as unknown, never as a rating of zero', () => {
        const withOnlyReviewCount = computeQualityScore({
          placesReviewCount: 5000,
        });
        expect(withOnlyReviewCount).toBeNull();
      });

      it('ignores an out-of-range or malformed rating rather than coercing it', () => {
        expect(computeQualityScore({ placesRating: -1 })).toBeNull();
        expect(computeQualityScore({ placesRating: 9.9 })).toBeNull();
        expect(computeQualityScore({ placesRating: NaN })).toBeNull();
        expect(computeQualityScore({ placesRating: 'good' as any })).toBeNull();
      });
    });

    describe('Wikivoyage / Wikidata signals (no Places data required)', () => {
      it('produces a non-null quality score from Wikivoyage alone, with no Places data at all', () => {
        const result = computeQualityScore({ wikivoyageListed: true });
        expect(result).not.toBeNull();
      });

      it('produces a non-null quality score from a Wikidata sitelink count alone, with no Places data at all', () => {
        const result = computeQualityScore({ wikidataSitelinkCount: 100 });
        expect(result).not.toBeNull();
        expect(result).toBeCloseTo(4.117, 2);
      });

      it('a higher Wikidata sitelink count produces a higher (or equal) quality than a lower one', () => {
        const few = computeQualityScore({ wikidataSitelinkCount: 5 });
        const many = computeQualityScore({ wikidataSitelinkCount: 100 });
        expect(many as number).toBeGreaterThan(few as number);
      });

      it('wikivoyageListed: false / null contributes nothing (not a negative signal)', () => {
        expect(computeQualityScore({ wikivoyageListed: false })).toBeNull();
        expect(computeQualityScore({ wikivoyageListed: null })).toBeNull();
      });
    });

    describe('component-derived quality (multi-component Experience, no direct rating)', () => {
      it('a walk with no direct rating but several high-quality grounded components clears the quality floor', () => {
        const result = computeQualityScore({
          componentQualityScores: [4.5, 4.7, 4.2],
        });
        expect(result).not.toBeNull();
        expect(result as number).toBeGreaterThanOrEqual(DEFAULT_QUALITY_FLOOR);
        expect(result).toBeCloseTo(4.467, 2);
      });

      it('ignores a null entry in componentQualityScores as "no signal for that component", never as zero', () => {
        const withNull = computeQualityScore({
          componentQualityScores: [4.5, null, 4.5],
        });
        const withoutNull = computeQualityScore({
          componentQualityScores: [4.5, 4.5],
        });
        expect(withNull).toBeCloseTo(withoutNull as number, 5);
      });

      it('never throws on malformed componentQualityScores/componentNotabilitySignals entries and drops them', () => {
        const result = computeQualityScore({
          componentQualityScores: ['bad', {}, undefined] as any,
          componentNotabilitySignals: ['bad', -5, NaN] as any,
        });
        expect(result).toBeNull();
      });

      it('componentNotabilitySignals alone (no componentQualityScores) can also produce a non-null quality', () => {
        const result = computeQualityScore({
          componentNotabilitySignals: [50, 80],
        });
        expect(result).not.toBeNull();
      });

      it('direct componentQualityScores take precedence over componentNotabilitySignals -- notability never double-counts alongside valid direct scores', () => {
        const directOnly = computeQualityScore({
          componentQualityScores: [3.2, 3.2],
        });
        const directPlusNotability = computeQualityScore({
          componentQualityScores: [3.2, 3.2],
          // Low notability signals that would previously drag the mixed
          // average down below the quality floor if double-counted.
          componentNotabilitySignals: [0, 0],
        });

        expect(directOnly).not.toBeNull();
        expect(directPlusNotability).not.toBeNull();
        expect(directPlusNotability).toBeCloseTo(directOnly as number, 5);
        expect(directOnly as number).toBeGreaterThanOrEqual(
          DEFAULT_QUALITY_FLOOR,
        );
        expect(directPlusNotability as number).toBeGreaterThanOrEqual(
          DEFAULT_QUALITY_FLOOR,
        );
      });

      it('componentNotabilitySignals remains a real fallback when there is no valid direct component quality at all', () => {
        const result = computeQualityScore({
          componentQualityScores: [null, null],
          componentNotabilitySignals: [50, 80],
        });
        expect(result).not.toBeNull();
      });

      it('malformed direct component scores do not block a valid notability fallback', () => {
        const result = computeQualityScore({
          componentQualityScores: ['bad', null] as any,
          componentNotabilitySignals: [50, 80],
        });
        expect(result).not.toBeNull();
      });

      it('valid direct componentQualityScores take precedence even when componentNotabilitySignals would score higher -- notability neither boosts nor penalizes valid direct quality', () => {
        const direct = computeQualityScore({
          componentQualityScores: [3.4, 3.6],
        });
        const combinedInput = computeQualityScore({
          componentQualityScores: [3.4, 3.6],
          componentNotabilitySignals: [300, 300],
        });

        expect(combinedInput).toBe(direct);
      });
    });

    describe('Geoapify-shaped input (rating/review count genuinely unavailable, not zero)', () => {
      const geoapifyShaped: QualityScoreInput = {
        placesRating: undefined,
        placesReviewCount: undefined,
      };

      it('produces a non-null quality from Wikivoyage/Wikidata evidence even with no Places rating at all', () => {
        const result = computeQualityScore({
          ...geoapifyShaped,
          wikivoyageListed: true,
        });
        expect(result).not.toBeNull();
      });

      it('produces a non-null quality from strong component evidence, clearing the quality floor, with no Places rating at all', () => {
        const result = computeQualityScore({
          ...geoapifyShaped,
          componentQualityScores: [4.8, 4.6],
        });
        expect(result).not.toBeNull();
        expect(result as number).toBeGreaterThanOrEqual(DEFAULT_QUALITY_FLOOR);
      });

      it('returns null (never a penalty or a synthetic default) when there is no other usable grounded evidence', () => {
        expect(computeQualityScore(geoapifyShaped)).toBeNull();
      });

      it('scores identically whether the unsupported Places fields are omitted entirely or present as explicit undefined', () => {
        const omitted = computeQualityScore({ wikivoyageListed: true });
        const explicitUndefined = computeQualityScore({
          placesRating: undefined,
          placesReviewCount: undefined,
          wikivoyageListed: true,
        });
        expect(explicitUndefined).toBe(omitted);
      });

      it('is unaffected by an extra provider-identifying field -- the util never branches on a provider name', () => {
        const withoutProviderField = computeQualityScore({
          wikivoyageListed: true,
        });
        const withProviderField = computeQualityScore({
          wikivoyageListed: true,
          placesProvider: 'geoapify',
        } as any);
        expect(withProviderField).toBe(withoutProviderField);
      });
    });

    describe('combining independent signals', () => {
      it('missing one signal does not erase valid signals from another source', () => {
        const wikiOnly = computeQualityScore({ wikivoyageListed: true });
        const wikiPlusMissingPlaces = computeQualityScore({
          placesRating: undefined,
          placesReviewCount: undefined,
          wikivoyageListed: true,
        });
        expect(wikiPlusMissingPlaces).toBe(wikiOnly);
      });

      it('blends multiple present signals into a single score bounded by their individual values', () => {
        const placesOnly = computeQualityScore({
          placesRating: 4.0,
          placesReviewCount: 100_000,
        }) as number;
        const wikivoyageOnly = computeQualityScore({
          wikivoyageListed: true,
        }) as number;
        const combined = computeQualityScore({
          placesRating: 4.0,
          placesReviewCount: 100_000,
          wikivoyageListed: true,
        }) as number;

        expect(combined).not.toBeNull();
        expect(combined).toBeGreaterThanOrEqual(
          Math.min(placesOnly, wikivoyageOnly),
        );
        expect(combined).toBeLessThanOrEqual(
          Math.max(placesOnly, wikivoyageOnly),
        );
      });

      it('never assigns a flat magic score to a multi-component Experience -- the result tracks its actual component evidence', () => {
        const strongComponents = computeQualityScore({
          componentQualityScores: [4.9, 4.8],
        }) as number;
        const weakComponents = computeQualityScore({
          componentQualityScores: [2.0, 2.1],
        }) as number;
        expect(strongComponents).toBeGreaterThan(weakComponents);
      });
    });
  });
});
