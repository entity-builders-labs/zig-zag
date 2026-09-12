# Android Image Delivery and Media-Enrichment Lifecycle Hardening — Implementation Plan

Status: ready for implementation
Branch: `feat/preference-first-selection`
Date: 2026-09-12

Related design/specs:
- `docs/superpowers/specs/2026-09-10-destination-cover-photo-async-resolution.md`
- `docs/superpowers/specs/2026-09-12-media-relevance-ranking-and-tour-cover-selection-design.md`

IMPORTANT SCOPE BOUNDARY:

This plan fixes image DELIVERY / RENDERING reliability and stale async media
events. It does NOT implement media-quality ranking, representative Experience
selection, better Commons relevance, or itinerary-aware Tour cover selection.
Those belong to the deferred media-quality specification above and must be
executed only after `preference-first-selection` is complete.

================================================================================
1. GOAL
================================================================================

Fix the current image reliability bugs without destabilizing the Tour engine:

1. Wikimedia images that are valid on iOS/web must also load on Android instead
   of failing because the native Android image request uses an unacceptable
   generic User-Agent.
2. `TourHeader` must never leave a valid fallback image permanently invisible
   because its fade animation remains at opacity 0.
3. Remote image failures must degrade to a safe visual fallback instead of a
   black/empty rectangle.
4. Stale `ExperienceMediaEnrichmentRequested` events must not poison the outbox
   when their target Experience was deleted before media persistence.
5. If local Android development genuinely requires HTTP cleartext, enable it
   only through versioned Expo configuration and only when explicitly opted in.

Non-goal: making the chosen photos prettier or more relevant.

================================================================================
2. VERIFIED CURRENT STATE
================================================================================

The implementation agent MUST inspect current HEAD before editing, but this plan
was authored against `feat/preference-first-selection` where the following were
verified.

### 2.1 `TourHeader.tsx` contains the opacity bug

Current file:
`fe/components/tour-details/TourHeader.tsx`

Relevant behavior:

- `authenticPhoto` is `tour.coverImage` or the first Experience documentary
  photo;
- `imageUri` falls back through `getImage(...)` when no authentic photo exists;
- `fadeAnim` is initialized from `tour.coverImage || (!isGenerating &&
  authenticPhoto)`;
- the effect also only animates when a cover/authentic photo exists;
- therefore, once generation is finished with only a category fallback,
  `imageUri` is valid but opacity can remain 0 forever.

This is a real bug and must be fixed.

### 2.2 Native directories are not source-of-truth

`fe/.gitignore` ignores:

- `android/`
- `ios/`

Therefore DO NOT solve this plan by directly editing:

- `fe/android/app/src/main/.../MainApplication.kt`;
- generated `AndroidManifest.xml`;
- generated Gradle files.

Any native configuration needed by this project must be produced from
versioned Expo configuration/config plugins.

### 2.3 Current Expo stack

`fe/package.json` currently uses Expo SDK 54 / React Native 0.81.x and does not
currently list `expo-build-properties`.

Use the SDK-compatible package version through `npx expo install` if the
conditional cleartext task becomes necessary. Do not hardcode a package version
copied from another Expo SDK.

### 2.4 Current Experience gallery uses raw remote Image

`fe/app/experiences/[id].tsx` currently renders gallery URLs using Gluestack
`<Image source={{ uri: photoUrl }}>`, with no per-request Wikimedia User-Agent
and no `onError` fallback.

The same raw remote-image pattern exists in Tour/Experience cards and must be
centralized rather than fixed ad hoc one screen at a time.

### 2.5 Current ExperienceMedia relation cascades on Experience deletion

Prisma relation:

`ExperienceMedia.experience -> Experience` uses `onDelete: Cascade`.

That is correct and must remain unchanged.

The problem is a stale async enrichment event racing with Experience deletion,
not the schema's cascade behavior.

================================================================================
3. NON-NEGOTIABLE INVARIANTS
================================================================================

The implementation MUST preserve all of these.

### 3.1 No preference-first changes

Do not modify:

- preference interpretation;
- facet normalization;
- candidate ranking;
- acquisition routing;
- daily planning;
- Tour selection semantics;
- Experience quality/media ranking.

