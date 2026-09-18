# Confirmation Collision Fix + Anchor Scope Narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (Task A5) Close the real, live-verified false-positive class Task A4 found — a fuzzy local match that shares only ONE generic neighborhood/historical-figure token with an unrelated Wikidata entity gets wrongly treated as "independently confirmed" (`"Recoleta Cemetery"` → `"Hotel Urban Suites Recoleta"`; `"Galería Güemes"` → `"Martín Miguel de Güemes"`). (Task A6 / Root Cause #4) Narrow entity resolution's local OSM pool query to a resolved AREA anchor's own boundary (e.g. San Telmo) instead of always querying the whole destination (all of Buenos Aires), reducing both false-positive collisions and honest ambiguity.

**Architecture:** Task A5 tightens `confirmMatch`'s Wikidata-corroboration bar specifically for confirmation (not for matching, which must stay permissive for legitimate translation/substring matches) by requiring ALL of the hint's significant tokens to appear in the corroborating label, not just ≥50%. Task A6 threads a resolved AREA anchor's own `OsmCandidate` boundary (already fetched from Overpass during anchor resolution, currently discarded before it reaches the resolver) through `ResolvedAnchor` → `AreaRouteWalkAcquisitionService` → `ExperienceAcquisitionService.materializeExecution` → a new, optional `entityResolutionScope` on `ExperienceResolutionRequest`, used ONLY to scope the local Overpass POI/street pool fetch — the existing destination-wide `geographicScope`/`boundary` keeps flowing unchanged into `CompositeGeographicValidationService.validate()`, so destination-mismatch validation semantics do not change.

**Tech Stack:** TypeScript, NestJS, Jest.

**Spec:** `docs/superpowers/characterization/2026-09-17-task-a4-confirmation-live-remeasure.md` (Task A5's real regression fixtures come directly from this report's live Wikidata verification); `docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md` §14 Root Cause #4 (Task A6's original diagnosis); `docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md` (Task A3, whose `confirmMatch`/`hasSpecificNameOverlap` this plan builds directly on top of).

## Global Constraints

- No hardcoded fixture-specific rules (no `if (hint.name === 'Recoleta Cemetery')`, no destination-name special cases). Both tasks are generic and destination-agnostic.
- Task A5 must NOT change `hasSpecificNameOverlap`'s default (no-options) behavior — every existing caller (`matchOsmCandidateByName`, `bestNominatimMatch`'s fuzzy path) keeps today's ≥50%-token bar unchanged. The stricter bar is opt-in, used only by `confirmMatch`.
- Task A6 must NOT change `CompositeGeographicValidationService.validate()`'s `destinationBoundary` argument — it must keep receiving the full destination-wide boundary exactly as today, in every caller, including when `entityResolutionScope` is present. Narrowing that argument would silently break `destination_mismatch`/`isInsideDestination` semantics for candidates whose components legitimately span slightly outside the narrow anchor but still inside the real destination.
- Task A6 only narrows the LOCAL OSM POOL fetch (`lookupStreetsWithin`/`lookupPoisWithin`) and `resolveCandidate`'s own `boundary` parameter (used for AREA-role hint pool selection and the trusted-global-hint fallback's representative point) — never validation.
- Task A6 is scoped to AREA anchors only (a real Overpass "within area" query needs a way/relation polygon). ROUTE anchors (LineString) and venue anchors (a single point) are out of scope for this task — no attempt to narrow entity resolution for those kinds here.
- `ExperienceResolutionRequest.entityResolutionScope` is optional and additive: every existing caller that never sets it (the generic acquisition loop, `acquireNearby`, every current test) must see byte-identical behavior to before this plan — `resolve()` falls back to `input.geographicScope` when it is absent.
- TDD: write the failing test first, confirm it fails for the right reason, then implement.
- Run `yarn typecheck && yarn lint:check` from `be/` after each task, in addition to the task's own targeted test file(s) and the full existing spec file(s) being modified (regression check).
- One commit per task. No `--amend`. No push without explicit user confirmation.
- Task A5 and Task A6 are independent of each other technically (A5 touches only `nominatim-match.util.ts`/`experience-proposal-resolver.service.ts`'s `confirmMatch`; A6 touches anchor resolution + acquisition + `resolve()`'s pool-fetch lines) — implement in order (A5 first) since it is smaller and lower-risk, but a reviewer could accept one without the other.

---

## Current real state (baseline, verified in this planning pass by reading the live code, not assumed)

