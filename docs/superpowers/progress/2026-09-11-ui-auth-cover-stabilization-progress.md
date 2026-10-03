# Stabilization Progress: UI, Auth & Async Tour Cover Updates

Date: 2026-09-11
Branch: `feat/experience-domain-v2`
Base Commit: `1430b53515d8272caadfca4a97f4be920466363d`
Status: Completed & Verified

## Overview

A stabilization pass was performed directly on `feat/experience-domain-v2` to address regressions and edge cases introduced in the UI/auth/async cover photo changes, preserving all existing Tour and Experience generation architectural invariants.

## Detailed Fixes Implemented

### FIX 1: Apple Development Mock Isolation
- **Problem**: `AppleTokenService` previously accepted mock tokens (`dev_mock_apple_*`) unconditionally when `allowDevAppleAuthMock` was missing or unchecked against production environment flags.
- **Resolution**:
  - Updated `be/src/core/config/auth.config.ts` to define `allowDevAppleAuthMock: !isProduction && process.env.ALLOW_DEV_APPLE_AUTH_MOCK === 'true'`.
  - In `be/src/modules/auth/services/apple-token.service.ts`, guarded mock token bypass so it is strictly rejected in production or when the environment flag is false.
  - Added `ALLOW_DEV_APPLE_AUTH_MOCK=${ALLOW_DEV_APPLE_AUTH_MOCK:-true}` in `docker-compose.yml`.
  - Expanded `apple-token.service.spec.ts` with comprehensive test coverage (mock accepted in dev when enabled; rejected when disabled; rejected in production even if flag is true; real token verification preserved).

### FIX 2: Canonical Bundle ID Alignment
- **Problem**: Inconsistent bundle identifier configurations across mobile app and backend client ID verification.
- **Resolution**:
  - Aligned `fe/app.config.js` `ios.bundleIdentifier` to canonical `com.entitiybuilders.zig-zag`.
  - Aligned `be/src/core/config/auth.config.ts` `appleClientIds` default to `['com.entitiybuilders.zig-zag']`.
  - Aligned `docker-compose.yml` `APPLE_CLIENT_IDS` to `com.entitiybuilders.zig-zag`.

### FIX 3: Atomic Re-read & Metadata Preservation in TourImageService
- **Problem**: Asynchronous destination photo resolution running concurrently with background experience generation could overwrite tour metadata (`generationTrace`, `executionSummary`, `generationStatus`) and roll back lifecycle states.
- **Resolution**:
  - Re-read latest Tour state inside a Prisma `$transaction` (`tx.tour.findUnique`).
  - If `latest.coverImage` is already set (by a concurrent process or manual action), the transaction safely skips the overwrite.
  - Merged existing `latestMetadata = this.objectMetadata(latest.metadata)` to preserve all concurrent progress and bitacora traces.
  - Emitted `TourProgressUpdated` with `status: currentStatus` derived from `latestMetadata.generationStatus` (retaining `'completed'` if generation finished during photo resolution).
  - Also protected the `not_resolved` fallback path inside `$transaction` with atomic re-read.

### FIX 4: Lifecycle Guard in Frontend SSE & Itinerary Skeleton Rendering
- **Problem**: A delayed `tour.progress` SSE event carrying a cover photo could force `isGeneratingExperiences: true` even if the tour had already completed. Additionally, `ItinerarySkeleton` was imported but never rendered.
- **Resolution**:
  - In `fe/app/tours/[id].tsx`, updated `useSSE` event handler to ensure `payload.status === 'completed' || payload.status === 'failed'` sets `isGeneratingExperiences: false`, and `generating`/`pending` only sets `true` if `tour.experiences` is empty.
  - Updated `fe/components/tour-details/ItinerarySkeleton.tsx` to accept `showHeaderCard?: boolean` and removed unused imports.
  - Rendered `<ItinerarySkeleton showHeaderCard={false} />` alongside `GenerationPipeline` when `isGeneratingExperiences && stops.length === 0`.