### 3.2 No provider-quality refactor

Do not merge/rewrite `WikimediaCommonsService` and `WikimediaPhotoProvider` in
this task.

Do not reorder Wikimedia results for quality.

Do not add Google Places photos.

Do not change `primaryPhoto` selection semantics in this bugfix.

### 3.3 No direct generated-native edits

Do not commit generated `android/` or `ios/` directories merely to fix this.

### 3.4 Do not globally spoof User-Agent

The app must not replace the User-Agent for every network request.

Only Android requests for known Wikimedia image hosts should receive the
ZigZag image User-Agent.

API calls, maps, SSE, Google, Unsplash and arbitrary external URLs must remain
untouched unless their own explicit policy requires otherwise.

### 3.5 Do not swallow unrelated backend failures

The media processor may treat a confirmed deleted target Experience as a stale
no-op. It must still throw genuine database/provider failures so the existing
retry/error machinery remains meaningful.

================================================================================
4. WORKSTREAM A — CENTRAL `AppImage`
================================================================================

Create:

`fe/components/ui/AppImage.tsx`

Purpose:

- centralize Android Wikimedia request headers;
- centralize remote-image failure fallback;
- avoid duplicating host-detection/error state on every screen.

### 4.1 Required public behavior

The component should support the props needed by current image call sites,
including at minimum:

- `uri` (remote primary URL);
- `fallbackUri` (remote fallback URL when supplied);
- `alt` / accessibility label;
- styling/dimensions/resize mode compatible with current Gluestack usage;
- optional `onLoad` / `onError` forwarding if a caller needs them.

Do not introduce a large new design-system abstraction. Keep the component
small and narrowly focused.

### 4.2 Wikimedia host detection

Use URL parsing, not substring heuristics against the whole URL.

Known Wikimedia-family image hosts to support include at least:

- `upload.wikimedia.org`;
- `thumb.wikimedia.org` when present in stored/test data;
- `commons.wikimedia.org` if a direct media request is ever supplied.

A safe implementation may use an explicit allowlist plus a documented
`.wikimedia.org` suffix check after parsing hostname.

Malformed URLs must not crash rendering.

### 4.3 Header policy

Only on Android, and only for a Wikimedia-family host, produce an image source
with an explicit User-Agent, for example:

`ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)`

React Native supports request headers on network image source objects.

Do NOT attempt to set browser User-Agent headers on web.

Do NOT add the header to iOS unless a real iOS failure requires it; iOS is
already working and this task should minimize behavior changes.

Conceptually:

```ts
const source =
  Platform.OS === 'android' && isWikimediaHost(uri)
    ? { uri, headers: { 'User-Agent': WIKIMEDIA_IMAGE_USER_AGENT } }
    : { uri };
```

The exact rendered primitive may remain the Gluestack Image if it forwards the
React Native `source` object correctly; otherwise use the smallest wrapper that
preserves current layout behavior. Verify rather than assume.

### 4.4 Fallback state machine

Required behavior:

1. render primary URI;
2. if primary `onError` fires and a different `fallbackUri` exists, render the
   fallback;
3. never oscillate/retry forever between the same URLs;
4. if fallback also fails, leave a deterministic neutral container/background
   rather than throwing or repeatedly firing state changes;
5. when the `uri` prop changes (for example after SSE delivers enriched media),
   reset failure state so the new URL gets a real attempt.

Pseudo-state rule:

```ts
useEffect(() => setPrimaryFailed(false), [uri]);
```

Also reset fallback failure state when the fallback URI changes.

### 4.5 Do not bake category selection into `AppImage`

`AppImage` should not know Tour themes, Experience taxonomy or category
fallback policy.

Callers already have `getImage()` / `getPhotoGallery()` and should supply the
chosen fallback URI.

This keeps transport reliability separate from content selection.

================================================================================
5. WORKSTREAM B — ADOPT `AppImage` AT PRODUCT IMAGE SURFACES
================================================================================

Replace raw remote `<Image source={{ uri: ... }}>` usage where the image can
come from Experience/Tour media.

Minimum known call sites to inspect and migrate:

- `fe/app/experiences/[id].tsx` — gallery and similar-Experience images;
- `fe/components/tour-details/TourHeader.tsx`;
- `fe/components/tour-details/TourStopCard.tsx`;
- `fe/components/tour-details/CompositeExperienceDetail.tsx`;
- `fe/components/tour-details/CompositeStopCard.tsx` if it renders remote media;
- `fe/app/(tabs)/saved.tsx`;
- `fe/app/(tabs)/map.tsx` if it renders Experience/Tour thumbnails.

Before editing, search the current branch for remote media render sites. The
list above is a minimum, not permission to ignore a current equivalent file
whose name changed.

Do NOT mass-replace decorative local assets, icons, maps, avatars or unrelated
images.

### 5.1 Caller fallback rule

For Experience/Tour imagery, callers should derive a fallback with the existing
presentation helper/category fallback policy and pass it to `AppImage`.

Example intent:

```tsx
<AppImage
  uri={documentaryUrl}
  fallbackUri={getImage(undefined, 0, theme)}
  ...
/>
```

Do not change the fallback catalog/content in this bugfix. Media quality is the
separate deferred project.

### 5.2 Gallery behavior

For a gallery item that fails:

- keep the gallery index/count stable;
- replace only that slide visually with its fallback;
- do not mutate backend `photos` or remove the item from domain state;
- do not cause scroll index jumps.

================================================================================
6. WORKSTREAM C — FIX `TourHeader` FADE STATE
================================================================================

File:

`fe/components/tour-details/TourHeader.tsx`

### 6.1 Correct invariant

If the header is no longer showing the generation skeleton and `imageUri` is a
non-empty displayable URI, opacity must eventually be 1 regardless of whether
the URI came from:

- `tour.coverImage`;
- an authentic Experience photo;
- the existing category/default fallback.

### 6.2 Required code-shape change

Compute `imageUri` before deriving the fade condition.

The fade effect must depend on the final displayable `imageUri`, not only on
`authenticPhoto`.

Equivalent intended condition:

```ts
const shouldShowImage =
  Boolean(tour.coverImage) || (!isGenerating && Boolean(imageUri));
```

Initialization and the effect must be consistent with that condition.

A valid implementation may initialize:

```ts
new Animated.Value(shouldShowImage ? 1 : 0)
```

and animate to 1 when `shouldShowImage` transitions true.

### 6.3 Preserve skeleton semantics

Current behavior intentionally shows `TourHeaderSkeleton` while generation is
active and no `tour.coverImage` exists.

Do not remove the skeleton merely because a category fallback URI always
exists.

The bug is invisible fallback after generation, not the existence of the
loading skeleton.

### 6.4 SSE transition

When `coverImage` arrives by SSE during generation:

- skeleton should stop being the active visual;
- the real image should render;
- opacity should animate to 1;
- no stale `fadeAnim=0` state may survive.

When generation finishes without cover/authentic media:

- category fallback should render;
- it must be visible at opacity 1 after the fade.

================================================================================
7. WORKSTREAM D — CLEARtext HTTP: CONDITIONAL, NOT DEFAULT
================================================================================

Do NOT blindly add `usesCleartextTraffic=true` as part of the Wikimedia fix.
Wikimedia image URLs are HTTPS; cleartext policy does not fix an HTTPS 403.

Only perform this workstream if current Android logs prove that a required
local-development URL fails with an Android cleartext error such as
`CLEARTEXT communication ... not permitted`.

### 7.1 If no real cleartext failure is reproduced

- leave production/native cleartext policy unchanged;
- document that this was investigated and not required;
- do not add a new dependency.

### 7.2 If local development genuinely requires HTTP

Use versioned Expo configuration, not generated Android files.

Required approach:

1. install the Expo-SDK-compatible `expo-build-properties` using
   `npx expo install expo-build-properties`;
2. configure its Android `usesCleartextTraffic` property in `fe/app.config.js`;
3. gate it behind an explicit build-time environment variable, default false;
4. production/default builds must remain false;
5. document the local developer invocation/environment flag.

Illustrative intent only:

```js
const allowAndroidCleartext =
  process.env.ZIGZAG_ANDROID_ALLOW_CLEARTEXT === 'true';

// expo-build-properties android config:
// usesCleartextTraffic: allowAndroidCleartext
```

Do not use an `EXPO_PUBLIC_*` variable for a build-policy toggle that need not
be exposed to client JS.

### 7.3 Verification

If implemented, verify the generated Android manifest after Expo prebuild/run:

- explicit opt-in dev build: cleartext allowed;
- default/prod build: cleartext not allowed.

Never commit generated native directories just to prove this.

================================================================================
8. WORKSTREAM E — STALE EXPERIENCE MEDIA EVENT HARDENING
================================================================================

File:

`be/src/modules/media/services/media-enrichment-processor.service.ts`

Observed failure class:

A durable `ExperienceMediaEnrichmentRequested` event can outlive the Experience
it references. If the Experience is deleted before persistence, inserting an
`ExperienceMedia` row can hit the FK
`experience_media_experienceId_fkey`.

This is a lifecycle race. A deleted Experience is no longer a valid retry
target.

### 8.1 Required semantics

If the target Experience is conclusively absent:

- treat the enrichment event as stale and successfully consumed;
- do not persist media;
- do not emit `ExperienceMediaUpdated`;
- do not mark a nonexistent Experience FAILED;
- do not retry forever;
- log a structured warning/debug message identifying the stale Experience id.

### 8.2 Avoid wasting provider calls

At the start of `handleMediaEnrichment`, perform a cheap existence check before
calling Wikimedia.

If missing, return immediately.

This is an optimization and first race guard, not sufficient by itself.

### 8.3 Close the deletion race at persistence time

The Experience can still disappear after the early check and before the media
transaction.

Inside the persistence transaction, re-check target existence before media
upserts/update. If absent, return a transaction result indicating stale target
and do not create media/outbox rows.

### 8.4 Handle the final FK/update race narrowly

A concurrent deletion can still race between a transaction read and a later
write depending on transaction timing/isolation.

Catch only known Prisma errors consistent with the target having disappeared,
for example:

- `P2003` for the `ExperienceMedia.experienceId` FK;
- `P2025` for the Experience update target missing.

On such an error:

1. re-check whether `experienceId` still exists;
2. if it is absent, log stale-target and return successfully;
3. if it still exists, rethrow the database error.

Do not blanket-catch all Prisma errors.

### 8.5 Preserve existing retry semantics

Unchanged:

- Wikimedia `RETRYABLE_FAILURE` must still throw;
- permanent provider failure for an existing Experience follows current
  permanent-failure behavior;
- authoritative empty remains ENRICHED with zero photo URLs;
- replay-safe media upsert behavior remains unchanged.

================================================================================
9. REQUIRED TESTS
================================================================================

Do not rely only on emulator screenshots. Add deterministic tests where the
repository's test infrastructure supports them.

### 9.1 Backend unit tests — mandatory

Extend:

`be/src/modules/media/services/media-enrichment-processor.service.spec.ts`

Required new cases:

1. target missing before lookup
   - `prisma.experience.findUnique` returns null;
   - Wikimedia lookup is NOT called;
   - transaction is NOT opened;
   - outbox is NOT called;
   - handler resolves without error.

2. target disappears before transactional persistence
   - initial existence check succeeds;
   - provider returns FOUND;
   - transaction-level existence check returns null;
   - no media upsert;
   - no Experience update;
   - no outbox event;
   - handler resolves.

3. FK/update race with confirmed deletion
   - simulated `P2003` or `P2025` during persistence;
   - post-error existence check returns null;
   - handler resolves as stale no-op.

4. same database error while Experience still exists
   - re-check returns existing row;
   - handler rejects/rethrows;
   - proves unrelated DB failures are not swallowed.

5. existing regression tests remain green
   - FOUND persists URLs;
   - replay-safe upsert;
   - RETRYABLE_FAILURE throws;
   - AUTHORITATIVE_EMPTY writes ENRICHED/0.

### 9.2 Frontend deterministic verification

The current frontend has no established Jest unit-test script in `fe/package.json`.
Do not introduce an entire test framework only for this bug unless the current
branch has since added one.

