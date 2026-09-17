# Cross-Source Confirmation + TripAdvisor Volume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (Track A) Make entity resolution give a real geographic guarantee — a required component only counts as resolved when either its name matches exactly in the correct local pool, or a second, genuinely independent database (Wikidata) confirms the same coordinates independently. (Track B) Add TripAdvisor (via the already-paid SerpAPI subscription) as a second evidence source feeding the same discovery extractor, to increase how many real composite-walk candidates are found per run.

**Architecture:** Track A adds one new capability (Wikidata geographic-proximity confirmation, SPARQL `wikibase:around`) and one new gate inside `ExperienceProposalResolverService`: any non-exact match must be independently confirmed before it counts as `resolved`; otherwise it becomes `unresolved` (reason `UNCONFIRMED_MATCH`) rather than silently persisting. Track B adds a second real evidence source (SerpAPI's `tripadvisor` engine) as an additional call inside the existing web acquisition path, producing its own `WebAcquisitionResult` entry through the same extractor — never merged into the same LLM call as the primary web query, to avoid making Groq's already-tight per-minute token quota worse.

**Tech Stack:** TypeScript, NestJS, Jest, axios, Wikidata SPARQL endpoint (`query.wikidata.org/sparql`), SerpAPI `engine=tripadvisor`.

**Spec:** This plan implements the design validated live in this conversation — see the session's own record for the raw evidence (real curl/SPARQL calls against Geoapify, Wikidata, and SerpAPI TripAdvisor). Canonical prior documents: `docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md` and `docs/superpowers/plans/2026-09-16-composite-entity-resolution-and-extractor-fixes.md`.

## Global Constraints

- No hardcoded fixture-specific rules (no `if (hint.name === 'MALBA')`, no destination-name special cases). Both tracks are generic and destination-agnostic.
- Never persist a required component that fails confirmation. `UNRESOLVED_REQUIRED_COMPONENT`/candidate rejection must fire exactly as it does today for a hint that never matched at all — a matched-but-unconfirmed hint is not a softer failure category, it is the same failure category.
- Reuse the existing token-specificity logic (`hasSpecificNameOverlap` from Task 2) for confirmation comparisons — do not invent a second, parallel matching policy.
- TDD: write the failing test first, confirm it fails for the right reason, then implement.
- Run `yarn typecheck && yarn lint:check` from `be/` after each task, in addition to the task's own targeted test.
- One commit per task. No `--amend`. No push without explicit confirmation.
- Track A and Track B are independent — either can be implemented and reviewed on its own. Do not let a blocker in one stall the other.

---

## Current real state (baseline, verified during planning)

- `ExperienceProposalResolverService.resolveCandidate` (`be/src/modules/tours/services/experience-proposal-resolver.service.ts`) sets `status: 'resolved'` at three call sites — `persistOsmEntity` (local match, line ~480), `resolveViaNominatim` (global OSM, line ~586), `resolveViaPlaces` (Geoapify, line ~674) — with **no independent confirmation of any kind** today. A fuzzy token-overlap match (Task 2's `hasSpecificNameOverlap`, still permissive by design — it must accept legitimate substring/translation matches) is treated exactly the same as an exact match for persistence purposes.
- Live-confirmed (this session): the current 3-tier local→Nominatim→Geoapify chain can ALL be reflections of the same underlying OpenStreetMap record (Geoapify's own Autocomplete response carries `datasource.sourcename: "openstreetmap"`) — so "two of these three agree" is not real independent confirmation.
- `IWikidataApiService`/`WikidataApiService`/`CachedWikidataApiService` (`be/src/modules/integrations/wikidata/`) exist today for QID-keyed narrative enrichment only (`lookupEntitySummaries`/`getEntitySummaries`) — no geographic-proximity capability exists yet. `WikidataModule` exports `'WikidataApiService'`, already reachable from `ToursModule` via `IntegrationsModule`.
- Live-validated (this session, real SPARQL calls): `SELECT ... SERVICE wikibase:around { ?item wdt:P625 ?location. bd:serviceParam wikibase:center "Point(lon lat)"^^geo:wktLiteral. bd:serviceParam wikibase:radius "<km>". }` against `https://query.wikidata.org/sparql` returns real nearby entities with label + point. Confirmed on a 95-title independent sample of real Buenos Aires tourist attractions (from Wikipedia categories, not Wikidata itself): **74/95 (77.9%) found** by name search alone, with spot-checks showing this undercounts (English-title mismatches); real hit rate for proximity-based confirmation is expected to be at or above that.
- `ExperienceAcquisitionPlan.sourcePlans` is a closed union of `wikivoyage | google_places | web` (`be/src/modules/tours/interfaces/experience-acquisition-plan.interface.ts`). `ExperienceAcquisitionService.executeWebSourcePlan` (`be/src/modules/tours/services/experience-acquisition.service.ts`) calls exactly one `EXPERIENCE_GROUNDED_SEARCH_PROVIDER.search()` (SerpAPI `google_ai_mode` by default) then one `discoveryExtractor.extractExperiences()` call, pushing one `WebAcquisitionResult` into `webResults[]` (already an array — designed to hold more than one entry).
- Live-confirmed (this session, real curl): SerpAPI's `engine=tripadvisor` (`ssrc=A` for attractions/activities) returns real tour listings with rich prose descriptions naming actual stops (e.g. "Alberto J. Armando Stadium (La Bombonera), Casa Rosada, and Recoleta Cemetery") but **no GPS coordinates** — useful as extractor evidence (Track B), useless for confirmation (Track A).
- `nominatim-match.util.ts`'s `hasSpecificNameOverlap` (added in the 2026-09-16 plan, Task 2) is currently a **module-private** function, not exported.

---

# TRACK A — Cross-source confirmation (Wikidata)

## Task A1: Export the shared specificity-matching helper

**Files:**
- Modify: `be/src/modules/tours/utils/nominatim-match.util.ts`
- Test: `be/src/modules/tours/utils/nominatim-match.util.spec.ts`

**Interfaces:**
- Produces: `export function hasSpecificNameOverlap(needle: string, haystack: string): boolean` — same signature and behavior as today, just exported. Both `needle` and `haystack` are expected pre-normalized (the caller runs them through `normalizeGeoName` first, matching how `matchOsmCandidateByName` already uses it).

- [ ] **Step 1: Write the failing test**

Add to `be/src/modules/tours/utils/nominatim-match.util.spec.ts` (new top-level `describe`, after the `matchOsmCandidateByName` block):

```ts
describe('hasSpecificNameOverlap (exported for cross-source confirmation reuse)', () => {
  it('is importable and behaves identically to the existing matchOsmCandidateByName guards', () => {
    expect(hasSpecificNameOverlap('riachuelo', 'riachuelo')).toBe(true);
    expect(hasSpecificNameOverlap('malba museum', 'b')).toBe(false);
    expect(
      hasSpecificNameOverlap(
        'malba museum',
        'museo de arte latinoamericano de buenos aires malba',
      ),
    ).toBe(true);
  });
});
```

Add `hasSpecificNameOverlap` to the existing `import { ... } from './nominatim-match.util'` line at the top of the spec file.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/tours/utils/nominatim-match.util.spec.ts`
Expected: FAIL — `hasSpecificNameOverlap` is not exported, so the import is `undefined` and calling it throws `TypeError: hasSpecificNameOverlap is not a function`.

- [ ] **Step 3: Implement**

In `be/src/modules/tours/utils/nominatim-match.util.ts`, change:

```ts
function hasSpecificNameOverlap(needle: string, haystack: string): boolean {
```

to:

```ts
export function hasSpecificNameOverlap(needle: string, haystack: string): boolean {
```

No other change — the function body is already correct (Task 2).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/tours/utils/nominatim-match.util.spec.ts`
Expected: PASS, all tests (existing ones unaffected — this is a pure visibility change).

- [ ] **Step 5: Typecheck, lint**

Run: `yarn typecheck && yarn lint:check`

- [ ] **Step 6: Commit**

```bash
cd be
git add src/modules/tours/utils/nominatim-match.util.ts src/modules/tours/utils/nominatim-match.util.spec.ts
git commit -m "refactor(entity-resolution): export hasSpecificNameOverlap for reuse by cross-source confirmation

No behavior change. Task A2 needs the same token-specificity discipline
to compare a hint name against a Wikidata label, and must not
duplicate this logic as a second, independently-drifting policy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LfY1QJJffi4PR42UEK6rtw"
```

---

## Task A2: Wikidata geographic-proximity lookup

**Files:**
- Modify: `be/src/modules/integrations/wikidata/interfaces/wikidata.interface.ts`
- Modify: `be/src/modules/integrations/wikidata/services/wikidata-api.service.ts`
- Modify: `be/src/modules/integrations/wikidata/services/cached-wikidata-api.service.ts`
- Test: new `be/src/modules/integrations/wikidata/services/wikidata-api.service.spec.ts` additions, and `cached-wikidata-api.service.spec.ts` if it exists (check first: `find be/src/modules/integrations/wikidata -name '*.spec.ts'`; add a matching passthrough test either way)

**Interfaces:**
- Produces (new): `WikidataNearbyPlace { qid: string; label: string; latitude: number; longitude: number }` and `findNearbyPlaces(latitude: number, longitude: number, radiusMeters: number): Promise<WikidataNearbyPlace[]>` added to `IWikidataApiService`.
- Consumes (Task A3): this exact method.

- [ ] **Step 1: Write the failing test**

Add to `be/src/modules/integrations/wikidata/services/wikidata-api.service.spec.ts` (check the existing file's mock-http pattern first — it likely mocks `axios`; mirror that exactly):

```ts
describe('findNearbyPlaces', () => {
  it('queries the SPARQL endpoint with a wikibase:around service using lon,lat point and km radius, and maps bindings to WikidataNearbyPlace[]', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        results: {
          bindings: [
            {
              item: { value: 'http://www.wikidata.org/entity/Q1808336' },
              itemLabel: { value: 'Museum of Latin American Art of Buenos Aires' },
              location: { value: 'Point(-58.403593 -34.577111)' },
            },
          ],
        },
      },
    });

    const results = await service.findNearbyPlaces(-34.5768817, -58.4033919, 200);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://query.wikidata.org/sparql',
      expect.objectContaining({
        params: expect.objectContaining({
          format: 'json',
          query: expect.stringContaining('Point(-58.4033919 -34.5768817)'),
        }),
      }),
    );
    // radius param is in km — 200m -> "0.2"
    expect(mockedAxios.get.mock.calls[0][1].params.query).toContain(
      'wikibase:radius "0.2"',
    );
    expect(results).toEqual([
      {
        qid: 'Q1808336',
        label: 'Museum of Latin American Art of Buenos Aires',
        latitude: -34.577111,
        longitude: -58.403593,
      },
    ]);
  });

  it('returns an empty array (never throws) when the SPARQL endpoint fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

    const results = await service.findNearbyPlaces(-34.6, -58.4, 200);

    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/integrations/wikidata/services/wikidata-api.service.spec.ts`
Expected: FAIL — `service.findNearbyPlaces is not a function`.

- [ ] **Step 3: Implement**

In `be/src/modules/integrations/wikidata/interfaces/wikidata.interface.ts`, add:

```ts
export interface WikidataNearbyPlace {
  qid: string;
  label: string;
  latitude: number;
  longitude: number;
}
```

and add to `IWikidataApiService`:

```ts
  /**
   * Real, independent geographic confirmation signal (Task A2, 2026-09-17
   * cross-source confirmation plan): given a coordinate a DIFFERENT source
   * already claims for some named entity, ask Wikidata — a separately
   * curated database, not merely another read of the same OpenStreetMap
   * record most of this app's other geo providers ultimately share —
   * whether it independently has anything nearby. Live-validated via the
   * real SPARQL endpoint (wikibase:around service) before this method was
   * written. Never throws: a provider outage degrades to an empty result,
   * which the caller (ExperienceProposalResolverService) must treat as
   * "cannot confirm" — never as "confirmed absent".
   */
  findNearbyPlaces(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<WikidataNearbyPlace[]>;
```

In `be/src/modules/integrations/wikidata/services/wikidata-api.service.ts`, add (import `WikidataNearbyPlace` from the interface file):

```ts
  private readonly sparqlUrl = 'https://query.wikidata.org/sparql';

  async findNearbyPlaces(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<WikidataNearbyPlace[]> {
    const radiusKm = radiusMeters / 1000;
    const query = `
SELECT ?item ?itemLabel ?location WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?location.
    bd:serviceParam wikibase:center "Point(${longitude} ${latitude})"^^geo:wktLiteral.
    bd:serviceParam wikibase:radius "${radiusKm}".
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
}
LIMIT 30`;
    try {
      const response = await axios.get(this.sparqlUrl, {
        params: { format: 'json', query },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10_000,
      });
      const bindings = response.data?.results?.bindings || [];
      return bindings
        .map((b: any) => {
          const match = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(
            b.location?.value || '',
          );
          if (!match) return null;
          const qidMatch = /Q\d+$/.exec(b.item?.value || '');
          if (!qidMatch) return null;
          return {
            qid: qidMatch[0],
            label: b.itemLabel?.value || '',
            longitude: Number(match[1]),
            latitude: Number(match[2]),
          };
        })
        .filter((r: unknown): r is WikidataNearbyPlace => r !== null);
    } catch (error: any) {
      this.logger.warn(
        `Wikidata proximity lookup failed (${latitude},${longitude},${radiusMeters}m): ${error.message}`,
      );
      return [];
    }
  }
```

In `be/src/modules/integrations/wikidata/services/cached-wikidata-api.service.ts`, add a direct passthrough (this signal must stay fresh — never cache a geographic confirmation query, unlike the QID-keyed narrative lookups this class otherwise caches):

```ts
  async findNearbyPlaces(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<WikidataNearbyPlace[]> {
    return this.realService.findNearbyPlaces(latitude, longitude, radiusMeters);
  }
```

(Import `WikidataNearbyPlace` there too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/integrations/wikidata/services/wikidata-api.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Regression + typecheck + lint**

Run: `yarn test src/modules/integrations/wikidata/services/cached-wikidata-api.service.spec.ts` (if it exists — check the same `find` output from Files above; if it doesn't exist yet, skip and note that in the commit) and `yarn typecheck && yarn lint:check`.

- [ ] **Step 6: Commit**

```bash
cd be
git add src/modules/integrations/wikidata/
git commit -m "feat(wikidata): add geographic-proximity lookup for cross-source confirmation

New findNearbyPlaces(lat, lon, radiusMeters) using Wikidata's real
SPARQL wikibase:around service — live-validated against the real
endpoint before this was written (found the real MALBA museum entity
within 200m of its OSM-derived coordinate; found zero relevant results
within 350m of a real known-wrong OSM match, correctly).

Never caches (CachedWikidataApiService passes through directly) and
never throws (a provider outage returns [], which callers must treat
as 'cannot confirm', not 'confirmed absent').

See docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md Task A2.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LfY1QJJffi4PR42UEK6rtw"
```

---

## Task A3: Wire confirmation into the resolver — no more silent fuzzy-only persistence

**Files:**
- Modify: `be/src/modules/tours/services/experience-proposal-resolver.service.ts`
- Test: `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts`

**Interfaces:**
- Consumes: `hasSpecificNameOverlap`, `normalizeGeoName` (both already imported from `nominatim-match.util.ts`), `IWikidataApiService.findNearbyPlaces` (new, injected via the existing `'WikidataApiService'` DI token).
- Produces: `ResolvedGeoEntity` gains no new field — an unconfirmed match becomes `status: 'unresolved', reason: 'UNCONFIRMED_MATCH'` instead of `status: 'resolved'`. Verified: `ResolvedGeoEntity.reason?: string` (`experience-resolution.interface.ts`) is a bare `string`, not a union — no type change needed, `'UNCONFIRMED_MATCH'` is just a new literal value flowing through the existing field.

**Design (validated live, no invented thresholds):**

- A local exact match (`normalizeGeoName(matched.canonicalName) === normalizeGeoName(hint.name)`) or a global exact match is auto-confirmed — never needs Wikidata. This mirrors the "exact-equality is never a false positive" principle already used in Task 2.
- Anything else (a real match, but not exact) must independently confirm via `findNearbyPlaces(entity.latitude, entity.longitude, CONFIRMATION_RADIUS_METERS)`: at least one nearby Wikidata place whose label clears `hasSpecificNameOverlap` against the hint name.
- `CONFIRMATION_RADIUS_METERS` — use `200` (not tuned to any fixture; it is the same order of magnitude as the live-validated MALBA distance, ~50-80m, with real margin, and small enough that two DIFFERENT real venues in a dense area won't spuriously "confirm" each other).
- Provider-unavailable (`findNearbyPlaces` throws internally and already returns `[]`) must NOT be silently treated as "confirmed absent" — it must be treated as "cannot confirm", i.e. the match is NOT confirmed, and downgrades to `UNCONFIRMED_MATCH` (fail-closed, matches every other provider-unavailable rule already in this file, e.g. `OSM_PROVIDER_FAILED` vs `NO_OSM_MATCH`). Do not add a new distinct reason for this — Wikidata being down and Wikidata having nothing there are both, correctly, "could not confirm" from this boundary's perspective; the distinction is already visible in application logs (Task A2's own `logger.warn`) without needing a second ResolvedGeoEntity reason code.

- [ ] **Step 1: Write the failing tests**

Add to `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts` (new `describe` block near the end, before the closing `});` of the outer `describe`):

```ts
describe('cross-source confirmation (Task A3)', () => {
  const osmPlacesFor = (pois: any[]) => ({
    lookupStreetsWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: pois }),
  });

  it('auto-confirms an exact local name match without calling Wikidata', async () => {
    const wikidata = { findNearbyPlaces: jest.fn() };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      persistVerifiedExperience: jest
        .fn()
        .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation()),
    };
    const service = new ExperienceProposalResolverService(
      osmPlacesFor([
        {
          id: 'osm:node:1',
          name: 'Museum',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
          tags: {},
        },
      ]) as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      undefined,
      undefined,
      wikidata as any,
    );

    const result = await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(1);
    expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
  });

  it('confirms a fuzzy (non-exact) local match when Wikidata independently has something nearby with a matching name', async () => {
    const wikidata = {
      findNearbyPlaces: jest.fn().mockResolvedValue([
        {
          qid: 'Q1808336',
          label: 'Museum of Latin American Art of Buenos Aires',
          latitude: -34.5771,
          longitude: -58.4036,
        },
      ]),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      persistVerifiedExperience: jest
        .fn()
        .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('MALBA Museum')),
    };
    const service = new ExperienceProposalResolverService(
      osmPlacesFor([
        {
          id: 'osm:node:1',
          name: 'Museo de Arte Latinoamericano de Buenos Aires (MALBA)',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
          tags: {},
        },
      ]) as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      undefined,
      undefined,
      wikidata as any,
    );

    const result = await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate('MALBA Museum', 'MALBA Museum')],
    });

    expect(wikidata.findNearbyPlaces).toHaveBeenCalledWith(
      -34.5769,
      -58.4034,
      200,
    );
    expect(result.acceptedCount).toBe(1);
  });

  it('does NOT confirm — and rejects the candidate — when a fuzzy local match has no independent Wikidata corroboration nearby (real regression: "San Ignacio Church" -> "Ignacio Pirovano")', async () => {
    const wikidata = { findNearbyPlaces: jest.fn().mockResolvedValue([]) };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      persistVerifiedExperience: jest.fn(),
    };
    const geographicValidator = { validate: jest.fn() };
    const service = new ExperienceProposalResolverService(
      osmPlacesFor([
        {
          id: 'osm:node:1',
          name: 'Ignacio Pirovano',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.3948, -34.5878] },
          tags: {},
        },
      ]) as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      undefined,
      undefined,
      wikidata as any,
    );

    const result = await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate('San Ignacio Church', 'San Ignacio Church')],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
    });
    expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
  });

  it('does not confirm (fails closed) when Wikidata itself is unavailable — never treats provider failure as confirmation', async () => {
    const wikidata = {
      findNearbyPlaces: jest.fn().mockRejectedValue(new Error('down')),
    };
    // ... same shape as the previous test; findNearbyPlaces rejecting must
    // still result in status: 'unresolved', reason: 'UNCONFIRMED_MATCH'
    // (the resolver must catch this itself — never assume the injected
    // Wikidata service always resolves, even though the real
    // WikidataApiService.findNearbyPlaces never throws (Task A2) — a test
    // double is allowed to be stricter than the real implementation to
    // prove the resolver doesn't silently rely on that contract).
  });
});
```

(The last test's body is deliberately left for the implementer to fill in identically to the third test, swapping the mock — spelled out here as a placeholder-note only because it is byte-identical boilerplate to the test above it; every other test in this plan is complete, runnable code as required.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
Expected: FAIL — the constructor doesn't accept a 7th `wikidata` argument yet (TS/runtime error or `undefined` used as an object), and no confirmation logic exists, so the "not confirmed" tests would currently show `acceptedCount: 1` instead of `0`.

- [ ] **Step 3: Implement**

In `be/src/modules/tours/services/experience-proposal-resolver.service.ts`:

1. Verified current state: `experience-proposal-resolver.service.ts`'s existing import from `../utils/nominatim-match.util` (lines 22-27) is:

```ts
import {
  bestNominatimMatch,
  isAreaScaleEligible,
  matchOsmCandidateByName,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
```

`normalizeGeoName` is already imported — only add `hasSpecificNameOverlap` to this same block:

```ts
import {
  bestNominatimMatch,
  hasSpecificNameOverlap,
  isAreaScaleEligible,
  matchOsmCandidateByName,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
```

2. Add the constant near the top of the file, alongside `RESOLVER_CANDIDATE_CONCURRENCY`:

```ts
/**
 * Real margin above the live-validated MALBA distance (~50-80m between the
 * OSM-derived point and Wikidata's own point for the same real place),
 * small enough that two genuinely different nearby venues won't spuriously
 * confirm each other. Not tuned to any specific fixture.
 */
const CONFIRMATION_RADIUS_METERS = 200;
```

3. Add the Wikidata dependency to the constructor (as an 8th, `@Optional()` parameter — optional so this remains backward-compatible with every existing test construction that doesn't pass it; when absent, treat as "cannot confirm" for any non-exact match, same as a provider failure):

```ts
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidata?: IWikidataApiService,
```

(Add the corresponding import: `import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';`)

4. Add the confirmation helper as a new private method:

```ts
  /**
   * Task A3 (2026-09-17 cross-source confirmation plan): a match is only
   * as trustworthy as its identity evidence. Exact name equality in the
   * correct pool is strong enough on its own — never a false positive.
   * Anything short of that (the fuzzy token-overlap path Task 2 already
   * requires for ANY match at all) must be independently corroborated by
   * a genuinely separate database before it counts as resolved. A
   * provider outage is "cannot confirm", never "confirmed absent" — the
   * caller must treat both identically (fail closed).
   */
  private async confirmMatch(
    entity: ResolvedGeoEntity,
    hint: any,
  ): Promise<boolean> {
    const isExact =
      normalizeGeoName(entity.canonicalName || '') ===
      normalizeGeoName(hint.name);
    if (isExact) return true;
    if (!this.wikidata) return false;
    if (
      !Number.isFinite(entity.latitude) ||
      !Number.isFinite(entity.longitude)
    ) {
      return false;
    }
    let nearby: Array<{ label: string }>;
    try {
      nearby = await this.wikidata.findNearbyPlaces(
        entity.latitude as number,
        entity.longitude as number,
        CONFIRMATION_RADIUS_METERS,
      );
    } catch {
      return false;
    }
    const needle = normalizeGeoName(hint.name);
    return nearby.some((place) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(place.label)),
    );
  }
```

5. In `resolveCandidate`'s hint loop, wrap BOTH success paths (the local `matched` branch and the `globallyResolved` branch) with the confirmation check. Find this existing code:

```ts
      if (matched) {
        entities.push(await this.persistOsmEntity(hint, matched));
        continue;
      }

      if (destinationAssociationVerified) {
        const globallyResolved = await this.resolveTrustedGlobalHint(
          hint,
          destinationCountryCode,
          this.representativePoint(boundary),
        );
        if (globallyResolved) {
          entities.push(globallyResolved);
          continue;
        }
      }
```

Replace with:

```ts
      if (matched) {
        const resolvedEntity = await this.persistOsmEntity(hint, matched);
        entities.push(
          (await this.confirmMatch(resolvedEntity, hint))
            ? resolvedEntity
            : {
                hintKey: hint.key,
                hintName: hint.name,
                provider: resolvedEntity.provider,
                externalId: '',
                role: hint.role,
                status: 'unresolved',
                reason: 'UNCONFIRMED_MATCH',
              },
        );
        continue;
      }

      if (destinationAssociationVerified) {
        const globallyResolved = await this.resolveTrustedGlobalHint(
          hint,
          destinationCountryCode,
          this.representativePoint(boundary),
        );
        if (globallyResolved) {
          entities.push(
            (await this.confirmMatch(globallyResolved, hint))
              ? globallyResolved
              : {
                  hintKey: hint.key,
                  hintName: hint.name,
                  provider: globallyResolved.provider,
                  externalId: '',
                  role: hint.role,
                  status: 'unresolved',
                  reason: 'UNCONFIRMED_MATCH',
                },
          );
          continue;
        }
      }
```

Note this deliberately drops `geoEntityId` on the unconfirmed branch (the object literal doesn't set it) — an entity that fails confirmation must never carry a `geoEntityId` forward, since `dedupeResolvedEntitiesByGeoEntity` and `persistVerifiedExperience`'s `components` mapping both key off exactly that field; a `status: 'unresolved'` entity is already filtered out by the existing `resolvedEntities.filter((entity) => entity.status === 'resolved')` calls throughout this file, so this alone is sufficient — no other call site needs to change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
Expected: PASS, all tests (new + all pre-existing). Every pre-existing test constructs the service with 3-6 positional args and never passes a `wikidata` argument — with it `undefined` (the `@Optional()` default), `confirmMatch` returns `false` for any NON-exact match. Re-verify each pre-existing test's fixtures use EXACT name matches (this was already confirmed true for Task 2's own regression pass — re-confirm here since this is now a stricter gate) — if any pre-existing test relies on a fuzzy-only match succeeding, that test's premise needs updating in place (flag it explicitly in the commit message, same as the Task 2/Geoapify precedent — do not silently loosen the new gate to avoid touching a test).

- [ ] **Step 5: Typecheck, lint**

Run: `yarn typecheck && yarn lint:check`

- [ ] **Step 6: Commit**

```bash
cd be
git add src/modules/tours/services/experience-proposal-resolver.service.ts src/modules/tours/services/experience-proposal-resolver.service.spec.ts
git commit -m "feat(entity-resolution): require cross-source confirmation for any non-exact match

Exact name match in the correct pool is trusted directly (never a
false positive). Anything else — including every fuzzy token-overlap
match Task 2 already requires — must now be independently confirmed
by Wikidata's real geographic-proximity data (Task A2) before it
counts as resolved. An unconfirmed match becomes UNRESOLVED
(reason: UNCONFIRMED_MATCH), never silently persisted.

This is a hard product requirement, not a heuristic improvement: a
wrong-but-plausible match must never reach a user as a confirmed
Experience component. Live-validated real regression: 'San Ignacio
Church' -> 'Ignacio Pirovano' (a real, different Buenos Aires entity
that merely shares one token) has zero Wikidata corroboration nearby
and is now correctly rejected instead of silently persisted.

Provider-unavailable is treated identically to no-corroboration-found
(fail closed) — Wikidata being down must never be read as 'confirmed
absent'.

See docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md Task A3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LfY1QJJffi4PR42UEK6rtw"
```

---

## Task A4: Re-measure (Task 3 pattern) with confirmation live

- [ ] Re-run the same 6-theme Buenos Aires characterization methodology (temporary, never-committed `characterize-composite` command — see the 2026-09-16 plan's Task 3 for the exact mechanism and revert discipline) with `AI_PROVIDER=groq`, `DISCOVERY_EXTRACTOR_PROVIDER=groq`, `CLASSIFICATION_PROVIDER=groq`, `GROUNDED_SEARCH_PROVIDER=serpapi`.
- [ ] Report, per hint that resolved before confirmation was added but is now `UNCONFIRMED_MATCH`: was it a real, previously-undetected wrong match (expected, correct new behavior) or a real, correct match that Wikidata simply doesn't have (an accepted, honest loss — do not treat this as a bug to fix by loosening the gate)?
- [ ] Report the new composite persistence rate against the existing baselines (12.5% pre-fix, later runs at 0-33% on tiny samples) — expect this to be lower yet again in raw count (fewer things get through a stricter gate) while being qualitatively trustworthy for the first time. Do not react to a lower raw number by weakening Task A3 — that is the intended trade-off the product requirement demands.

---

# TRACK B — TripAdvisor as an additional volume source

## Task B1: `TripAdvisorGroundedSearchService` — real evidence, not structured observations

**Why not a `SourceObservation`-based provider (like Wikivoyage/Google Places):** live-confirmed (this session) that SerpAPI's `tripadvisor` engine returns rich prose descriptions naming multiple real stops but **no coordinates** — and `StructuredExperienceCandidateSynthesizerService` mechanically maps one `SourceObservation` to exactly one single-place `componentHint` (see the 2026-09-15 review's Root Cause analysis). Feeding TripAdvisor through that path would only ever produce more single-place noise, never composites — defeating the entire point of adding it. It must feed the discovery **extractor** instead, the same way the primary web query's SerpAPI evidence does.

**Why a separate extractor call, not merged into the same prompt as the primary web query:** Groq's real, observed OTPM (output-tokens-per-minute) quota is tight (live-confirmed 429s at "Limit 1000" throughout this session). Appending more evidence text to the same extraction call risks pushing it over that limit more often, not less. A second, separate `WebAcquisitionResult` entry (the array already supports more than one) keeps each individual extraction call's evidence volume unchanged.

**Files:**
- Create: `be/src/modules/tours/services/tripadvisor-grounded-search.service.ts`
- Test: `be/src/modules/tours/services/tripadvisor-grounded-search.service.spec.ts`

**Interfaces:**
- Produces: a class implementing the existing `ExperienceGroundedSearchProvider` interface (`be/src/modules/tours/interfaces/experience-grounding.interface.ts` — read this file first to get the exact method signature and `ExperienceGroundedSearchResult`/`ExperienceGroundingEvidence` shapes before writing the implementation; every other grounded-search service in this directory, e.g. `serpapi-grounded-search.service.ts`, already implements it — mirror that contract exactly). This class is instantiated directly by `ExperienceAcquisitionService` (Task B2), not resolved through the swappable `EXPERIENCE_GROUNDED_SEARCH_PROVIDER` DI token — it is always additive, never a provider swap.

- [ ] **Step 1: Read the exact contract first**

Read `be/src/modules/tours/interfaces/experience-grounding.interface.ts` and `be/src/modules/tours/services/serpapi-grounded-search.service.ts`'s `searchGeneral`/general-path method in full before writing a single line — the evidence-key format (`ev-N`), `groundingStatus` values (`'applied' | 'no_usable_evidence' | 'failed' | 'unavailable'`), and `ExperienceGroundedSearchResult` field names must match exactly what the discovery extractor already expects (it is the same extractor used for the primary web query).

- [ ] **Step 2: Write the failing test**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TripAdvisorGroundedSearchService } from './tripadvisor-grounded-search.service';

jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TripAdvisorGroundedSearchService', () => {
  let service: TripAdvisorGroundedSearchService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn().mockReturnValue('test-serpapi-key') };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TripAdvisorGroundedSearchService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(TripAdvisorGroundedSearchService);
    jest.clearAllMocks();
  });

  it('queries engine=tripadvisor with ssrc=A and maps place descriptions into evidence', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        places: [
          {
            title: 'Buenos Aires City Private Tour with Local Guide',
            description:
              'Among the stops are Alberto J. Armando Stadium (La Bombonera), Casa Rosada, and Recoleta Cemetery.',
            place_id: '19107639',
          },
        ],
      },
    });

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['history'],
      query: 'Buenos Aires walking tour',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://serpapi.com/search.json',
      expect.objectContaining({
        params: expect.objectContaining({
          engine: 'tripadvisor',
          q: 'Buenos Aires walking tour',
          ssrc: 'A',
          api_key: 'test-serpapi-key',
        }),
      }),
    );
    expect(result.groundingStatus).toBe('applied');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].snippet).toContain('Alberto J. Armando Stadium');
  });

  it('reports no_usable_evidence when TripAdvisor returns no places', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { places: [] } });

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: [],
      query: 'anything',
    });

    expect(result.groundingStatus).toBe('no_usable_evidence');
    expect(result.evidence).toEqual([]);
  });

  it('reports unavailable when no SerpAPI key is configured', async () => {
    configService.get.mockReturnValue(undefined);

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: [],
      query: 'anything',
    });

    expect(result.groundingStatus).toBe('unavailable');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('reports failed when the request throws', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('network down'));

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: [],
      query: 'anything',
    });

    expect(result.groundingStatus).toBe('failed');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/tripadvisor-grounded-search.service.spec.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 4: Implement**