### FIX 5: Truthful Photo Provider Provenance & Spec Alignment
- **Problem**: Metadata recorded `provider: 'wikimedia'` even when photos originated from Wikipedia page images or geosearch. Spec document also lacked explicit details on implemented sources vs future fallbacks.
- **Resolution**:
  - `TourImageService.fetchDestinationPhoto()` returns `{ url, provider }` where provider is `'wikipedia_search' | 'wikipedia_summary' | 'wikipedia_geosearch' | 'wikimedia'`.
  - Persisted truthful provider in `tour.metadata.coverImageResolution.provider`.
  - Updated `docs/superpowers/specs/2026-09-10-destination-cover-photo-async-resolution.md` documenting Wikipedia/Wikimedia implementation and clarifying Google Places as a future fallback.

### FIX 6: Defensive Loading of `expo-notifications`
- **Problem**: Direct imports or hardcoded `return null;` either crashed simulators without APNs entitlements or disabled push notifications entirely on capable devices.
- **Resolution**:
  - In `fe/features/notifications/push-notifications.ts`, dynamically load `expo-notifications` in `try / catch` with caching.
  - In `fe/app/_layout.tsx`, dynamically load `expo-notifications`, safely attach `setNotificationHandler` if available, and ignore missing native server modules without crashing.

### FIX 7: SecureStore Fallback Production Guard
- **Problem**: Failing `getItemAsync` silently degraded to `AsyncStorage` on mobile platforms, risking storing authentication tokens in plain text in release builds.
- **Resolution**:
  - In `fe/api/config/token-storage.ts`, guarded `AsyncStorage` fallback on native iOS/Android to only occur when `__DEV__ === true`.
  - In production (`!__DEV__`), throws an error rather than silently persisting credentials in plain text.
  - Web platform continues using `AsyncStorage` as intended.

### FIX 8: Dynamic Country Derivation & Wizard Cancel State
- **Problem**: `TourWizardForm` hardcoded `country: 'Argentina'` when selecting any destination. Canceling the wizard or clearing destination could leave `AppContext.address` in an inconsistent state.
- **Resolution**:
  - Captured `initialAddressRef = useRef(address)` on mount in `fe/components/tours/TourWizardForm.tsx`.
  - Dynamically parsed country from `label.split(',')` (taking the last segment if available, or empty string), avoiding hardcoding.
  - Restored `initialAddressRef.current` if destination is cleared or user presses back/cancels on step 1.

### FIX 9: UI Props & Lint Cleanup
- **Problem**: TypeScript/lint issues in `ItinerarySkeleton.tsx`, `index.tsx`, `map.tsx`, and `auth.service.spec.ts`.
- **Resolution**:
  - Removed unused `StyleSheet` and `Sparkles` imports from `fe/components/tour-details/ItinerarySkeleton.tsx`.
  - Replaced unsupported `maxW={120}` on Gluestack `Text` with `style={{ maxWidth: 120 }}` in `fe/app/(tabs)/index.tsx`.
  - Replaced invalid `space="2xs"` and `space="$2"` with `space="xs"` and `space="sm"` in `fe/app/(tabs)/map.tsx`.
  - Formatted multi-line arguments in `be/src/modules/auth/services/auth.service.spec.ts` to satisfy prettier.
  - Removed trailing newline in `be/src/modules/tours/services/tour-image.service.spec.ts`.

## Verification Results

1. **Unit Tests (Backend)**:
   ```bash
   yarn test src/modules/auth/services/apple-token.service.spec.ts \
             src/modules/auth/services/auth.service.spec.ts \
             src/modules/tours/services/tour-image.service.spec.ts --runInBand
   ```
   **Result**: 3 test suites passed, 23 tests passed (0 failures).

2. **Backend Typecheck**:
   ```bash
   yarn typecheck
   ```
   **Result**: `tsc --noEmit` exited 0 (clean).

3. **Backend Lint**:
   ```bash
   yarn lint:check
   ```
   **Result**: `eslint "{src,apps,libs,test}/**/*.ts"` exited 0 (clean).

4. **Frontend Typecheck Verification**:
   Verified `fe/app/(tabs)/index.tsx` and `fe/app/(tabs)/map.tsx` resolve without TypeScript property errors.