At minimum:

- TypeScript compile/check must be clean using the repo's current available
  command/tooling;
- web bundle/export must still compile where relevant;
- no new lint/type errors.

If a frontend test harness exists by execution time, add tests for:

- Wikimedia host detection;
- Android-only header injection;
- non-Wikimedia source receives no UA override;
- fallback activates once on primary error;
- changing primary URI resets error state;
- fallback error does not loop;
- `TourHeader` fallback becomes visible after generation finishes.

================================================================================
10. ANDROID MANUAL VERIFICATION — MANDATORY
================================================================================

A native Android verification is required because the original bug is native
transport/rendering behavior.

Build from the versioned Expo config/current branch. Do not test an old APK.

Recommended flow from `fe/`:

```bash
npx expo run:android
```

or the repository's equivalent current Android build command.

### 10.1 Network evidence

Use emulator/device logs and/or network inspection to prove:

- failing Wikimedia URL before fix produced the relevant failure;
- after fix, the Android image request succeeds;
- no global network User-Agent rewrite was introduced.

### 10.2 Required screens

Verify with real remote media on Android:

- Tour detail header;
- Experience detail gallery;
- Tour stop cards;
- composite Experience detail/cards when available;
- Saved tours;
- Map/list thumbnails if present.

### 10.3 Required visual states

Verify all:

1. authentic Wikimedia image loads;
2. broken/404 remote image shows safe fallback instead of black rectangle;
3. Tour generating with no cover shows skeleton;
4. cover arriving during generation fades in;
5. generation completing with no authentic image displays visible category
   fallback;
6. navigating between items with different URLs does not preserve stale
   `AppImage` failure state.

Capture screenshots for the PR/handoff if the execution environment supports
it.

================================================================================
11. IOS / WEB REGRESSION CHECK
================================================================================

Because the Android fix is targeted, verify no regressions on existing working
platforms.

### iOS

- Wikimedia images continue to load;
- no Android-only request header behavior leaks into iOS;
- TourHeader fade/skeleton behavior remains correct.

### web

- images still render;
- no attempt is made to set forbidden browser User-Agent headers;
- layout does not change due to `AppImage` wrapper.

================================================================================
12. IMPLEMENTATION ORDER
================================================================================

Execute in this order to keep failures attributable.

### Task 1 — Characterize before changing

- checkout/pull latest `feat/preference-first-selection`;
- record HEAD;
- inspect current versions of all named files;
- reproduce at least one Android Wikimedia failure and capture URL/status/log;
- confirm whether any actual cleartext failure exists.

Do not edit until current evidence is recorded.

### Task 2 — Add backend stale-event tests first

- extend processor spec with the missing/deleted-target cases;
- run focused test and confirm new cases fail against current implementation.

### Task 3 — Harden media processor

- implement early existence guard;
- implement transaction-level existence guard;
- implement narrow confirmed-deletion handling;
- rerun focused and media module tests.

### Task 4 — Add `AppImage`

- implement host parsing;
- Android-only Wikimedia UA;
- fallback state machine;
- preserve layout/accessibility behavior.

### Task 5 — Migrate product media surfaces

- update known call sites;
- inventory current branch for remaining relevant raw remote image usage;
- do not touch unrelated images.

### Task 6 — Fix TourHeader fade

- derive condition from final `imageUri`;
- preserve generation skeleton;
- preserve cover SSE transition;
- use `AppImage` in the rendered image path.

### Task 7 — Conditional cleartext work only if proven

- if no real cleartext error: explicitly skip;
- if proven: add Expo build-properties/config with opt-in dev-only policy;
- never edit generated native source as canonical fix.

### Task 8 — Verification

- backend focused tests;
- backend broader tests relevant to media/outbox;
- frontend TypeScript/build validation;
- Android native live check;
- iOS/web smoke regression where available.

================================================================================
13. COMMANDS / VERIFICATION TARGETS
================================================================================

Backend minimum from `be/`:

```bash
yarn test media-enrichment-processor.service.spec.ts --runInBand
yarn typecheck
yarn lint:check
```

