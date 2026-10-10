import * as fs from 'fs';
import * as path from 'path';
import * as explorationSignalsModule from './exploration-signals.util';
import {
  computeExplorationSignals,
  computeExplorationTilt,
  EvidenceBackedExplorationSignal,
  ExplorationSignalInput,
  ExplorationSignals,
} from './exploration-signals.util';

describe('exploration-signals.util', () => {
  describe('computeExplorationSignals — prominence', () => {
    it('scores more reviews higher than fewer reviews, all else equal', () => {
      const few = computeExplorationSignals({ placesReviewCount: 50 });
      const many = computeExplorationSignals({ placesReviewCount: 500 });

      expect(few.prominence.value).not.toBeNull();
      expect(many.prominence.value).not.toBeNull();
      expect(many.prominence.value!).toBeGreaterThan(few.prominence.value!);
    });

    it('saturates for huge review counts: 50000 vs 50100 moves far less than 50 vs 100', () => {
      const low1 = computeExplorationSignals({ placesReviewCount: 50 });
      const low2 = computeExplorationSignals({ placesReviewCount: 100 });
      const high1 = computeExplorationSignals({ placesReviewCount: 50_000 });
      const high2 = computeExplorationSignals({ placesReviewCount: 50_100 });

      const lowDelta = Math.abs(
        low2.prominence.value! - low1.prominence.value!,
      );
      const highDelta = Math.abs(
        high2.prominence.value! - high1.prominence.value!,
      );

      expect(highDelta).toBeLessThan(lowDelta);
    });

    it('increases prominence as Wikidata sitelink count increases', () => {
      const few = computeExplorationSignals({ wikidataSitelinkCount: 5 });
      const many = computeExplorationSignals({ wikidataSitelinkCount: 100 });

      expect(many.prominence.value!).toBeGreaterThan(few.prominence.value!);
    });

    it('gives Wikipedia/Wikivoyage/heritage each a modest, independent contribution', () => {
      const none = computeExplorationSignals({ placesReviewCount: 100 });
      const withWikipedia = computeExplorationSignals({
        placesReviewCount: 100,
        wikipediaPresent: true,
      });
      const withWikivoyage = computeExplorationSignals({
        placesReviewCount: 100,
        wikivoyageListed: true,
      });
      const withHeritage = computeExplorationSignals({
        placesReviewCount: 100,
        heritageOrLandmark: true,
      });

      expect(withWikipedia.prominence.value!).toBeGreaterThan(
        none.prominence.value!,
      );
      expect(withWikivoyage.prominence.value!).toBeGreaterThan(
        none.prominence.value!,
      );
      expect(withHeritage.prominence.value!).toBeGreaterThan(
        none.prominence.value!,
      );

      // Heritage alone must not force a near-1 score.
      const heritageOnly = computeExplorationSignals({
        heritageOrLandmark: true,
      });
      expect(heritageOnly.prominence.value!).toBeLessThan(0.5);
    });

    it('returns value:null when no prominence evidence exists at all', () => {
      const result = computeExplorationSignals({});
      expect(result.prominence.value).toBeNull();
      expect(result.prominence.evidence).toEqual([]);
      expect(result.prominence.reasonCodes).toContain('no_prominence_evidence');
    });

    it('sanitizes corrupt counts (NaN, Infinity, negative) safely instead of producing an invalid score', () => {
      const nan = computeExplorationSignals({ placesReviewCount: NaN });
      const inf = computeExplorationSignals({ placesReviewCount: Infinity });
      const negative = computeExplorationSignals({ placesReviewCount: -5 });

      for (const result of [nan, inf, negative]) {
        expect(result.prominence.value).toBeNull();
        expect(Number.isFinite(result.prominence.confidence)).toBe(true);
        expect(result.prominence.confidence).toBeGreaterThanOrEqual(0);
        expect(result.prominence.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('computeExplorationSignals — tourismIntensity', () => {
    it('is value:null when no explicit tourism-intensity evidence exists, even with high prominence', () => {
      const result = computeExplorationSignals({
        placesReviewCount: 500_000,
        wikidataSitelinkCount: 200,
        wikipediaPresent: true,
        wikivoyageListed: true,
        heritageOrLandmark: true,
      });

      expect(result.prominence.value).not.toBeNull();
      expect(result.tourismIntensity.value).toBeNull();
      expect(result.tourismIntensity.reasonCodes).toContain(
        'no_explicit_tourism_intensity_evidence',
      );
    });

    it('produces a deterministic known value with provenance from explicit tourism-intensity evidence', () => {
      const input: ExplorationSignalInput = {
        explicitTourismIntensityEvidence: [
          { strength: 0.9, evidenceKey: 'tourist_hotspot', source: 'research' },
        ],
      };
      const first = computeExplorationSignals(input);
      const second = computeExplorationSignals(input);

      expect(first.tourismIntensity.value).not.toBeNull();
      expect(first.tourismIntensity.evidence).toEqual([
        { source: 'research', key: 'tourist_hotspot', value: 0.9 },
      ]);
      expect(first).toEqual(second);
    });
  });

  describe('computeExplorationSignals — localCharacter', () => {
    it('is value:null for an obscure/low-review candidate with no explicit local-character evidence', () => {
      const result = computeExplorationSignals({ placesReviewCount: 2 });
      expect(result.localCharacter.value).toBeNull();
      expect(result.localCharacter.reasonCodes).toContain(
        'no_explicit_local_character_evidence',
      );
    });

    it('produces a deterministic known value with provenance from explicit local-character evidence', () => {
      const input: ExplorationSignalInput = {
        explicitLocalCharacterEvidence: [
          {
            strength: 0.8,
            evidenceKey: 'traditional_market',
            source: 'research',
          },
        ],
      };
      const result = computeExplorationSignals(input);

      expect(result.localCharacter.value).not.toBeNull();
      expect(result.localCharacter.evidence).toEqual([
        { source: 'research', key: 'traditional_market', value: 0.8 },
      ]);
    });
  });

  describe('explicit-evidence normalization hardening (review fix)', () => {
    const FIELDS = [
      'explicitTourismIntensityEvidence',
      'explicitLocalCharacterEvidence',
    ] as const;
    const SIGNAL_KEY = {
      explicitTourismIntensityEvidence: 'tourismIntensity',
      explicitLocalCharacterEvidence: 'localCharacter',
    } as const;

    describe.each(FIELDS)('%s', (field) => {
      const signalKey = SIGNAL_KEY[field];

      it.each([[{}], ['bad'], [42]])(
        'never throws on a non-array runtime payload (%p) -- degrades to unknown',
        (malformed) => {
          expect(() =>
            computeExplorationSignals({
              [field]: malformed,
            } as unknown as ExplorationSignalInput),
          ).not.toThrow();

          const result = computeExplorationSignals({
            [field]: malformed,
          } as unknown as ExplorationSignalInput);

          expect(result[signalKey].value).toBeNull();
          expect(result[signalKey].confidence).toBe(0);
          expect(result[signalKey].evidence).toEqual([]);
        },
      );

      it.each([
        [null],
        [undefined],
        [{}],
        [{ strength: 0.8 }],
        [{ strength: 0.8, source: '', evidenceKey: 'x' }],
        [{ strength: 0.8, source: 'x', evidenceKey: '' }],
        [{ strength: 0.8, source: '   ', evidenceKey: 'abc' }],
        [{ strength: 0.8, source: 'abc', evidenceKey: '   ' }],
      ])(
        'ignores a malformed entry (%p) -- no provenance/shape means no evidence',
        (entry) => {
          const result = computeExplorationSignals({
            [field]: [entry],
          } as unknown as ExplorationSignalInput);

          expect(result[signalKey].value).toBeNull();
          expect(result[signalKey].evidence).toEqual([]);
        },
      );

      it.each([[NaN], [Infinity], [-Infinity], [-0.1], [1.1]])(
        'ignores an entry with an invalid strength (%p) without throwing or inventing a score',
        (strength) => {
          expect(() =>
            computeExplorationSignals({
              [field]: [
                { strength, source: 'wikivoyage', evidenceKey: 'claim' },
              ],
            } as unknown as ExplorationSignalInput),
          ).not.toThrow();

          const result = computeExplorationSignals({
            [field]: [{ strength, source: 'wikivoyage', evidenceKey: 'claim' }],
          } as unknown as ExplorationSignalInput);

          expect(result[signalKey].value).toBeNull();
          expect(result[signalKey].evidence).toEqual([]);
        },
      );

      it('trims source/evidenceKey into normalized provenance', () => {
        const result = computeExplorationSignals({
          [field]: [
            {
              strength: 0.8,
              source: '  wikivoyage ',
              evidenceKey: ' local_market ',
            },
          ],
        } as unknown as ExplorationSignalInput);

        expect(result[signalKey].evidence).toEqual([
          { source: 'wikivoyage', key: 'local_market', value: 0.8 },
        ]);
      });

      it('deduplicates identical (source, evidenceKey) claims into one evidence entry, not three independent ones', () => {
        const single = computeExplorationSignals({
          [field]: [
            {
              strength: 0.8,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
          ],
        } as unknown as ExplorationSignalInput);

        const triplicated = computeExplorationSignals({
          [field]: [
            {
              strength: 0.8,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
            {
              strength: 0.8,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
            {
              strength: 0.8,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
          ],
        } as unknown as ExplorationSignalInput);

        expect(triplicated[signalKey].evidence).toHaveLength(1);
        expect(triplicated[signalKey].evidence).toEqual(
          single[signalKey].evidence,
        );
        expect(triplicated[signalKey].confidence).toBe(
          single[signalKey].confidence,
        );
        expect(triplicated[signalKey].value).toBe(single[signalKey].value);
      });

      it('resolves conflicting duplicate strengths for the same claim by keeping the strongest, not averaging', () => {
        const result = computeExplorationSignals({
          [field]: [
            {
              strength: 0.3,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
            {
              strength: 0.9,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
            {
              strength: 0.5,
              source: 'wikivoyage',
              evidenceKey: 'local_claim_1',
            },
          ],
        } as unknown as ExplorationSignalInput);

        expect(result[signalKey].evidence).toEqual([
          { source: 'wikivoyage', key: 'local_claim_1', value: 0.9 },
        ]);
        expect(result[signalKey].value).toBe(0.9);
      });

      it('lets genuinely distinct claims raise confidence, unlike duplicates of the same claim', () => {
        const oneClaim = computeExplorationSignals({
          [field]: [{ strength: 0.7, source: 'a', evidenceKey: 'claim_a' }],
        } as unknown as ExplorationSignalInput);

        const threeDistinctClaims = computeExplorationSignals({
          [field]: [
            { strength: 0.7, source: 'a', evidenceKey: 'claim_a' },
            { strength: 0.7, source: 'b', evidenceKey: 'claim_b' },
            { strength: 0.7, source: 'c', evidenceKey: 'claim_c' },
          ],
        } as unknown as ExplorationSignalInput);

        expect(threeDistinctClaims[signalKey].evidence).toHaveLength(3);
        expect(threeDistinctClaims[signalKey].confidence).toBeGreaterThan(
          oneClaim[signalKey].confidence,
        );
      });
    });
  });

  describe('Phase-7 population boundary', () => {
    it('is complete/valid when only prominence is populated and the other two stay unknown', () => {
      const result = computeExplorationSignals({ placesReviewCount: 300 });

      expect(result.prominence.value).not.toBeNull();
      expect(result.tourismIntensity.value).toBeNull();
      expect(result.localCharacter.value).toBeNull();
    });

    it('never lets user free-text/preference fields populate Experience-side evidence -- unknown extra input properties are ignored entirely', () => {
      const baseline = computeExplorationSignals({ placesReviewCount: 300 });
      // Simulates someone mistakenly trying to smuggle traveler free text
      // into the Experience-evidence input. ExplorationSignalInput has no
      // such field, so this must have zero effect.
      const withSmuggledPreference = computeExplorationSignals({
        placesReviewCount: 300,
        additionalPreferences: 'quiero turismo local, joyas escondidas',
        explorationStyle: 'local_deep_dive',
      } as unknown as ExplorationSignalInput);

      expect(withSmuggledPreference).toEqual(baseline);
      expect(withSmuggledPreference.localCharacter.value).toBeNull();
      expect(withSmuggledPreference.tourismIntensity.value).toBeNull();
    });
  });

  describe('computeExplorationTilt', () => {
    function signalsWith(
      overrides: Partial<ExplorationSignals> = {},
    ): ExplorationSignals {
      const unknown: EvidenceBackedExplorationSignal = {
        value: null,
        confidence: 0,
        evidence: [],
        reasonCodes: [],
      };
      return {
        prominence: { ...unknown },
        tourismIntensity: { ...unknown },
        localCharacter: { ...unknown },
        ...overrides,
      };
    }

    it('iconic: higher known prominence gives a higher tilt score', () => {
      const low = computeExplorationTilt(
        'iconic',
        signalsWith({
          prominence: {
            value: 0.2,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );
      const high = computeExplorationTilt(
        'iconic',
        signalsWith({
          prominence: {
            value: 0.9,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );

      expect(high.score).toBeGreaterThan(low.score);
    });

    it('iconic: unknown prominence is neutral (zero tilt)', () => {
      const tilt = computeExplorationTilt('iconic', signalsWith());
      expect(tilt.score).toBe(0);
    });

    it('local_deep_dive: grounded localCharacter gives a positive tilt', () => {
      const tilt = computeExplorationTilt(
        'local_deep_dive',
        signalsWith({
          localCharacter: {
            value: 0.8,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );
      expect(tilt.score).toBeGreaterThan(0);
    });

    it('local_deep_dive: grounded high tourismIntensity moderates/penalizes the tilt', () => {
      const withoutTourism = computeExplorationTilt(
        'local_deep_dive',
        signalsWith({
          localCharacter: {
            value: 0.8,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );
      const withHighTourism = computeExplorationTilt(
        'local_deep_dive',
        signalsWith({
          localCharacter: {
            value: 0.8,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
          tourismIntensity: {
            value: 0.9,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );

      expect(withHighTourism.score).toBeLessThan(withoutTourism.score);
    });

    it('local_deep_dive: low or unknown prominence by itself gives no bonus', () => {
      const lowProminence = computeExplorationTilt(
        'local_deep_dive',
        signalsWith({
          prominence: {
            value: 0.05,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );
      const unknownProminence = computeExplorationTilt(
        'local_deep_dive',
        signalsWith(),
      );

      expect(lowProminence.score).toBe(0);
      expect(unknownProminence.score).toBe(0);
    });

    it('balanced: exact neutral tilt regardless of signals', () => {
      const tilt = computeExplorationTilt(
        'balanced',
        signalsWith({
          prominence: {
            value: 0.9,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
          localCharacter: {
            value: 0.9,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
          tourismIntensity: {
            value: 0.9,
            confidence: 1,
            evidence: [],
            reasonCodes: [],
          },
        }),
      );
      expect(tilt.score).toBe(0);
    });
  });

  it('same input repeated produces a deep-equal result (deterministic)', () => {
    const input: ExplorationSignalInput = {
      placesReviewCount: 1200,
      wikidataSitelinkCount: 40,
      wikipediaPresent: true,
      explicitLocalCharacterEvidence: [
        { strength: 0.6, evidenceKey: 'community_venue', source: 'research' },
      ],
    };

    expect(computeExplorationSignals(input)).toEqual(
      computeExplorationSignals(input),
    );
  });

  it('exposes no matches/satisfied result and no provider/Prisma/LLM/embedding dependency', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        explorationSignalsModule,
        'satisfied',
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(explorationSignalsModule, 'matches'),
    ).toBe(false);

    const source = fs.readFileSync(
      path.join(__dirname, 'exploration-signals.util.ts'),
      'utf8',
    );
    // The strongest possible proof of "no provider/Prisma/LLM/embedding
    // dependency": this file has NO import statements at all -- it is a
    // fully standalone pure utility. (Doc comments are free to mention
    // "no embeddings" in prose; only real `import` lines would indicate an
    // actual dependency.)
    const importLines = source
      .split('\n')
      .filter((line: string) => /^\s*import\s/.test(line));
    expect(importLines).toEqual([]);
  });
});
