# Composite Extraction Envelope + Entity Name-Matching Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two highest-confidence, lowest-risk root causes identified in the adversarial characterization review (Root Cause #1: silent extractor envelope-parsing data loss; Root Cause #2: unguarded substring matching in local entity resolution), then re-run the same 6-theme Buenos Aires characterization to measure the real delta before deciding on any further, costlier work.

**Architecture:** Both fixes are pure-function-level corrections inside existing utils, with zero new dependencies, zero new services, and zero orchestration changes. Task 1 makes `extractExperienceCandidates` recognize a bare single-candidate object as a valid (if malformed) envelope instead of silently discarding it. Task 2 replaces `matchOsmCandidateByName`'s unguarded bidirectional substring check with the same token-specificity discipline `bestNominatimMatch` already uses, so a short/generic OSM-tagged name (`"B"`, `"MO"`, `"CE"`, `"Iglesia"`) can no longer be accepted as a match for an unrelated, longer hint name purely because its letters happen to appear inside it.

**Tech Stack:** TypeScript, NestJS, Jest (`be/` workspace). No new libraries.

**Spec:** `docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md` (this plan implements §14 Root Causes #1–#2 and §18 Migration Plan steps 1–2 of that review). Executors should read that review's §6, §8, and §14 before starting — they contain the exact real-world false positives (`osm:node:6033692285` matched to 4 distinct real places) and the exact raw LLM output that motivates Task 1.

## Global Constraints

- No hardcoded fixture-specific rules (no `if (name === 'San Telmo Market')`, no `if (name.includes('Plaza Dorrego'))`, no category→kind mapping like `park => AREA`). Both fixes must be generic and destination-agnostic — verified by the fact that neither task's code below references any place name.
- Do not touch `AreaRouteWalkAcquisitionService`, `AreaRouteAnchorResolverService`, discovery/acquisition orchestration (`ExperienceAcquisitionService`, `ExperienceAcquisitionPlannerService`), classification, or materialization. Both tasks are confined to the two util files named above.
- Do not touch `be/test/live/**` (the live test harness).
- TDD: write the failing test first, confirm it fails for the right reason, then implement.
- Run `yarn typecheck && yarn lint:check` from `be/` after each task, in addition to the task's own targeted test.
- One commit per task. No `--amend`. No push (matches the review's own "no code changes yet" boundary — pushing is a separate, explicit decision after both tasks are green).

---

## Current real state (baseline)

Both files exist today, unmodified, at:

- `be/src/modules/tours/utils/experience-candidate-extraction.util.ts` (129 lines)
- `be/src/modules/tours/utils/nominatim-match.util.ts` (196 lines)

Their current test suites (`experience-candidate-extraction.util.spec.ts`, `nominatim-match.util.spec.ts`) were read in full during planning; every existing assertion was checked against both new implementations below and confirmed to still pass (all existing positive-match fixtures use exact-string equality or the one legitimate substring case `"Caminito"` / `"Calle Caminito"`, which the new token-overlap logic preserves — see Task 2 Step 1 for the full reasoning). `experience-proposal-resolver.service.spec.ts`'s ~30 name fixtures were also scanned; every one of them matches by exact string equality, so Task 2 cannot regress it.

---

## Task 1: Stop silently discarding a bare-object extractor response

**Files:**
- Modify: `be/src/modules/tours/utils/experience-candidate-extraction.util.ts`
- Test: `be/src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`

**Interfaces:**
- Consumes: nothing new — `extractExperienceCandidates(raw: unknown, evidenceKeys: Set<string>, maxCandidates: number): ExperienceExtractionResult` keeps its exact existing signature and `ExperienceExtractionResult { candidates: ExperienceCandidate[]; validationErrors: string[] }` shape.
- Produces: same signature/shape as today. Callers (`GroqDiscoveryProvider.extractExperiences`, `GeminiDiscoveryProvider`, `OllamaDiscoveryProvider`) need zero changes — they already forward `validationErrors` untouched into `WebAcquisitionResult.validationErrors` (see `experience-acquisition.service.ts`'s `executeWebSourcePlan`), which is where the new repair note becomes observable in the generation trace/bitácora without any new plumbing.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('extractExperienceCandidates', ...)` block in `be/src/modules/tours/utils/experience-candidate-extraction.util.spec.ts` (append after the last `it(...)` block, before the closing `});`):

```ts
  it('recovers a candidate when the provider returns a bare object instead of {candidates:[...]} (real Groq JSON-object-mode drift, never silent)', () => {
    // Reproduces the exact raw shape observed live from Groq
    // (qwen/qwen3.8-27b, json_object mode, no enforced schema): a single
    // candidate object with no top-level "candidates" wrapper.
    const bareCandidateObject = {
      name: 'San Telmo Colonial Walking Tour',
      description: 'A guided walking tour through the oldest neighborhood.',
      themes: ['history', 'culture'],
      traits: ['guided walking tour'],
      intents: ['walk'],
      suggestedDurationMinutes: 120,
      componentHints: [
        {
          key: 'san-telmo-market',
          name: 'San Telmo Market',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-10'],
        },
        {
          key: 'lezama-park',
          name: 'Lezama Park',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-10'],
        },
      ],
      evidenceKeys: ['ev-10'],
      shortReason:
        "Evidence explicitly describes a specific walking tour named 'San Telmo Colonial Walking Tour'.",
      orderedByEvidence: false,
    };

    const result = extractExperienceCandidates(
      bareCandidateObject,
      new Set(['ev-10']),
      8,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('San Telmo Colonial Walking Tour');
    expect(result.candidates[0].componentHints).toHaveLength(2);
    // Never silent: the repair must be observable downstream (it already
    // flows into WebAcquisitionResult.validationErrors / the generation
    // trace unchanged, no new plumbing needed).
    expect(result.validationErrors).toEqual([
      expect.stringContaining('extractor_envelope_repaired'),
    ]);
  });

  it('does not repair a raw value that is neither an array, a {candidates:[...]} envelope, nor a single-candidate-shaped object', () => {
    const result = extractExperienceCandidates(
      { unrelated: 'shape', foo: 'bar' },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`
Expected: FAIL — the first new test fails with `expected length 1, received 0` (today `entries` resolves to `[]` for a bare object, so `result.candidates` is empty). The second new test passes already (it's a regression guard, included now so it fails alongside if a later refactor over-widens the repair condition).

- [ ] **Step 3: Implement the minimal fix**

Replace the top of `be/src/modules/tours/utils/experience-candidate-extraction.util.ts` (the `entries` computation) with:

```ts
import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import { normalizeExperienceCandidateFacets } from './experience-candidate-facet-normalizer.util';

const ROLES = new Set(['area', 'waypoint', 'route', 'venue']);
const KINDS = new Set(['PLACE', 'AREA', 'ROUTE']);
const MAX_HINTS = 8;

export interface ExperienceExtractionResult {
  candidates: ExperienceCandidate[];
  validationErrors: string[];
}

/**
 * Some discovery extractor providers (confirmed live: Groq/qwen3.8-27b in
 * `response_format: {type:'json_object'}` mode, which guarantees valid JSON
 * but never a specific top-level shape) sometimes return a single candidate
 * object directly instead of the documented `{"candidates":[...]}` envelope
 * the prompt asks for. Before this fix, that shape fell through to `[]`
 * with zero validationErrors — a real, well-evidenced multi-component
 * candidate was silently discarded with no observable signal anywhere.
 *
 * This is a structural, provider-agnostic repair (bare object with the two
 * fields every real candidate must have: `name` and `componentHints`),
 * never a per-provider or per-candidate-name special case. The repair is
 * always reported via `validationErrors` — never silent — so it stays
 * visible in `WebAcquisitionResult.validationErrors` and the generation
 * trace without any new plumbing.
 */
function normalizeExtractorEnvelope(raw: unknown): {
  entries: unknown[];
  repairNotes: string[];
} {
  if (Array.isArray(raw)) {
    return { entries: raw, repairNotes: [] };
  }
  if (raw && typeof raw === 'object') {
    const wrapped = (raw as Record<string, unknown>).candidates;
    if (Array.isArray(wrapped)) {
      return { entries: wrapped, repairNotes: [] };
    }
    const name = (raw as Record<string, unknown>).name;
    const componentHints = (raw as Record<string, unknown>).componentHints;
    if (typeof name === 'string' && Array.isArray(componentHints)) {
      return {
        entries: [raw],
        repairNotes: [
          'extractor_envelope_repaired: response was a single bare candidate object instead of {"candidates":[...]}; wrapped automatically',
        ],
      };
    }
  }
  return { entries: [], repairNotes: [] };
}

export function extractExperienceCandidates(
  raw: unknown,
  evidenceKeys: Set<string>,
  maxCandidates: number,
): ExperienceExtractionResult {
  const { entries, repairNotes } = normalizeExtractorEnvelope(raw);
  const candidates: ExperienceCandidate[] = [];
  const validationErrors: string[] = [...repairNotes];
```

Leave everything from the original `for (const [index, value] of entries.slice(0, maxCandidates).entries())` line through the end of the file **completely unchanged** — `entries` and `validationErrors` are still the same local variable names, just now initialized by `normalizeExtractorEnvelope` instead of the inline ternary.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/tours/utils/experience-candidate-extraction.util.spec.ts`
Expected: PASS, all tests (the 2 new ones plus the 5 pre-existing ones).

- [ ] **Step 5: Run the full existing suite for this file's real callers (regression check)**

Run: `yarn test src/modules/tours/services/groq-discovery.provider.spec.ts src/modules/tours/services/gemini-discovery.provider.spec.ts src/modules/tours/services/ollama-discovery.provider.spec.ts src/modules/tours/services/experience-acquisition.service.spec.ts`
Expected: PASS — none of these mock `extractExperienceCandidates` directly with a bare-object raw shape today, so no behavior change is expected for them; this step exists to prove that claim rather than assume it.

- [ ] **Step 6: Typecheck and lint**

Run: `yarn typecheck && yarn lint:check`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd be
git add src/modules/tours/utils/experience-candidate-extraction.util.ts src/modules/tours/utils/experience-candidate-extraction.util.spec.ts
git commit -m "fix(discovery-extraction): recover bare-object extractor response instead of silently discarding it

Groq (json_object mode, no enforced schema) sometimes returns a single
candidate object instead of {\"candidates\":[...]}. Confirmed live: a
real, well-evidenced multi-component candidate (San Telmo Colonial
Walking Tour, Buenos Aires characterization run 2026-09-15) was
silently discarded with zero validationErrors. Wrap a bare
name+componentHints object as a 1-item envelope and report the repair
via the existing validationErrors channel — never silent.

Generic structural repair (checks for the two fields every real
candidate must have), not a per-provider or per-name special case.

See docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md §6/§14 Root Cause #1."
```

---

## Task 2: Guard local OSM name matching against unrelated short/generic names

**Files:**
- Modify: `be/src/modules/tours/utils/nominatim-match.util.ts`
- Test: `be/src/modules/tours/utils/nominatim-match.util.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `matchOsmCandidateByName(name: string, pool: OsmCandidate[]): OsmCandidate | undefined` keeps its exact existing signature. `ExperienceProposalResolverService.resolveCandidate` (the only caller) needs zero changes.

- [ ] **Step 1: Write the failing tests**

Append these tests to the existing `describe('matchOsmCandidateByName', ...)` block in `be/src/modules/tours/utils/nominatim-match.util.spec.ts` (right after the existing 2 tests, before the closing `});`):

```ts
  it('rejects a short/generic candidate name that merely appears as a letter sequence inside a longer, unrelated hint (real regression: "B" matched MALBA, La Bombonera and Museo Nacional de Bellas Artes; "MO" matched "Mercado de San Telmo"; "CE" matched "Centro Científico Tecnológicos")', () => {
    const pool = [osmCandidate({ name: 'B' })];
    expect(matchOsmCandidateByName('MALBA Museum', pool)).toBeUndefined();
    expect(matchOsmCandidateByName('La Bombonera', pool)).toBeUndefined();

    const moPool = [osmCandidate({ name: 'MO' })];
    expect(
      matchOsmCandidateByName('Mercado de San Telmo', moPool),
    ).toBeUndefined();

    const cePool = [osmCandidate({ name: 'CE' })];
    expect(
      matchOsmCandidateByName('Centro Científico Tecnológicos', cePool),
    ).toBeUndefined();
  });

  it('rejects a single generic category word matching only because it is one of several tokens in a longer, more specific hint (real regression: "Iglesia" matched "Iglesia San Ignacio de Loyola", ~8km from the real one)', () => {
    const pool = [osmCandidate({ name: 'Iglesia' })];
    expect(
      matchOsmCandidateByName('Iglesia San Ignacio de Loyola', pool),
    ).toBeUndefined();
  });

  it('still matches when the candidate name is a genuine, specific token shared with the hint (regression guard: must not become too strict)', () => {
    const pool = [osmCandidate({ name: 'Riachuelo' })];
    expect(matchOsmCandidateByName('Riachuelo', pool)).toBe(pool[0]);

    const galeriaPool = [
      osmCandidate({ name: 'Mirador Galería Güemes' }),
    ];
    expect(
      matchOsmCandidateByName('Galería Güemes', galeriaPool),
    ).toBe(galeriaPool[0]);

    const malbaPool = [
      osmCandidate({
        name: 'Museo de Arte Latinoamericano de Buenos Aires (MALBA)',
      }),
    ];
    expect(matchOsmCandidateByName('MALBA', malbaPool)).toBe(malbaPool[0]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test src/modules/tours/utils/nominatim-match.util.spec.ts`
Expected: FAIL — the first two new tests fail (today's unguarded `haystack.includes(needle) || needle.includes(haystack)` matches all of `"B"`, `"MO"`, `"CE"`, `"Iglesia"`). The third new test already passes today (regression guard, included so it fails immediately if the fix over-corrects).

- [ ] **Step 3: Implement the fix**

In `be/src/modules/tours/utils/nominatim-match.util.ts`, replace the existing `matchOsmCandidateByName` function (currently the last function in the file) with:

```ts
/**
 * Same specificity discipline `bestNominatimMatch`'s fuzzy path already
 * applies to the global Nominatim search results (a real word overlap of
 * at least half the hint's significant tokens, with at least one token of
 * real length) — applied here to the LOCAL Overpass pool, which had none
 * of these guards. Before this fix, raw bidirectional substring containment
 * let any short/generic OSM-tagged name (a 1-3 letter node, or a single
 * generic category word like "Iglesia"/"Church") match purely because its
 * letters happened to appear inside a longer, completely unrelated hint —
 * confirmed live: one mistagged node ("B") was accepted as the identity of
 * four distinct real Buenos Aires landmarks (MALBA, La Bombonera, Museo
 * Nacional de Bellas Artes) across one characterization run.
 *
 * Exact equality is always accepted regardless of length — that can never
 * be a false positive. Anything short of exact equality must clear the
 * same token-overlap bar `bestNominatimMatch` uses; there is no length-only
 * shortcut, because a short-but-real hint (e.g. a 3-letter café name)
 * legitimately using the SAME containment logic would be indistinguishable
 * from a mistagged 1-3 letter node without this token check.
 */
function hasSpecificNameOverlap(needle: string, haystack: string): boolean {
  if (haystack === needle) return true;

  const needleTokens = needle.split(' ').filter((token) => token.length >= 4);
  if (needleTokens.length === 0) return false;

  const haystackTokens = new Set(haystack.split(' ').filter(Boolean));
  const matchedTokens = needleTokens.filter((token) =>
    haystackTokens.has(token),
  );
  return (
    matchedTokens.length / needleTokens.length >= 0.5 &&
    matchedTokens.some((token) => token.length >= 5)
  );
}

export function matchOsmCandidateByName(
  name: string,
  pool: OsmCandidate[],
): OsmCandidate | undefined {
  const needle = normalizeGeoName(name);
  return pool.find((candidate) =>
    hasSpecificNameOverlap(needle, normalizeGeoName(candidate.name)),
  );
}
```

This removes the old body entirely (the bidirectional `haystack.includes(needle) || needle.includes(haystack)` check) — do not keep it alongside the new logic, it is exactly what produced the false positives.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test src/modules/tours/utils/nominatim-match.util.spec.ts`
Expected: PASS, all tests (the 3 new ones plus the pre-existing `bestNominatimMatch`/`isAreaScaleEligible`/`rankNominatimCandidates`/`normalizeGeoName` tests, and the original 2 `matchOsmCandidateByName` tests — `'Caminito'`/`'Calle Caminito'` still passes: `needleTokens` from `"calle caminito"` = `["calle","caminito"]`, `haystackTokens` from `"caminito"` = `{"caminito"}`, 1/2 = 0.5 ≥ 0.5 and `"caminito"` has length ≥ 5, so it still matches).

- [ ] **Step 5: Run the resolver's full spec (the only real caller)**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
Expected: PASS, unchanged — every existing fixture in this file matches by exact string equality (`"Plaza Dorrego"` ↔ `"Plaza Dorrego"`, `"Museum"` ↔ `"Museum"`, `"Stop A"` ↔ `"Stop A"`, etc.), which `hasSpecificNameOverlap`'s first branch (`haystack === needle`) always accepts regardless of length. This step exists to prove that claim, not assume it — if anything here fails, stop and re-examine before continuing (do not weaken the token thresholds to force it green).

- [ ] **Step 6: Typecheck and lint**

Run: `yarn typecheck && yarn lint:check`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd be
git add src/modules/tours/utils/nominatim-match.util.ts src/modules/tours/utils/nominatim-match.util.spec.ts
git commit -m "fix(entity-resolution): require specific token overlap in local OSM name matching, not raw substring containment

matchOsmCandidateByName used unguarded bidirectional substring
containment (haystack.includes(needle) || needle.includes(haystack)),
letting any short/generic OSM-tagged name match purely because its
letters appeared inside an unrelated, longer hint. Confirmed live
across one characterization run: a single mistagged node (\"B\") was
accepted as the identity of MALBA Museum, La Bombonera, and Museo
Nacional de Bellas Artes; \"MO\" matched \"Mercado de San Telmo\"; \"CE\"
matched \"Centro Científico Tecnológicos\"; \"Iglesia\" matched a real
church ~8km from where the generic-named node actually is.

Reuses bestNominatimMatch's existing token-overlap discipline (>=50%
of significant hint tokens, at least one token of real length) instead
of inventing a second, weaker matching policy for the local pool.
Exact equality still always matches regardless of length.

See docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md §8/§14 Root Cause #2."
```

---

## Task 3: Re-run the characterization to measure the real delta

**Files:** none modified — this task only runs the same temporary, throwaway characterization methodology from the review (never committed).

- [ ] **Step 1: Confirm environment**

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E "backend|postgres|overpass|nominatim"
```
Expected: all four containers `Up`. If Overpass has been down/degraded since the last run (§7/§13 of the review — it returned 0 POIs for all of Buenos Aires under sustained load), restart it first:
```bash
docker compose restart overpass-argentina
```

- [ ] **Step 2: Re-create the temporary characterization command exactly as described in the review's methodology section**

This repeats the exact non-production, never-committed script pattern from the review (a `@Command()` class temporarily added to `ScriptsModule`'s providers and `ToursModule`'s exports, deleted/reverted afterward — see the review's header for the full mechanism). Do not skip the revert step this time either.

- [ ] **Step 3: Run it against the same 6 themes, same provider config**

```bash
# .env: AI_PROVIDER=groq, DISCOVERY_EXTRACTOR_PROVIDER=groq,
# CLASSIFICATION_PROVIDER=groq, GROUNDED_SEARCH_PROVIDER=serpapi
# (back up and restore .env exactly as the review's methodology did)
docker compose up -d --force-recreate backend
yarn script characterize-composite
```

- [ ] **Step 4: Compare against the baseline numbers**

Baseline (before Task 1/2, §4 of the review):
```
composite candidates generated:        8
composite candidates persisted:        1   (12.5%)
unique entity resolutions:            16
false positives:                       8   (50%)
```
Record the same 4 numbers from the new run. Do not declare success from a qualitative "it looks better" — use the exact same counting method the review used (§4's Python aggregation over `full-results.json`).

- [ ] **Step 5: Revert all temporary scaffolding and restore `.env`**

Exactly as the review's methodology section did: `git checkout` the two temporarily-modified module files, delete the temporary command file, restore `.env` to its prior provider values, `docker compose up -d --force-recreate backend`. Confirm `git status --short` shows no leftover scaffolding.

- [ ] **Step 6: Report**

Write the before/after numbers and a short verdict (did the false-positive rate and composite success rate move meaningfully?) as a new dated file under `docs/superpowers/characterization/`, following the same structure as the 2026-09-15 review. This becomes the evidence for deciding whether Root Causes #3–#5 (Places provider, anchor scope narrowing, Overpass resilience) are worth doing next, per the review's own §20 recommendation — do not decide that here, just measure and report.

---

## Explicitly deferred (not in this plan, and why)

- **Root Cause #3 (`PLACES_PROVIDER=geoapify` dead fallback):** switching to Google Places has real cost and Google Terms of Service implications for how long place data may be persisted — a product/business decision, not a code fix. Needs an explicit answer from the user before any code change here.
- **Root Cause #4 (anchor-specific geographic scope narrowing in the resolver):** requires threading `resolvedAnchors` through `ExperienceGenerationService` → `ExperienceAcquisitionService.materializeExecution` → `ExperienceProposalResolverService.resolve`'s existing (but currently always-absent-for-this-path) `validationScope` parameter. That touches orchestration code outside the two util files this plan is scoped to, and should be its own plan once Task 3's re-measurement shows whether it's still needed after Task 1/2.
- **Root Cause #5 (Overpass resilience under sustained load):** infrastructure/retry work, independent of both fixes above; same reasoning — measure first.

---

## Self-review

**Spec coverage:** Root Cause #1 → Task 1. Root Cause #2 → Task 2. Re-measurement (review §20's own recommended next step) → Task 3. Root Causes #3–#5 explicitly deferred with reasons, not silently dropped.

**Placeholder scan:** no TBD/TODO; every step has real, complete code or an exact runnable command.

**Type consistency:** `extractExperienceCandidates`'s signature and `ExperienceExtractionResult` shape are unchanged in Task 1. `matchOsmCandidateByName`'s signature is unchanged in Task 2. Both tasks are drop-in replacements verified against every existing caller's test fixtures during planning (see "Current real state" above).