Then broader backend verification if those pass:

```bash
yarn test --runInBand
```

Frontend/current workspace:

Use the repository's current TypeScript/build commands. At the time this plan
was authored `fe/package.json` has no dedicated `typecheck` script, so do not
invent `yarn typecheck` inside `fe` without checking current scripts first.
A suitable direct TypeScript check may be:

```bash
npx tsc --noEmit
```

from `fe/`, if current tsconfig supports it.

Web compile smoke check where practical:

```bash
yarn build:web
```

Android native:

```bash
npx expo run:android
```

If the project uses an already-generated local native tree, remember that it is
not canonical source; regenerate/apply config as needed before claiming the
versioned fix works.

================================================================================
14. FILES EXPECTED TO CHANGE
================================================================================

Expected/allowed core changes:

Frontend:

- `fe/components/ui/AppImage.tsx` (new)
- `fe/components/tour-details/TourHeader.tsx`
- `fe/app/experiences/[id].tsx`
- `fe/components/tour-details/TourStopCard.tsx`
- `fe/components/tour-details/CompositeExperienceDetail.tsx`
- `fe/components/tour-details/CompositeStopCard.tsx` if applicable
- `fe/app/(tabs)/saved.tsx`
- `fe/app/(tabs)/map.tsx` if applicable
- `fe/app.config.js` ONLY if the cleartext workstream is proven necessary
- `fe/package.json` / lockfile ONLY if `expo-build-properties` is actually needed

Backend:

- `be/src/modules/media/services/media-enrichment-processor.service.ts`
- `be/src/modules/media/services/media-enrichment-processor.service.spec.ts`

Unexpected changes to preference selection, acquisition, planner, Prisma schema
or media ranking require explicit justification and should normally be rejected
from this bugfix.

================================================================================
15. DO-NOT-DO LIST FOR ANTIGRAVITY
================================================================================

Do NOT:

- implement the deferred image-ranking spec;
- alter Experience selection/ranking to make the screenshots look better;
- change Wikimedia search queries/results for quality;
- replace documentary photos with AI-generated images;
- globally override OkHttp/User-Agent;
- commit generated `fe/android` or `fe/ios` trees as the primary solution;
- enable cleartext globally in production without explicit proof/requirement;
- catch and ignore every Prisma exception;
- change the `ExperienceMedia` FK/cascade schema to hide stale-event races;
- mark deleted Experiences as media FAILED;
- emit `ExperienceMediaUpdated` for an Experience that no longer exists;
- remove SSE/skeleton behavior from TourHeader;
- rewrite unrelated UI components while migrating image rendering;
- claim the image-quality problem is solved by this bugfix.

================================================================================
16. DEFINITION OF DONE
================================================================================

This bugfix is complete only when:

- Android can render a known valid Wikimedia image that previously failed due
  to its native image-request identity;
- User-Agent override is Android + Wikimedia scoped, not global;
- a failed remote media URL visibly degrades to fallback rather than black;
- `TourHeader` fallback is visible after generation finishes with no authentic
  image;
- SSE-delivered cover images still fade in correctly;
- stale media events for deleted Experiences are harmless no-ops;
- real backend failures still propagate/retry as before;
- direct generated-native edits are not the source of truth;
- cleartext is unchanged unless a real required HTTP failure was reproduced;
- backend focused tests are green;
- broader relevant checks are green;
- Android manual verification is documented;
- iOS/web behavior has no observed regression;
- no media relevance/ranking implementation leaked into this change.

================================================================================
17. HANDOFF REPORT REQUIRED FROM IMPLEMENTER
================================================================================

When Antigravity finishes, require a concise report containing:

1. starting HEAD and final HEAD;
2. exact files changed;
3. which root causes were reproduced;
4. whether cleartext was actually needed (with evidence); 
5. exact `AppImage` host/header policy;
6. exact stale-event behavior implemented;
7. tests/commands executed and their real results;
8. Android screens manually verified;
9. any iOS/web regression checks;
10. confirmation that media-quality ranking was NOT started;
11. any pre-existing unrelated failures encountered.

Do not accept “tests should pass” or “looks fixed” as verification.