Write `TripAdvisorGroundedSearchService`, matching the exact `ExperienceGroundedSearchProvider` interface read in Step 1. Key shape (adapt field names to whatever Step 1's real interface requires — do not guess a shape that conflicts with it):

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
} from '../interfaces/experience-grounding.interface';

interface TripAdvisorPlace {
  title?: string;
  description?: string;
  place_id?: string;
  rating?: number;
  reviews?: number;
}

@Injectable()
export class TripAdvisorGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(TripAdvisorGroundedSearchService.name);
  private readonly apiUrl = 'https://serpapi.com/search.json';
  private readonly timeoutMs = 65_000; // same real-world margin as SerpApiGroundedSearchService

  constructor(private readonly config: ConfigService) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const apiKey =
      this.config.get<string>('ai.serpApiKey') || process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      return {
        provider: 'tripadvisor',
        model: 'tripadvisor-search',
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_serpapi_key',
      };
    }

    try {
      const response = await axios.get(this.apiUrl, {
        params: {
          engine: 'tripadvisor',
          q: request.query || request.destinationName,
          ssrc: 'A',
          api_key: apiKey,
        },
        timeout: this.timeoutMs,
      });

      const places: TripAdvisorPlace[] = response.data?.places || [];
      const evidence = places
        .filter((p) => p.title && p.description)
        .map((p, index) => ({
          key: `ev-${index + 1}`,
          source: 'tripadvisor',
          title: p.title as string,
          snippet: p.description as string,
          url: p.place_id
            ? `https://www.tripadvisor.com/Attraction_Review-${p.place_id}`
            : undefined,
        }));

      return {
        provider: 'tripadvisor',
        model: 'tripadvisor-search',
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        rawOutput: JSON.stringify(response.data),
      };
    } catch (error: any) {
      this.logger.error(`TripAdvisor search failed: ${error.message}`);
      return {
        provider: 'tripadvisor',
        model: 'tripadvisor-search',
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error.message,
      };
    }
  }
}
```

(Reconcile field names against whatever Step 1 actually found — this sketch is deliberately explicit about intent so a mismatch against the real interface is easy to spot and fix, not a reason to skip reading the real interface first.)

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test src/modules/tours/services/tripadvisor-grounded-search.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint**

Run: `yarn typecheck && yarn lint:check`

- [ ] **Step 7: Commit**

```bash
cd be
git add src/modules/tours/services/tripadvisor-grounded-search.service.ts src/modules/tours/services/tripadvisor-grounded-search.service.spec.ts
git commit -m "feat(acquisition): add TripAdvisorGroundedSearchService as a real evidence source

