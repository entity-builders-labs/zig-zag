import { composableExperience } from '../../src/modules/tours/fixtures/composable-experience.fixture';
import { planningDaysFixture } from 'src/modules/tours/fixtures/planning-input.fixture';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
import { sortCandidatesDeterministically } from '../../src/modules/tours/utils/daily-planning-candidate-sort.util';
import { derivePreferenceUtility } from '../../src/modules/tours/utils/preference-utility.util';
import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import { placesHistoricalLandmarkObservation } from './support/observations';

/**
 * TEST 6 — QUALITY SIGNAL ROUND-TRIP
 *
 * Follows an objective quality signal (Google Places `rating: 4.7`,
 * `userRatingCount: 5321`) from a `SourceObservation` through synthesis,
 * the preference-utility boundary and the planner boundary.
 *
 * Pinned current behavior:
 *  - the structured synthesizer carries NO quality field — the rating is
 *    dropped at the very first hop;
 *  - since task 25.2 there is one generic quality signal: the canonical
 *    Experience qualityScore (0..5) enters the utility breakdown once as
 *    KNOWN, or stays UNKNOWN (never 0); the former source-specific
 *    `qualityBonus` policies were deleted with `candidate-ranking.util`;
 *  - the planner never weighs quality; it follows the utility rank.
 */
describe('CHAR-6 quality signal round-trip', () => {
  it('the structured synthesizer drops Google Places rating/userRatingCount', () => {
    const synth = new StructuredExperienceCandidateSynthesizerService();
    const obs = placesHistoricalLandmarkObservation();
    expect((obs.metadata as any).rating).toBe(4.7);

    const [proposal] = synth.synthesizeProposals([obs]);
    const candidate: any = proposal.candidate;
    expect(candidate.qualityScore).toBeUndefined();
    expect(candidate.rating).toBeUndefined();
    expect(JSON.stringify(candidate)).not.toMatch(/4\.7|rating/i);
  });

  it('quality enters the utility breakdown once, KNOWN or UNKNOWN, and the planner only follows the rank', () => {
    const experiences = ['quality', 'no-quality'].map((id) => ({
      id,
      canonicalName: 'Rated Landmark',
      durationMinutes: 90,
      latitude: -34.6,
      longitude: -58.38,
      qualityScore: id === 'quality' ? 4.7 : undefined,
      components: [
        {
          geoEntityId: `geo-${id}`,
          role: 'venue',
          geoEntity: { latitude: -34.6, longitude: -58.38 },
        },
      ],
    }));
    const utility = {
      ...derivePreferenceUtility({
        experiences: experiences.map(composableExperience),
        preferenceSpec: { facets: [], assertions: [] },
        softAnchorIds: new Set<string>(),
        semantic: null,
      }),
      semanticRanking: {
        status: 'not_requested' as const,
        requestedCandidateCount: 0,
        indexedCandidateCount: 0,
      },
    };
    const normalized =
      new PlanningCandidateNormalizerService().normalizeExperiences(
        experiences,
        utility,
        { days: planningDaysFixture(1) },
      ).candidates;
    const byId = new Map(normalized.map((c) => [c.experienceId, c]));

    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-6] rating=4.7 -> breakdown quality=${JSON.stringify(byId.get('quality')!.preference.breakdown.quality)}`,
    );
    expect(byId.get('quality')!.preference.breakdown.quality).toEqual({
      status: 'KNOWN',
      score: 4.7,
    });
    expect(byId.get('no-quality')!.preference.breakdown.quality).toEqual({
      status: 'UNKNOWN',
      reason: 'NO_QUALITY_SIGNAL',
    });
    expect('qualityScore' in byId.get('quality')!).toBe(false);
    // A lone UNKNOWN in its tier takes the median of the KNOWN peers (4.7)
    // for ordering only, so the id decides; the planner follows that rank.
    expect(
      sortCandidatesDeterministically(normalized).map((c) => c.experienceId),
    ).toEqual(utility.order);
  });
});
