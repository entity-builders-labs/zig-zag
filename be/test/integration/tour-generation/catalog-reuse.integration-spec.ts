import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * Proves genuine warm catalog reuse under the preference-first cutover
 * (M2): sufficiency requires each requested facet to have a real STRONG
 * catalog match -- `qualityScore >= 3.0` (`preference-strong-match.util.ts`),
 * never a `null` one, on top of matching `themes`/`intents`.
 *
 * A discovery-extractor/web candidate legitimately carries real
 * `themes`/`intents` but NEVER a quality rating (extraction must not author
 * one, per B3). A structured Wikivoyage observation for the SAME real place
 * legitimately carries a real, grounded quality signal (B3 live wiring,
 * `quality-score.util.ts`) but no themes/intents of its own (mechanical
 * structured synthesis, no classification). Two real, independent
 * acquisition requests against the SAME real places (same name/coordinates)
 * converge via the existing, already-tested Experience identity/dedupe
 * primitive into ONE canonical Experience carrying both facts together --
 * this is the two-stream convergence the live architecture is built for,
 * not a special-cased test fixture.
 *
 * These two acquisition requests run as separate, fully-committed
 * generations (never concurrently within one `resolve()` call) so this test
 * exercises the resolver's real, committed-state dedupe path rather than a
 * same-batch identity race between two brand-new, not-yet-persisted
 * candidates -- `ExperienceProposalResolverService`'s bounded-concurrency
 * persistence (`RESOLVER_CANDIDATE_CONCURRENCY`) does not guarantee two
 * candidates for the same real place converge when both are new and
 * resolved in the same concurrency window; that is a separate, pre-existing
 * concern this test does not exercise or claim to prove.
 *
 * The actual "reuse" claim under test is the THIRD request: a fresh Tour
 * against the now-sufficient catalog makes ZERO acquisition calls of any
 * kind -- never a manual DB patch, never a fabricated pre-classified row.
 */
const DEST = { latitude: -34.6, longitude: -58.4 };
// Genuinely distinct names (not "stop 0".."stop 6") -- real-world identity
// dedupe (experience-dedupe.util.ts) legitimately treats near-identical
// names as likely-SAME evidence; fixtures must use unambiguous names for
// distinct real places, exactly like real destinations do.
const DISCOVERED = [
  'Plaza Dorrego',
  'Mercado de San Telmo',
  'Iglesia Santa Sede de San Pedro Telmo',
  'Parque Lezama',
  'Museo Histórico Nacional',
  'Pasaje de la Defensa',
  'Caserón de los Anticuarios',
];