- `ExperienceProposalResolverService.confirmMatch` (`be/src/modules/tours/services/experience-proposal-resolver.service.ts:482-511`) calls `hasSpecificNameOverlap(needle, normalizeGeoName(place.label))` with no options — the same ≥50%-token/≥1-token-≥5-chars bar `matchOsmCandidateByName` uses for MATCHING. Live-verified against the real Wikidata SPARQL endpoint during Task A4: for hint `"Recoleta Cemetery"` (needle tokens `['recoleta','cemetery']`), a nearby Wikidata place labeled anything containing just `"recoleta"` (extremely common in that neighborhood) satisfies `1/2 >= 0.5` and `'recoleta'.length >= 5` — wrongly confirming an unrelated match. Same shape for `"Galería Güemes"` (tokens `['galeria','guemes']`) against Wikidata's real, distinct `"Martín Miguel de Güemes"` (Q111695025) entity sharing only `'guemes'`.
- `hasSpecificNameOverlap(needle: string, haystack: string): boolean` (`be/src/modules/tours/utils/nominatim-match.util.ts:202-219`) has no options parameter today — exact string match only.
- `AnchorGeoCandidate` (`be/src/modules/tours/services/area-route-anchor-resolver.service.ts:44-54`) has no `osmBoundary` field. `discoverArea` (line 355-413) already calls `this.osmPlaces.lookupBoundaryById(match.osmType, match.osmId)` and gets back a full `OsmCandidate` (`boundary.value`, shape `{id, name, osmType, osmId, geometry, tags}`) at line 383-386, but only forwards `.geometry`/`.name`/`.id`(as `externalId`)/`.tags` into the returned candidate (lines 396-409) — `osmType`/`osmId` are discarded.
- `persistCandidate` (line 315-346) is the ONE place that turns an `AnchorGeoCandidate` into a `ResolvedAnchor` (resolved variant) for the live path — used by both `resolveNamedAnchors` (line 178, the only caller in the live request flow — `resolveArea`/`resolveRoute` standalone public methods are not called anywhere outside this file's own tests, confirmed via repo-wide grep) and `resolveArea` (which does NOT reuse `persistCandidate`'s return value for its own `AnchorGeometryResolution` return type — out of scope for this plan).
- `ResolvedAnchor`'s resolved variant (`be/src/modules/tours/interfaces/preference-spec.interface.ts:47-58`) has no `osmBoundary` field.
- `AreaRouteWalkAcquisitionService.acquireOrReuse` (`be/src/modules/tours/services/area-route-walk-acquisition.service.ts:124-153`) builds a local `resolution` object directly from `input.anchor`'s existing fields (`geoEntityId`, `canonicalName`, `provider`, `externalId`, `geometry`) — no `osmBoundary` today. It passes `geographicScope: input.geographicScope` (line 349) straight through into `materializeExecution` unchanged — this is always the whole-destination `GeographicScope` computed once in `ExperienceGenerationService` (`experience-generation.service.ts:903-910`) and reused for every acquisition strategy, area-anchored or not.
- `ExperienceAcquisitionService.materializeExecution` (`experience-acquisition.service.ts:646-671`) forwards `context.geographicScope`/`context.validationScope`/`context.validationIntent` into `this.proposalResolver.resolve({...})` — no `entityResolutionScope` field exists on either the context param or `ExperienceResolutionRequest` today.
- `ExperienceProposalResolverService.resolve()` (lines 113-159) derives exactly one `boundary` from `input.geographicScope` and uses it for BOTH (a) the `lookupStreetsWithin`/`lookupPoisWithin` local-pool fetch and (b) `resolveCandidate`'s `boundary` parameter (AREA-hint pool selection, trusted-global-hint representative point) — the SAME `boundary` is also passed as `CompositeGeographicValidationService.validate`'s `destinationBoundary` argument (line 179-185), which the validator uses for `isInsideDestination`/`destinationMismatch` checks (`composite-geographic-validation.service.ts`) — this must keep receiving the full destination boundary, confirmed by reading its real usage.

---

# Task A5: Stricter confirmation-only token bar

**Files:**
- Modify: `be/src/modules/tours/utils/nominatim-match.util.ts`
- Test: `be/src/modules/tours/utils/nominatim-match.util.spec.ts`
- Modify: `be/src/modules/tours/services/experience-proposal-resolver.service.ts`
- Test: `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts`

**Interfaces:**
- Consumes: nothing new — reuses `hasSpecificNameOverlap`'s existing exported signature, extending it with a new optional parameter.
- Produces: `hasSpecificNameOverlap(needle: string, haystack: string, options?: { requireAllTokens?: boolean }): boolean` — every existing call site (no third argument) is byte-identical to today.

- [ ] **Step 1: Write the failing test for the stricter option in the util**

Add to `be/src/modules/tours/utils/nominatim-match.util.spec.ts`, inside the existing `describe('hasSpecificNameOverlap (exported for cross-source confirmation reuse)', ...)` block:

```ts
it('requireAllTokens rejects a same-generic-token collision that the default (>=50%) bar would wrongly accept (real regression, Task A4: "Recoleta Cemetery" -> "Hotel Urban Suites Recoleta"; "Galería Güemes" -> "Martín Miguel de Güemes")', () => {
  // Default behavior (today's matching bar) is UNCHANGED and still accepts
  // these -- that permissiveness is correct for MATCHING, not for
  // independently confirming an identity.
  expect(
    hasSpecificNameOverlap('recoleta cemetery', 'hotel urban suites recoleta'),
  ).toBe(true);
  expect(
    hasSpecificNameOverlap('galeria guemes', 'martin miguel de guemes'),
  ).toBe(true);

  // requireAllTokens: true is the stricter confirmation-only bar -- both
  // real collisions must now be rejected.
  expect(
    hasSpecificNameOverlap('recoleta cemetery', 'hotel urban suites recoleta', {
      requireAllTokens: true,
    }),
  ).toBe(false);
  expect(
    hasSpecificNameOverlap('galeria guemes', 'martin miguel de guemes', {
      requireAllTokens: true,
    }),
  ).toBe(false);
});

it('requireAllTokens still confirms a genuine two-token match where every significant token is present (regression guard: must not become too strict)', () => {
  expect(
    hasSpecificNameOverlap(
      'museo nacional de bellas artes',
      'museo nacional de bellas artes buenos aires',
      { requireAllTokens: true },
    ),
  ).toBe(true);
});

it('requireAllTokens does not change single-significant-token matches (a single token at 100% is the same bar as at 50%)', () => {
  expect(
    hasSpecificNameOverlap(
      'malba',
      'museo de arte latinoamericano de buenos aires malba',
      { requireAllTokens: true },
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/tours/utils/nominatim-match.util.spec.ts -t "requireAllTokens"`
Expected: FAIL — `hasSpecificNameOverlap` does not accept a third argument yet, so passing `{ requireAllTokens: true }` has no effect and the two collision cases both still return `true` instead of `false`.

- [ ] **Step 3: Implement the stricter option**

In `be/src/modules/tours/utils/nominatim-match.util.ts`, replace:

```ts
export function hasSpecificNameOverlap(
  needle: string,
  haystack: string,
): boolean {
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
```

with:

```ts
export function hasSpecificNameOverlap(
  needle: string,
  haystack: string,
  // Task A5 (2026-09-17 confirmation-collision-fix plan): confirmation
  // needs a stricter bar than matching. Two DIFFERENT real places sharing
  // one common neighborhood/historical-figure word (e.g. "Recoleta",
  // "Güemes") both legitimately clear the default >=50% bar on that one
  // shared token alone -- fine for finding a matching CANDIDATE (matching
  // must stay permissive for real translation/substring cases), but wrong
  // for INDEPENDENTLY CONFIRMING one, where a false "yes" is exactly the
  // failure this whole cross-source confirmation mechanism exists to
  // prevent. requireAllTokens raises the bar to 100% of the needle's
  // significant tokens for that caller only -- every existing caller
  // (omitting this option) is completely unaffected. A single-token
  // needle is unaffected either way: 1/1 already equals both 50% and 100%.
  options?: { requireAllTokens?: boolean },
): boolean {
  if (haystack === needle) return true;

  const needleTokens = needle.split(' ').filter((token) => token.length >= 4);
  if (needleTokens.length === 0) return false;

  const haystackTokens = new Set(haystack.split(' ').filter(Boolean));
  const matchedTokens = needleTokens.filter((token) =>
    haystackTokens.has(token),
  );
  const requiredRatio = options?.requireAllTokens ? 1 : 0.5;
  return (
    matchedTokens.length / needleTokens.length >= requiredRatio &&
    matchedTokens.some((token) => token.length >= 5)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/tours/utils/nominatim-match.util.spec.ts`
Expected: PASS, all tests in the file (regression check — every existing call passes zero/undefined `options`, unaffected).

- [ ] **Step 5: Write the failing test for `confirmMatch` using the stricter bar**

Add to `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts`, inside the existing `describe('cross-source confirmation (Task A3)', ...)` block (reuse that file's existing `candidate(...)` helper and constructor-mocking pattern exactly as its other tests in this block do — read the block in full before writing this, since it already has the exact osmPlaces/catalog/geographicValidator/wikidata mock shapes this new test must match):

```ts
it('does NOT confirm a fuzzy match when Wikidata only corroborates ONE of several significant tokens (Task A5 real regression: "Recoleta Cemetery" -> "Hotel Urban Suites Recoleta")', async () => {
  const osmPlaces = {
    lookupStreetsWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisWithin: jest.fn().mockResolvedValue({
      status: 'success',
      value: [
        {
          id: 'osm:node:1',
          name: 'Hotel Urban Suites Recoleta',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
          tags: {},
        },
      ],
    }),
  };
  const catalog = {
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-hotel' }),
    persistVerifiedExperience: jest.fn(),
  };
  const geographicValidator = { validate: jest.fn() };
  const wikidata = {
    findNearbyPlaces: jest.fn().mockResolvedValue([
      // A real, independently-real nearby place -- but it only shares
      // the generic neighborhood token "recoleta" with the hint, not
      // "cemetery". Confirming on this alone is the exact bug Task A4
      // found live.
      { qid: 'Q000', label: 'Fundación Federico Jorge Klemm', latitude: -34.59, longitude: -58.39 },
    ]),
  };
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    geographicValidator as any,
    undefined,
    undefined,
    undefined,
    wikidata as any,
  );

  const result = await service.resolve({
    geographicScope: { kind: 'AREA_BOUNDARY', boundary },
    candidates: [candidate('Recoleta Walk', 'Recoleta Cemetery')],
    evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
  });

  const rejected = result.entityResolution.resolved[0];
  expect(rejected.resolvedEntities[0]).toEqual(
    expect.objectContaining({
      hintName: 'Recoleta Cemetery',
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
    }),
  );
});
```

If the file's `boundary`/`candidate(...)` fixtures used by the existing Task A3 tests have a different exact shape than assumed above, use the file's OWN existing fixtures verbatim (read the top of the describe block first) — do not invent a second, parallel fixture style.

- [ ] **Step 6: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts -t "does NOT confirm a fuzzy match when Wikidata only corroborates ONE"`
Expected: FAIL — `confirmMatch` still calls `hasSpecificNameOverlap` with no options, so the shared `"recoleta"` token alone satisfies the default ≥50% bar and the entity wrongly ends up `resolved`, not `unresolved`/`UNCONFIRMED_MATCH`.

- [ ] **Step 7: Implement — pass the stricter option from `confirmMatch`**

In `be/src/modules/tours/services/experience-proposal-resolver.service.ts`, in `confirmMatch`, change:

```ts
    const needle = normalizeGeoName(hint.name);
    return nearby.some((place) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(place.label)),
    );
```

to:

```ts
    const needle = normalizeGeoName(hint.name);
    // Task A5: confirmation requires ALL of the hint's significant tokens
    // to be present, not just >=50% -- matching stays permissive
    // (unchanged, see nominatim-match.util.ts), but a same-generic-token
    // collision (two different real places sharing one neighborhood/
    // historical-figure word) must not count as independent confirmation.
    return nearby.some((place) =>
      hasSpecificNameOverlap(needle, normalizeGeoName(place.label), {
        requireAllTokens: true,
      }),
    );
```

- [ ] **Step 8: Run test to verify it passes**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
Expected: PASS, full file (regression check — this must not break the existing Task A3 test "confirms a fuzzy (non-exact) local match when Wikidata independently has something nearby with a matching name": re-read that test's exact fixture before this step; if its Wikidata label shares only one of two+ significant tokens with the hint, it will now also fail under `requireAllTokens: true` and its fixture must be corrected to a label sharing ALL of the hint's significant tokens — this is expected and matches the plan's own instruction to fix a fixture at its root rather than loosen the new gate).

- [ ] **Step 9: `yarn typecheck && yarn lint:check` from `be/`**

Expected: both clean.

- [ ] **Step 10: Full regression run**

Run: `yarn test` from `be/`
Expected: all suites green (in particular `experience-proposal-resolver.concurrency.spec.ts`, unaffected by this task since none of its fixtures rely on fuzzy Wikidata confirmation).

- [ ] **Step 11: Commit**

```bash
git add be/src/modules/tours/utils/nominatim-match.util.ts \
  be/src/modules/tours/utils/nominatim-match.util.spec.ts \
  be/src/modules/tours/services/experience-proposal-resolver.service.ts \
  be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts
