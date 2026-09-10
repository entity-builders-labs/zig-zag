import {
  decideExperienceDedupe,
  DedupeExperienceFingerprint,
} from '../../src/modules/tours/utils/experience-dedupe.util';
import {
  filterOverlappingExperienceCandidates,
  OverlapCandidate,
} from '../../src/modules/tours/utils/candidate-overlap-filter.util';

/**
 * TEST 7 — SHARED COMPONENT ≠ SAME EXPERIENCE
 *
 * Two Experiences that merely SHARE one real place are neither "the same
 * Experience" nor safely interchangeable. This pins:
 *  A) `decideExperienceDedupe`: sharing one component of two → AMBIGUOUS
 *     (not NEW); a human-obvious alias with an identical single component is
 *     still only AMBIGUOUS unless the names normalize almost identically.
 *  B) `filterOverlappingExperienceCandidates`: when two candidates share ONE
 *     component, `preferWinner` keeps the one with MORE components — ranking
 *     score is only a tie-break AFTER component count. A tightly-relevant
 *     2-stop walk (rankingScore 0.95) is dropped in favour of a sprawling
 *     4-stop circuit (rankingScore 0.30) that merely includes the same place.
 *
 * Component names are arbitrary here — nothing keys on a specific landmark.
 */

const SHARED = {
  name: 'Shared Landmark',
  latitude: -32.9475,
  longitude: -60.6284,
};
const OTHER_A = {
  name: 'Riverside Promenade',
  latitude: -32.95,
  longitude: -60.64,
};

const fp = (
  over: Partial<DedupeExperienceFingerprint>,
): DedupeExperienceFingerprint => ({
  canonicalName: 'x',
  components: [],
  ...over,
});

describe('CHAR-7 shared component vs same experience', () => {
  describe('decideExperienceDedupe', () => {
    const A = fp({
      id: 'A',
      canonicalName: 'Shared Landmark Visit',
      latitude: SHARED.latitude,
      longitude: SHARED.longitude,
      components: [{ geoEntityId: 'geo-shared', role: 'venue' }],
    });
    const B = fp({
      id: 'B',
      canonicalName: 'Riverside Walk past the Shared Landmark',
      latitude: SHARED.latitude,
      longitude: SHARED.longitude,
      components: [
        { geoEntityId: 'geo-shared', role: 'venue' },
        { geoEntityId: 'geo-promenade', role: 'stop' },
      ],
    });

    it('A vs [B]: one shared component out of two → AMBIGUOUS, not NEW and not SAME', () => {
      const decision = decideExperienceDedupe(A, [B]);
      // eslint-disable-next-line no-console
      console.info(
        `[CHAR-7] A vs [B] => ${decision.decision} (compOverlap=${decision.evidence.componentOverlap})`,
      );
      expect(decision.decision).toBe('AMBIGUOUS');
    });

    it('A vs an exact-name, single-component alias → SAME (structure is exact)', () => {
      const exactAlias = fp({
        id: 'C1',
        canonicalName: 'Shared Landmark Visit',
        latitude: SHARED.latitude,
        longitude: SHARED.longitude,
        components: [{ geoEntityId: 'geo-shared', role: 'venue' }],
      });
      const decision = decideExperienceDedupe(A, [exactAlias]);
      expect(decision.decision).toBe('SAME');
    });

    it('A vs a human-obvious alias (same single component, slightly different name) → still only AMBIGUOUS', () => {
      const looseAlias = fp({
        id: 'C2',
        canonicalName: 'Shared Landmark Visit — Rosario',
        latitude: SHARED.latitude,
        longitude: SHARED.longitude,
        components: [{ geoEntityId: 'geo-shared', role: 'venue' }],
      });
      const decision = decideExperienceDedupe(A, [looseAlias]);
      // eslint-disable-next-line no-console
      console.info(
        `[CHAR-7] A vs looseAlias => ${decision.decision} (nameSim=${decision.evidence.nameSimilarity.toFixed(2)})`,
      );
      expect(decision.decision).toBe('AMBIGUOUS');
    });
  });

  describe('filterOverlappingExperienceCandidates', () => {
    const walk: OverlapCandidate = {
      id: 'walk',
      rankingScore: 0.95,
      components: [{ geoEntity: { ...SHARED } }, { geoEntity: { ...OTHER_A } }],
    };
    const circuit: OverlapCandidate = {
      id: 'circuit',
      rankingScore: 0.3,
      components: [
        { geoEntity: { ...SHARED } },
        {
          geoEntity: {
            name: 'Old Square',
            latitude: -32.947,
            longitude: -60.633,
          },
        },
        {
          geoEntity: {
            name: 'Oath Route',
            latitude: -32.977,
            longitude: -60.686,
          },
        },
        {
          geoEntity: {
            name: 'City Centre',
            latitude: -32.931,
            longitude: -60.649,
          },
        },
      ],
    };

    it('the higher-ranked 2-stop walk is dropped in favour of the lower-ranked 4-stop circuit that shares one component', () => {
      const result = filterOverlappingExperienceCandidates([walk, circuit]);
      // eslint-disable-next-line no-console
      console.info(
        `[CHAR-7] kept=${result.kept.map((k) => k.id)} excluded=${JSON.stringify(result.excluded)}`,
      );
      expect(result.kept.map((k) => k.id)).toEqual(['circuit']);
      expect(result.excluded[0]).toMatchObject({
        id: 'walk',
        reason: 'REDUNDANT_WITH_OTHER_CANDIDATE',
        overlapsWith: 'circuit',
      });
    });

    it('a standalone single-place Experience is subsumed by any composite containing it (documented behavior)', () => {
      const standalone: OverlapCandidate = {
        id: 'standalone',
        rankingScore: 0.99,
        components: [{ geoEntity: { ...SHARED } }],
      };
      const result = filterOverlappingExperienceCandidates([standalone, walk]);
      expect(result.kept.map((k) => k.id)).toEqual(['walk']);
    });

    it('OPEN POLICY (not a settled invariant): the overlap filter currently prefers component count over user relevance', () => {
      // Definite finding: `preferWinner` compares component count BEFORE
      // rankingScore, so a rankingScore-0.30 4-stop circuit beats a
      // rankingScore-0.95 2-stop walk that shares one component.
      //
      // NOT decided: whether "larger composite subsumes smaller Experience"
      // or "more user-relevant Experience wins" is the right policy. This is
      // pinned as CURRENT behavior, deliberately not as an `it.failing`
      // invariant.
      const result = filterOverlappingExperienceCandidates([walk, circuit]);
      expect(result.kept.map((k) => k.id)).toEqual(['circuit']);
      expect((walk.rankingScore ?? 0) > (circuit.rankingScore ?? 0)).toBe(true);
    });
  });
});