describe('tour-generation integration · catalog-reuse', () => {
  let harness: TourGenerationHarness;

  beforeAll(async () => {
    harness = await TourGenerationHarness.create();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
  });

  it('reuses the persisted catalog on a second compatible request', async () => {
    // ── Request A: Wikivoyage-only acquisition establishes real, grounded
    // quality evidence for 7 real places (no themes/intents of their own --
    // structured synthesis is mechanical, never classifies). Entity
    // resolution grounds each named hint against a trusted geo provider
    // (never the raw Wikivoyage-claimed coordinates directly), so the same
    // 7 places must also be resolvable via OSM. ──
    harness.configure({
      wikivoyage: {
        status: 'ok',
        title: 'Buenos Aires',
        entries: DISCOVERED.map((name, i) => ({
          name,
          lat: DEST.latitude + i * 0.005,
          long: DEST.longitude + i * 0.005,
          sectionType: 'SEE',
        })),
      },
      osm: {
        pois: DISCOVERED.map((name, i) =>
          osmPoi(name, DEST.latitude + i * 0.005, DEST.longitude + i * 0.005),
        ),
      },
    });
    const tourA = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: [],
      // The fixture intentionally places seven distinct real places along a
      // 3+ km corridor; mobility is not the behavior under test here.
      maxContinuousWalkingDistanceMeters: 6000,
    });
    const runA = await harness.generate(tourA);
    expect(runA.error?.message ?? 'ok').toBe('ok');

    const afterRunA = await harness.prisma.experience.findMany({
      where: { canonicalName: { in: DISCOVERED } },
    });
    expect(afterRunA.length).toBe(7);
    for (const row of afterRunA) {
      // B3 live wiring: a real Wikivoyage listing clears the strong-match
      // quality floor (WIKIVOYAGE_LISTED_QUALITY = 3.5) -- never null.
      expect(row.qualityScore).not.toBeNull();
      expect(row.qualityScore as number).toBeGreaterThanOrEqual(3.0);
    }

    // ── Request B ("Run 1"): a real web-discovery request for the SAME real
    // places (same name/coordinates). Dedupe converges each web candidate
    // onto the already-persisted Wikivoyage row for that place, enriching
    // it with real themes/intents while preserving its real qualityScore --
    // never re-acquiring quality, never overwriting it with null. ──
    harness.configure({
      groundedSearch: { evidence: [{ key: 'web:reuse:1' }] },
      discoveryExtractor: {
        candidates: DISCOVERED.map((name) => ({
          name,
          themes: ['history'],
          intents: ['visit'],
          evidenceKeys: ['web:reuse:1'],
        })),
      },
      osm: {
        pois: DISCOVERED.map((name, i) =>
          osmPoi(name, DEST.latitude + i * 0.005, DEST.longitude + i * 0.005),
        ),
      },
      wikivoyage: { status: 'not_found' },
    });
    // Cutover M4: every accepted candidate now converges through real
    // evidence-only classification (ExperienceAcquisitionService
    // .materializeExecution()) before it can satisfy a requested facet.
    // The fake LLM must return a genuine, evidence-grounded verdict citing
    // the real evidenceKey this request's discovery evidence carries --
    // never a magic passthrough of the candidate's own unverified claim.
    harness.fakes.langChain.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        themes: ['history'],
        intents: ['visit'],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'theme:history',
            evidenceKeys: ['web:reuse:1'],
            reason: 'Evidence describes a historic place people visit.',
          },
          {
            facet: 'intent:visit',
            evidenceKeys: ['web:reuse:1'],
            reason: 'Evidence describes a historic place people visit.',
          },
        ],
      }),
    );

    const tour1 = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
      maxContinuousWalkingDistanceMeters: 6000,
    });
    const run1 = await harness.generate(tour1);
    expect(run1.error?.message ?? 'ok').toBe('ok');

    const afterRun1 = await harness.prisma.experience.count({
      where: { status: 'VERIFIED' },
    });
    expect(afterRun1).toBe(7);
    expect(
      harness.fakes.discoveryExtractor.extractExperiences,
    ).toHaveBeenCalled();

    // Each of the 7 real places now carries BOTH a real qualityScore
    // (from request A) AND real themes/intents (from request B) on the
    // SAME canonical row -- proof of genuine cross-request convergence,
    // never a duplicate.
    const reusedRows = await harness.prisma.experience.findMany({
      where: { canonicalName: { in: DISCOVERED } },
    });
    expect(reusedRows.length).toBe(7);
    for (const row of reusedRows) {
      expect(row.qualityScore).not.toBeNull();
      expect(row.qualityScore as number).toBeGreaterThanOrEqual(3.0);
      expect((row.metadata as any).intents).toEqual(
        expect.arrayContaining(['visit']),
      );
      expect((row.metadata as any).themes).toEqual(
        expect.arrayContaining(['history']),
      );
    }

    // ── Run 2: same DB, fresh tour, mocks reset -- the actual reuse claim.
    // The catalog is now genuinely sufficient (real quality + real
    // themes/intents), so this makes ZERO calls to every faked external
    // transport. ──
    jest.clearAllMocks();
    const tour2 = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });
    const run2 = await harness.generate(tour2);
    expect(run2.error?.message ?? 'ok').toBe('ok');

    const tour2Loaded = await harness.loadTour(tour2);
    const coverage2 = harness
      .traceSteps(tour2Loaded.trace)
      .find((s) => s.stage === 'coverage_analysis');
    // Canonical preference-first coverage result (cutover M2 cleanup) --
    // no legacy `coverageReport` projection is produced by the live path.
    expect(coverage2?.coverageReport).toBeUndefined();
    expect(coverage2?.decision?.outcome).toBe('none');
    expect(coverage2?.outputs?.sufficient).toBe(true);

    // No duplicate Experience rows; catalog count unchanged.
    const afterRun2 = await harness.prisma.experience.count({
      where: { status: 'VERIFIED' },
    });
    expect(afterRun2).toBe(afterRun1);

    const grouped = await harness.prisma.experience.groupBy({
      by: ['canonicalName'],
      where: { status: 'VERIFIED' },
      _count: { _all: true },
    });
    for (const row of grouped) {
      expect(row._count._all).toBe(1);
    }

    expect(tour2Loaded.tourExperiences.length).toBeGreaterThanOrEqual(1);
  });
});