git commit -m "fix(entity-resolution): require full token overlap for cross-source confirmation (Task A5)"
```

---

# Task A6: Narrow entity resolution to a resolved AREA anchor's own boundary (Root Cause #4)

**Files:**
- Modify: `be/src/modules/tours/interfaces/preference-spec.interface.ts`
- Modify: `be/src/modules/tours/services/area-route-anchor-resolver.service.ts`
- Test: `be/src/modules/tours/services/area-route-anchor-resolver.service.spec.ts`
- Modify: `be/src/modules/tours/interfaces/experience-resolution.interface.ts`
- Modify: `be/src/modules/tours/services/experience-proposal-resolver.service.ts`
- Test: `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
- Modify: `be/src/modules/tours/services/experience-acquisition.service.ts`
- Test: `be/src/modules/tours/services/experience-acquisition.service.spec.ts`
- Modify: `be/src/modules/tours/services/area-route-walk-acquisition.service.ts`
- Test: `be/src/modules/tours/services/area-route-walk-acquisition.service.spec.ts`

**Interfaces:**
- Consumes: `OsmCandidate` (`@integrations/osm/services/osm-places.service`, existing, unchanged shape).
- Produces: `ResolvedAnchor`'s resolved variant gains `osmBoundary?: OsmCandidate`. `ExperienceResolutionRequest` gains `entityResolutionScope?: GeographicScope`. `ExperienceAcquisitionService.materializeExecution`'s context param gains `entityResolutionScope?: GeographicScope`.

- [ ] **Step 1: Write the failing test — `discoverArea`'s candidate carries `osmBoundary`**

Add to `be/src/modules/tours/services/area-route-anchor-resolver.service.spec.ts`, inside `describe('resolveArea', ...)` (right after the existing "resolves a real Nominatim way/relation match" test, reusing its exact fixtures):

```ts
it('carries the full OsmCandidate boundary (osmType/osmId included) forward, not just its geometry (Task A6)', async () => {
  const nominatim = {
    search: jest.fn().mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 42,
        addresstype: 'suburb',
        placeRank: 20,
        class: 'place',
        type: 'suburb',
        displayName: 'San Telmo, Buenos Aires, Argentina',
        importance: 0.3,
        latitude: -34.62,
        longitude: -58.37,
      },
    ]),
    reverse: jest.fn(),
  };
  const boundaryGeometry = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-58.38, -34.63],
        [-58.36, -34.63],
        [-58.36, -34.61],
        [-58.38, -34.61],
        [-58.38, -34.63],
      ],
    ],
  };
  const osmBoundary = {
    id: 'osm:relation:42',
    name: 'San Telmo',
    osmType: 'relation' as const,
    osmId: 42,
    geometry: boundaryGeometry,
    tags: { boundary: 'administrative' },
  };
  const osmPlaces = {
    lookupBoundaryById: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: osmBoundary }),
    lookupStreetsWithin: jest.fn(),
    lookupStreetsNear: jest.fn(),
  };
  const catalog = {
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
  };
  const service = new AreaRouteAnchorResolverService(
    osmPlaces as any,
    catalog as any,
    nominatim as any,
  );

  const resolved = await service.resolveNamedAnchors(
    [{ rawName: 'San Telmo', usage: 'geographic_scope', priority: 'must' }],
    { destinationCountryCode: 'ar', geographicScope: { kind: 'AREA_BOUNDARY', boundary: osmBoundary } },
  );

  expect(resolved[0]).toEqual(
    expect.objectContaining({ status: 'resolved', osmBoundary }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/area-route-anchor-resolver.service.spec.ts -t "carries the full OsmCandidate boundary"`
Expected: FAIL — `resolved[0]` has no `osmBoundary` property at all yet (`ResolvedAnchor` doesn't declare it, `discoverArea`/`persistCandidate` don't set it), so `toEqual(expect.objectContaining({ osmBoundary }))` fails.

- [ ] **Step 3: Implement — thread `osmBoundary` through the AREA discovery/persist/interface chain**

In `be/src/modules/tours/interfaces/preference-spec.interface.ts`, add the import and field:

```ts
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
```

(add near the top with the other imports), and in `ResolvedAnchor`'s resolved variant:

```ts
export type ResolvedAnchor =
  | {
      status: 'resolved';
      rawName: string;
      usage: AnchorUsage;
      priority: AnchorPriority;
      canonicalName: string;
      kind: 'area' | 'route' | 'venue';
      geoEntityId: string;
      provider: string;
      externalId?: string;
      geometry?: GeoJsonGeometry;
      // Task A6 (2026-09-17 confirmation-collision-fix plan): only ever
      // set for kind === 'area', when the underlying resolution came from
      // a real OSM way/relation boundary (discoverArea, via
      // lookupBoundaryById). Lets a caller narrow entity resolution's own
      // local OSM pool query to this specific area instead of always the
      // whole destination -- geometry alone is not enough for that,
      // Overpass's "within area" query needs the real osmType/osmId.
      osmBoundary?: OsmCandidate;
    }
  | {
      status: 'unresolved';
      rawName: string;
      usage: AnchorUsage;
      priority: AnchorPriority;
      unresolvedReason: string;
    };
```

In `be/src/modules/tours/services/area-route-anchor-resolver.service.ts`, add `osmBoundary?: OsmCandidate` to `AnchorGeoCandidate`:

```ts
interface AnchorGeoCandidate {
  kind: 'area' | 'route' | 'venue';
  canonicalName: string;
  provider: string;
  externalId?: string;
  geometry: GeoJsonGeometry;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, string>;
  placeTypes?: string[];
  // Task A6 -- only set by discoverArea, for the real OSM way/relation
  // boundary lookupBoundaryById already returned.
  osmBoundary?: OsmCandidate;
}
```

Import `OsmCandidate` at the top of this file:

```ts
import { OsmPlacesService, OsmCandidate } from '@integrations/osm/services/osm-places.service';
```

In `discoverArea`, change the returned candidate (inside the `status: 'match'` branch, right after the existing `lookupBoundaryById` call) to include it:

```ts
      return {
        status: 'match',
        candidate: {
          kind: 'area',
          canonicalName: boundary.value.name,
          provider: 'openstreetmap',
          externalId: boundary.value.id,
          latitude: point?.latitude,
          longitude: point?.longitude,
          geometry: boundary.value.geometry,
          metadata: boundary.value.tags,
          osmBoundary: boundary.value,
        },
      };
```

In `persistCandidate`, add `osmBoundary: candidate.osmBoundary` to the returned object:

```ts
    return {
      status: 'resolved',
      rawName: anchor.rawName,
      usage: anchor.usage,
      priority: anchor.priority,
      canonicalName: candidate.canonicalName,
      kind: candidate.kind,
      geoEntityId: geo.id,
      provider: candidate.provider,
      externalId: candidate.externalId,
      geometry: candidate.geometry,
      osmBoundary: candidate.osmBoundary,
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/tours/services/area-route-anchor-resolver.service.spec.ts`
Expected: PASS, full file (regression check — every other test's `toEqual(expect.objectContaining({...}))` assertions don't list `osmBoundary`, so an object gaining an extra `undefined`/populated field doesn't break them; the route/venue tests never set `osmBoundary` on their candidates, so `persistCandidate` forwards `undefined` for them, unchanged from today's shape for all practical purposes).

- [ ] **Step 5: Write the failing test — `resolve()` uses a narrower `entityResolutionScope` for the local pool fetch, but keeps the destination-wide `boundary` for geographic validation**

Add to `be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts` — find the top-level `describe('ExperienceProposalResolverService', ...)` block and add a new nested `describe('entity-resolution scope narrowing (Task A6)', ...)`:

```ts
describe('entity-resolution scope narrowing (Task A6)', () => {
  it('queries the narrower entityResolutionScope for the local OSM pool, while still passing the wide destination boundary to geographic validation', async () => {
    const wideBoundary = {
      id: 'osm:relation:1',
      name: 'Buenos Aires',
      osmType: 'relation' as const,
      osmId: 1,
      geometry: { type: 'Polygon' as const, coordinates: [] },
      tags: {},
    };
    const narrowBoundary = {
      id: 'osm:relation:42',
      name: 'San Telmo',
      osmType: 'relation' as const,
      osmId: 42,
      geometry: { type: 'Polygon' as const, coordinates: [] },
      tags: {},
    };
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:1',
            name: 'Mercado de San Telmo',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
            tags: {},
          },
        ],
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-mercado' }),
      persistVerifiedExperience: jest
        .fn()
        .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue({
        proposalName: 'San Telmo Market Visit',
        kind: 'EXPERIENCE',
        status: 'GEO_VERIFIED',
        accepted: true,
        anchors: [],
        groundedEvidenceKeys: ['ev-1'],
        rejectionReasons: [],
        validatorVersion: 2,
      }),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary: wideBoundary },
      entityResolutionScope: { kind: 'AREA_BOUNDARY', boundary: narrowBoundary },
      candidates: [candidate('San Telmo Market Visit', 'Mercado de San Telmo')],
      evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
    });

    // The local pool fetch used the NARROW scope, not the wide one.
    expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(narrowBoundary);
    expect(osmPlaces.lookupStreetsWithin).toHaveBeenCalledWith(narrowBoundary);
    // Geographic validation still receives the WIDE destination boundary,
    // unchanged -- destination_mismatch semantics must not narrow.
    expect(geographicValidator.validate).toHaveBeenCalledWith(
      expect.anything(),
      wideBoundary,
      undefined,
      undefined,
      expect.objectContaining({ boundary: wideBoundary }),
    );
  });

  it('falls back to geographicScope for the local pool fetch when entityResolutionScope is absent (regression guard: every existing caller is unaffected)', async () => {
    const boundary = {
      id: 'osm:relation:1',
      name: 'Buenos Aires',
      osmType: 'relation' as const,
      osmId: 1,
      geometry: { type: 'Polygon' as const, coordinates: [] },
      tags: {},
    };
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn(),
      persistVerifiedExperience: jest.fn(),
    };
    const geographicValidator = { validate: jest.fn() };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [],
      evidence: [],
    });

    expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(boundary);
    expect(osmPlaces.lookupStreetsWithin).toHaveBeenCalledWith(boundary);
  });
});
```

Reuse the file's own existing `candidate(...)`/`boundary` helpers if their names/shapes differ from what's assumed above — read the top of the spec file first and adapt the fixture construction to match exactly, without changing the assertions' intent.