SerpApi's engine=tripadvisor (ssrc=A, real endpoint live-validated
this session) returns real tour-operator descriptions naming actual
stops (e.g. 'Alberto J. Armando Stadium (La Bombonera), Casa Rosada,
and Recoleta Cemetery') but no coordinates — useful only as discovery-
extractor evidence, never as a structured single-place observation
(confirmed: feeding it through the existing SourceObservation path
would only produce more single-place noise, per
StructuredExperienceCandidateSynthesizerService's 1:1 mechanical
mapping). Implements the same ExperienceGroundedSearchProvider
interface every other grounded-search service already does. Not yet
wired into acquisition — see Task B2.

See docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md Task B1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LfY1QJJffi4PR42UEK6rtw"
```

---

## Task B2: Wire TripAdvisor into `executeWebSourcePlan` as a second, additive evidence pass

**Files:**
- Modify: `be/src/modules/tours/services/experience-acquisition.service.ts`
- Modify: `be/src/modules/tours/tours.module.ts` (register `TripAdvisorGroundedSearchService` as a provider, inject it into `ExperienceAcquisitionService`)
- Test: `be/src/modules/tours/services/experience-acquisition.service.spec.ts`

**Interfaces:**
- Consumes: `TripAdvisorGroundedSearchService` (Task B1), injected directly (not via the swappable token) as a new `@Optional()` constructor parameter on `ExperienceAcquisitionService`.
- Produces: `executeWebSourcePlan` (or `executePlan`, wherever the loop over `sourcePlans` lives — read the current code first, this plan's earlier read of it was for `executeWebSourcePlan`'s primary-query logic only) pushes a SECOND `WebAcquisitionResult` into the `webResults[]` array for every `web` SourcePlan, with `groundedProvider: 'tripadvisor'`, running the SAME `discoveryExtractor.extractExperiences()` call but with TripAdvisor's own evidence only (never merged with the primary query's evidence array).

- [ ] **Step 1: Read the exact current loop first**

Re-read `executePlan`'s web-sourceplan loop and `executeWebSourcePlan` in full in `experience-acquisition.service.ts` (already read once during the original characterization review — re-read now since Task A3 may have touched nearby code) to get the exact current structure before adding a second call.

- [ ] **Step 2: Write the failing test**

Add to `experience-acquisition.service.spec.ts` (mirror whatever mocking pattern the existing web-sourceplan tests already use for `groundedSearchProvider`/`discoveryExtractor`):

```ts
it('runs a second, separate TripAdvisor evidence pass for a web SourcePlan and appends its own WebAcquisitionResult (never merged into the primary query evidence)', async () => {
  // Arrange: primary groundedSearchProvider + discoveryExtractor mocks as
  // the existing web-sourceplan tests already do, PLUS:
  const tripAdvisor = {
    search: jest.fn().mockResolvedValue({
      provider: 'tripadvisor',
      model: 'tripadvisor-search',
      groundingStatus: 'applied',
      evidence: [
        { key: 'ev-1', source: 'tripadvisor', title: 'A Tour', snippet: 'Stops: X, Y, Z.' },
      ],
    }),
  };
  // ... construct ExperienceAcquisitionService with tripAdvisor injected ...

  const result = await service.executePlan(plan /* a plan with one 'web' sourcePlan */);

  expect(tripAdvisor.search).toHaveBeenCalled();
  expect(result.webResults).toHaveLength(2);
  expect(result.webResults?.[1].groundedProvider).toBe('tripadvisor');
  // The primary query's own evidence must be unaffected/unmerged:
  expect(result.webResults?.[0].evidenceKeys).not.toEqual(
    expect.arrayContaining(['ev-1']),
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/experience-acquisition.service.spec.ts`
Expected: FAIL — `tripAdvisor.search` never called, `webResults` has length 1.

- [ ] **Step 4: Implement**

In `ExperienceAcquisitionService`'s constructor, add:

```ts
    @Optional()
    private readonly tripAdvisor?: TripAdvisorGroundedSearchService,
```

In the web-sourceplan loop (inside `executePlan`, where it currently does `webResults.push(await this.executeWebSourcePlan(plan, sourcePlan.web, {...}))`), add a second push when `this.tripAdvisor` is present:

```ts
      webResults.push(
        await this.executeWebSourcePlan(plan, sourcePlan.web, {
          webCandidates,
          webEvidence,
        }),
      );
      if (this.tripAdvisor) {
        webResults.push(
          await this.executeWebSourcePlanWithProvider(
            plan,
            sourcePlan.web,
            this.tripAdvisor,
            { webCandidates, webEvidence },
          ),
        );
      }
```

Refactor `executeWebSourcePlan`'s body into a new `executeWebSourcePlanWithProvider(plan, web, provider, sink)` that takes the grounded-search provider as a parameter instead of always reading `this.groundedSearchProvider` — then `executeWebSourcePlan` becomes a one-line wrapper calling it with `this.groundedSearchProvider`. This is the only way to run the identical extraction logic against a second provider without duplicating the whole method — do it as a pure signature change, no behavior change to the primary path (verify with the full pre-existing `experience-acquisition.service.spec.ts` suite before considering this step done).

In `tours.module.ts`: add `TripAdvisorGroundedSearchService` to `providers: [...]`, and add it as an injected constructor argument where `ExperienceAcquisitionService` is instantiated (NestJS resolves this automatically via DI as long as it's a provider in the module — no `useFactory` needed, unlike `EXPERIENCE_GROUNDED_SEARCH_PROVIDER`, since this is never swapped).

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test src/modules/tours/services/experience-acquisition.service.spec.ts`
Expected: PASS — the new test, and every pre-existing web-sourceplan test (which must still show exactly ONE `webResults` entry when `tripAdvisor` is not injected — confirm the DI wiring change doesn't silently activate it for tests that construct the service with fewer arguments and expect `tripAdvisor` to be `undefined`).

- [ ] **Step 6: Typecheck, lint, full backend regression**

Run: `yarn typecheck && yarn lint:check && yarn test`

- [ ] **Step 7: Commit**

```bash
cd be
git add src/modules/tours/services/experience-acquisition.service.ts src/modules/tours/services/experience-acquisition.service.spec.ts src/modules/tours/tours.module.ts
git commit -m "feat(acquisition): run TripAdvisor as a second, additive evidence pass per web SourcePlan

Wired TripAdvisorGroundedSearchService (Task B1) into
ExperienceAcquisitionService.executePlan: every 'web' SourcePlan now
also runs a second, separate extraction pass against TripAdvisor's
own evidence, appended as its own WebAcquisitionResult entry — never
merged into the primary SerpApi query's evidence array, to avoid
pushing a single extraction call over Groq's tight OTPM quota (live-
confirmed 429s throughout this session at 'Limit 1000').

executeWebSourcePlan's body is now shared (executeWebSourcePlanWithProvider)
between the primary provider and TripAdvisor — no duplicated logic,
no behavior change to the primary path (full pre-existing suite
verified green).

See docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md Task B2.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LfY1QJJffi4PR42UEK6rtw"
```

---

## Task B3: Re-measure combined (Track A + Track B) impact

- [ ] Re-run the same 6-theme characterization with both tracks live. Report the same numbers as Task A4 (composite candidates generated, confirmed-and-persisted, unique entity resolutions, confirmation rate), plus how many additional raw composite candidates TripAdvisor's evidence pass contributed versus the primary SerpAPI query alone.
- [ ] Do not treat this as the final word on volume — this plan closes the confirmation gap (non-negotiable) and adds one additional evidence source (a real, incremental improvement). Reaching 15-20 confirmed composites per destination, if still not met after this, is a `catalog-first sustained acquisition` question (already discussed, explicitly out of scope for this plan) — do not attempt to force that number by weakening Task A3's gate.

---

## Self-review

**Spec coverage:** Track A implements exactly the cross-source confirmation mechanism validated live in conversation (Wikidata proximity + exact-match fast path). Track B implements TripAdvisor exactly as validated (evidence-only, never structured-observation, never merged into the primary extraction call). Both re-measurement tasks (A4, B3) are included so the plan doesn't end without evidence of real impact, matching this session's own established discipline.

**Placeholder scan:** One acknowledged, explicit exception in Task A3 Step 1 (the 4th test's body, flagged as intentionally byte-identical boilerplate to the test above it rather than re-typed) — every other test and implementation step is complete, real code. Task B1/B2's code sketches explicitly instruct reading the real interface first rather than guessing field names, because the exact `ExperienceGroundedSearchProvider`/`ExecuteAcquisitionPlanResult` shapes were not re-read line-by-line during this planning pass (unlike Track A, which reused already-fully-read code) — this is a deliberate, flagged gap for the implementer to close before writing code, not a placeholder to skip.

**Type consistency:** `WikidataNearbyPlace`, `findNearbyPlaces`, `hasSpecificNameOverlap`, `CONFIRMATION_RADIUS_METERS`, and `UNCONFIRMED_MATCH` are used with the same names/shapes everywhere they appear across Tasks A1-A3.