- [ ] **Step 6: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts -t "entity-resolution scope narrowing"`
Expected: FAIL on the first test — `ExperienceResolutionRequest` has no `entityResolutionScope` field yet, so `resolve()` ignores it entirely and both `lookupPoisWithin`/`lookupStreetsWithin` are called with `wideBoundary`, not `narrowBoundary`.

- [ ] **Step 7: Implement — add `entityResolutionScope` to the request interface and use it in `resolve()`**

In `be/src/modules/tours/interfaces/experience-resolution.interface.ts`, add to `ExperienceResolutionRequest`:

```ts
export interface ExperienceResolutionRequest {
  candidates: ExperienceCandidate[];
  destinationName?: string;
  destinationCountryCode?: string;
  geographicScope?: GeographicScope;
  /**
   * Task A6 (2026-09-17 confirmation-collision-fix plan, Root Cause #4) --
   * when a request is anchored to a specific resolved AREA (e.g. "San
   * Telmo"), this narrows ONLY the local OSM pool fetch entity resolution
   * queries against (lookupStreetsWithin/lookupPoisWithin) -- never
   * geographic validation, which always keeps using `geographicScope`'s
   * full destination boundary regardless of this field. Absent for every
   * caller other than AreaRouteWalkAcquisitionService with a resolved AREA
   * anchor -- falls back to `geographicScope` when omitted, byte-identical
   * to this field never having existed.
   */
  entityResolutionScope?: GeographicScope;
  traceContext?: Record<string, unknown>;
  evidence?: Array<{
    key?: string;
    source: string;
    url?: string;
    title?: string;
    snippet?: string;
  }>;
  validationScope?: ExperienceValidationScope;
  validationIntent?: 'walk' | 'route_like';
}
```

In `be/src/modules/tours/services/experience-proposal-resolver.service.ts`'s `resolve()`, change:

```ts
    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const evidence = input.evidence ?? [];
    const scope = input.geographicScope;
    if (!scope)
      throw new Error('Experience resolution requires a geographic scope');
    const boundary =
      scope.kind === 'AREA_BOUNDARY' ? scope.boundary : undefined;

    // A point-scale destination has no OSM area/relation. Use radius-based
    // lookups directly; AREA_BOUNDARY alone authorizes within-area queries.
    const [streetLookup, poiLookup] = await Promise.all([
      scope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupStreetsNear(
            scope.latitude,
            scope.longitude,
            scope.radiusMeters,
          )
        : this.osmPlaces.lookupStreetsWithin(scope.boundary),
      scope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupPoisNear(
            scope.latitude,
            scope.longitude,
            scope.radiusMeters,
          )
        : this.osmPlaces.lookupPoisWithin(scope.boundary),
    ]);

    // Bounded: each candidate can upsert a GeoEntity (its own interactive
    // transaction) while resolving — see RESOLVER_CANDIDATE_CONCURRENCY.
    const resolvedCandidates = await mapWithBoundedConcurrency(
      candidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      (candidate: any) =>
        this.resolveCandidate(
          candidate,
          boundary,
          streetLookup.value,
          poiLookup.value,
          { streets: streetLookup, pois: poiLookup },
          input.destinationName,
          evidence,
          input.destinationCountryCode,
        ),
    );
```

to:

```ts
    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const evidence = input.evidence ?? [];
    const scope = input.geographicScope;
    if (!scope)
      throw new Error('Experience resolution requires a geographic scope');
    const boundary =
      scope.kind === 'AREA_BOUNDARY' ? scope.boundary : undefined;

    // Task A6: entityResolutionScope narrows ONLY the local OSM pool
    // fetch below (and, via resolveCandidate's `poolBoundary` param, the
    // AREA-hint pool selection + trusted-global-hint fallback point) --
    // `scope`/`boundary` above are UNCHANGED and keep flowing into
    // geographic validation as the destination-wide boundary, further
    // down in this method.
    const poolScope = input.entityResolutionScope ?? scope;
    const poolBoundary =
      poolScope.kind === 'AREA_BOUNDARY' ? poolScope.boundary : undefined;

    // A point-scale destination has no OSM area/relation. Use radius-based
    // lookups directly; AREA_BOUNDARY alone authorizes within-area queries.
    const [streetLookup, poiLookup] = await Promise.all([
      poolScope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupStreetsNear(
            poolScope.latitude,
            poolScope.longitude,
            poolScope.radiusMeters,
          )
        : this.osmPlaces.lookupStreetsWithin(poolScope.boundary),
      poolScope.kind === 'POINT_RADIUS'
        ? this.osmPlaces.lookupPoisNear(
            poolScope.latitude,
            poolScope.longitude,
            poolScope.radiusMeters,
          )
        : this.osmPlaces.lookupPoisWithin(poolScope.boundary),
    ]);

    // Bounded: each candidate can upsert a GeoEntity (its own interactive
    // transaction) while resolving — see RESOLVER_CANDIDATE_CONCURRENCY.
    const resolvedCandidates = await mapWithBoundedConcurrency(
      candidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      (candidate: any) =>
        this.resolveCandidate(
          candidate,
          poolBoundary,
          streetLookup.value,
          poiLookup.value,
          { streets: streetLookup, pois: poiLookup },
          input.destinationName,
          evidence,
          input.destinationCountryCode,
        ),
    );
```

Leave every other line in `resolve()` (the `geographicValidator.validate(item, boundary, ...)` call, the final response's `validationScope: input.validationScope`, etc.) completely untouched — `boundary`/`scope` still refer to the original destination-wide `geographicScope`.

- [ ] **Step 8: Run test to verify it passes**

Run: `yarn test src/modules/tours/services/experience-proposal-resolver.service.spec.ts`
Expected: PASS, full file (regression check — every existing test omits `entityResolutionScope`, so `poolScope` falls back to `scope` and every existing `lookupPoisWithin`/`lookupStreetsWithin`/`lookupPoisNear`/`lookupStreetsNear` assertion is unaffected).

- [ ] **Step 9: Write the failing test — `materializeExecution` forwards `entityResolutionScope`**

Add to `be/src/modules/tours/services/experience-acquisition.service.spec.ts`, inside the existing `describe('materializeExecution', ...)` block (read it first to match the file's own constructor/mock pattern exactly):

```ts
it('forwards entityResolutionScope into the resolver request (Task A6)', async () => {
  const narrowScope = { kind: 'AREA_BOUNDARY' as const, boundary: {} as any };
  const proposalResolver = {
    resolve: jest.fn().mockResolvedValue({
      resolved: [],
      acceptedCount: 0,
      rejectedCount: 0,
      totalCandidates: 0,
      entityResolution: { totalCandidates: 0, acceptedCount: 0, rejectedCount: 0, resolved: [] },
      geographicValidation: { results: [], acceptedCount: 0, rejectedCount: 0 },
    }),
  };
  const service = buildAcquisitionService({ proposalResolver });

  await service.materializeExecution(
    { candidates: [], observations: [], providerResults: {} },
    { destinationName: 'Buenos Aires', entityResolutionScope: narrowScope },
  );

  expect(proposalResolver.resolve).toHaveBeenCalledWith(
    expect.objectContaining({ entityResolutionScope: narrowScope }),
  );
});
```

Adapt `buildAcquisitionService`/the constructor call to whatever this spec file's own existing helper for constructing `ExperienceAcquisitionService` with a mocked `proposalResolver` is named — read the file first, do not invent a new helper if one already exists.

- [ ] **Step 10: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/experience-acquisition.service.spec.ts -t "forwards entityResolutionScope"`
Expected: FAIL — `materializeExecution`'s context type has no `entityResolutionScope` field and never passes it to `resolve()`, so the mock's call args lack it.

- [ ] **Step 11: Implement — thread `entityResolutionScope` through `materializeExecution`**

In `be/src/modules/tours/services/experience-acquisition.service.ts`, change:

```ts
  async materializeExecution(
    execution: ExecuteAcquisitionPlanResult,
    context: {
      destinationName?: string;
      destinationCountryCode?: string;
      geographicScope?: GeographicScope;
      [key: string]: unknown;
      /** Task B5 — see ExperienceValidationScope. */
      validationScope?: ExperienceValidationScope;
      validationIntent?: 'walk' | 'route_like';
    },
  ): Promise<FinalExperienceResolutionResponse> {
    if (!this.proposalResolver) {
      throw new Error(
        'ExperienceProposalResolver is required for materialization',
      );
    }
    const response = await this.proposalResolver.resolve({
      candidates: execution.candidates,
      destinationName: context.destinationName,
      destinationCountryCode: context.destinationCountryCode,
      geographicScope: context.geographicScope,
      evidence: execution.evidence,
      validationScope: context.validationScope,
      validationIntent: context.validationIntent,
    });
```

to:

```ts
  async materializeExecution(
    execution: ExecuteAcquisitionPlanResult,
    context: {
      destinationName?: string;
      destinationCountryCode?: string;
      geographicScope?: GeographicScope;
      [key: string]: unknown;
      /** Task B5 — see ExperienceValidationScope. */
      validationScope?: ExperienceValidationScope;
      validationIntent?: 'walk' | 'route_like';
      /** Task A6 — see ExperienceResolutionRequest.entityResolutionScope. */
      entityResolutionScope?: GeographicScope;
    },
  ): Promise<FinalExperienceResolutionResponse> {
    if (!this.proposalResolver) {
      throw new Error(
        'ExperienceProposalResolver is required for materialization',
      );
    }
    const response = await this.proposalResolver.resolve({
      candidates: execution.candidates,
      destinationName: context.destinationName,
      destinationCountryCode: context.destinationCountryCode,
      geographicScope: context.geographicScope,
      evidence: execution.evidence,
      validationScope: context.validationScope,
      validationIntent: context.validationIntent,
      entityResolutionScope: context.entityResolutionScope,
    });
```

- [ ] **Step 12: Run test to verify it passes**

Run: `yarn test src/modules/tours/services/experience-acquisition.service.spec.ts`
Expected: PASS, full file.

- [ ] **Step 13: Write the failing test — `AreaRouteWalkAcquisitionService` passes `entityResolutionScope` for a resolved AREA anchor with an `osmBoundary`, and omits it otherwise**

Add to `be/src/modules/tours/services/area-route-walk-acquisition.service.spec.ts`. First, extend the file's existing `areaAnchor` fixture (read its current definition, shown in the "Current real state" section above) with `osmBoundary`:

```ts
const areaAnchorOsmBoundary = {
  id: 'osm:relation:42',
  name: 'San Telmo',
  osmType: 'relation' as const,
  osmId: 42,
  geometry: { type: 'Polygon' as const, coordinates: [] },
  tags: {},
};
```

and a variant of `areaAnchor` carrying it (do not mutate the shared `areaAnchor` constant other tests rely on — spread a new one):

```ts
const areaAnchorWithOsmBoundary: ResolvedAnchor = {
  ...areaAnchor,
  osmBoundary: areaAnchorOsmBoundary,
};
```

Then, near the existing area-anchor `materializeExecution` assertion test (the one asserting `validationScope`), add:

```ts
it('passes entityResolutionScope narrowed to the resolved AREA anchor’s own OSM boundary (Task A6)', async () => {
  const mocks = buildMocks();
  mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
    destination: {},
    deficits: [],
    sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
    breadth: 'focused',
  });
  mocks.acquisitionService.executePlan.mockResolvedValue({
    evidence: [],
    candidates: [],
  });
  mocks.acquisitionService.materializeExecution.mockResolvedValue({
    resolved: [],
  });
  const service = buildService(mocks);

  await service.acquireOrReuse(baseInput({ anchor: areaAnchorWithOsmBoundary }));

  expect(mocks.acquisitionService.materializeExecution).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      entityResolutionScope: {
        kind: 'AREA_BOUNDARY',
        boundary: areaAnchorOsmBoundary,
      },
    }),
  );
});

it('omits entityResolutionScope when the resolved AREA anchor has no osmBoundary (regression guard: today’s callers, unaffected)', async () => {
  const mocks = buildMocks();
  mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
    destination: {},
    deficits: [],
    sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
    breadth: 'focused',
  });
  mocks.acquisitionService.executePlan.mockResolvedValue({
    evidence: [],
    candidates: [],
  });
  mocks.acquisitionService.materializeExecution.mockResolvedValue({
    resolved: [],
  });
  const service = buildService(mocks);

  await service.acquireOrReuse(baseInput());

  const [, context] =
    mocks.acquisitionService.materializeExecution.mock.calls[0];
  expect(context.entityResolutionScope).toBeUndefined();
});
```

Reuse the file's existing `baseInput(...)`/`buildMocks()`/`buildService(...)` helpers exactly as its neighboring tests do — read them first if any assumed shape above doesn't match.

- [ ] **Step 14: Run test to verify it fails**

Run: `yarn test src/modules/tours/services/area-route-walk-acquisition.service.spec.ts -t "entityResolutionScope"`
Expected: FAIL on the first new test — `acquireOrReuse` never builds or passes `entityResolutionScope` today.

- [ ] **Step 15: Implement — build and pass `entityResolutionScope` in `acquireOrReuse`**

In `be/src/modules/tours/services/area-route-walk-acquisition.service.ts`, change the `resolution` object to carry `osmBoundary` through:

```ts
    const resolution =
      input.anchor.status === 'resolved' &&
      input.anchor.geoEntityId &&
      input.anchor.geometry
        ? {
            resolved: true,
            geoEntityId: input.anchor.geoEntityId,
            canonicalName: input.anchor.canonicalName,
            provider: input.anchor.provider,
            externalId: input.anchor.externalId,
            geometry: input.anchor.geometry,
            osmBoundary: input.anchor.osmBoundary,
          }
        : { resolved: false as const };
```

and, right next to the existing `validationScope` construction, add an `entityResolutionScope` built the same way (only for a resolved AREA anchor with a real `osmBoundary`):

```ts
    const validationScope: ExperienceValidationScope | undefined =
      resolution.resolved
        ? {
            kind:
              input.anchor.status === 'resolved' && input.anchor.kind === 'area'
                ? 'AREA'
                : 'ROUTE',
            anchorName: input.anchor.rawName,
            geoEntityId: resolution.geoEntityId,
            geometry: resolution.geometry,
          }
        : undefined; // mode C (tourism route, unresolved) has no external geometry to gate on -- ordinary validateExperience + the tourism-route identity check alone carry it
    // Task A6 (Root Cause #4) — only for a resolved AREA anchor with a
    // real OSM way/relation boundary in hand: narrow entity resolution's
    // own local OSM pool query to it, instead of the whole destination.
    // A ROUTE anchor has no polygon to query "within" (a real Overpass
    // area query needs a way/relation, not a LineString), so this stays
    // undefined for every other case — resolve() then falls back to
    // geographicScope, exactly today's behavior.
    const entityResolutionScope: GeographicScope | undefined =
      resolution.resolved &&
      input.anchor.status === 'resolved' &&
      input.anchor.kind === 'area' &&
      resolution.osmBoundary
        ? { kind: 'AREA_BOUNDARY', boundary: resolution.osmBoundary }
        : undefined;
    const materialized = await this.acquisitionService.materializeExecution(
      execution,
      {
        destinationName: input.destination.destinationName,
        destinationCountryCode: input.destinationCountryCode,
        geographicScope: input.geographicScope,
        validationScope,
        validationIntent: input.intentKey,
        entityResolutionScope,
      },
    );
```

`GeographicScope` is already imported in this file (verified: `import { ..., GeographicScope, ... } from '../interfaces/experience-resolution.interface'`, used by `AreaRouteWalkAcquisitionInput.geographicScope`) — no new import needed.

- [ ] **Step 16: Run test to verify it passes**

Run: `yarn test src/modules/tours/services/area-route-walk-acquisition.service.spec.ts`
Expected: PASS, full file.

- [ ] **Step 17: `yarn typecheck && yarn lint:check` from `be/`**

Expected: both clean.

- [ ] **Step 18: Full regression run**

Run: `yarn test` from `be/`
Expected: all suites green.

- [ ] **Step 19: Commit**

```bash
git add be/src/modules/tours/interfaces/preference-spec.interface.ts \
  be/src/modules/tours/services/area-route-anchor-resolver.service.ts \
  be/src/modules/tours/services/area-route-anchor-resolver.service.spec.ts \
  be/src/modules/tours/interfaces/experience-resolution.interface.ts \
  be/src/modules/tours/services/experience-proposal-resolver.service.ts \
  be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts \
  be/src/modules/tours/services/experience-acquisition.service.ts \
  be/src/modules/tours/services/experience-acquisition.service.spec.ts \
  be/src/modules/tours/services/area-route-walk-acquisition.service.ts \
  be/src/modules/tours/services/area-route-walk-acquisition.service.spec.ts
git commit -m "feat(entity-resolution): narrow local OSM pool to a resolved AREA anchor's own boundary (Task A6, Root Cause #4)"
```

---

# Task A7: Re-measure once more (same methodology, third time)

**Files:** none modified — repeats the same temporary, never-committed `characterize-composite` methodology from Task A4 (see `docs/superpowers/characterization/2026-09-17-task-a4-confirmation-live-remeasure.md`'s own "Mechanism" paragraph for the exact steps and revert discipline).

- [ ] Re-run the same 6-theme Buenos Aires characterization with both Task A5 and Task A6 live.
- [ ] Specifically re-check the TWO real collision cases Task A4 found (`"Recoleta Cemetery"`, `"Galería Güemes"`) — confirm they now land as `UNCONFIRMED_MATCH` (an honest, correctly-refused loss) rather than silently `resolved`.
- [ ] Spot-check a handful of the run's `status: 'resolved'` entities against a live source (Wikidata SPARQL or manual knowledge) the same way Task A4 did — do not declare the collision class closed on Task A5's unit tests alone, verify against a real live run.
- [ ] Report the new composite persistence rate against Task A4's 0/7 baseline, and whether Task A6 measurably reduced `NO_OSM_MATCH`/ambiguous-match volume (a smaller, more specific local pool should produce fewer spurious fuzzy candidates in the first place, independent of the confirmation gate).
- [ ] Write a new dated file under `docs/superpowers/characterization/`, same structure as the Task A4 report. Do not mark the non-negotiable confirmation requirement "met" without this live re-verification, even if all unit tests pass.

---

## Self-review notes (writing-plans skill discipline, recorded here for the reviewer)

- **Spec coverage**: Task A5 covers the exact two real regressions Task A4's report cited. Task A6 covers Root Cause #4 exactly as scoped in the original adversarial review (AREA anchors only, threading `resolvedAnchors`/`validationScope`-adjacent plumbing — here a new sibling field, `entityResolutionScope`, rather than overloading `validationScope` itself, since `validationScope` is documented and consumed as a VALIDATION concept and overloading it for pool-fetch scoping would blur that boundary).
- **Placeholder scan**: every step has real, current-repo-verified code (file paths, line-range context, exact current signatures) — no "add appropriate handling"-style steps.
- **Type consistency**: `entityResolutionScope?: GeographicScope` is named and typed identically everywhere it appears (`ExperienceResolutionRequest`, `materializeExecution`'s context param, `AreaRouteWalkAcquisitionService`'s local variable) — verified by construction while writing this plan, not assumed.
