# Multi-source Experience acquisition — progress

Canonical design: `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md`
Implementation plan: `docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md`

# Current State

- Branch: `feat/experience-domain-v2`
- Verified commit: `e1f3c18382269e6af9a6d77f2b89e28f9f523377`
- Verified base HEAD: `f93b5b0ef587f090d4d67358546fd8bbbc698115`
- Current milestone: Phase 1 — Wikivoyage Structured Acquisition Adapter (HARDENED & VERIFIED)
- Last verified test state: backend Jest `110/110` suites and `747/747` tests passing (baseline was `107/107` suites, `721/721` tests; +3 new suites, +26 tests).
- Linting: `yarn lint:check` is 100% clean (0 errors, 0 warnings).
- Typecheck: `yarn run check` introduces zero new errors; existing errors remain strictly confined to pre-existing `be/test/acceptance` fixtures.

# Completed

### Phase 1: Wikivoyage Structured Acquisition Adapter
- **Shared Provider-Neutral Acquisition Contracts**:
  Created `be/src/modules/tours/interfaces/experience-acquisition.interface.ts` defining:
  - `ExperienceAcquisitionProvider` (`'wikivoyage' | 'osm' | 'google_places' | 'web'`)
  - `SourceEvidenceType` (`'tourism_activity' | 'place' | 'route' | 'area' | 'operator' | 'editorial'`)
  - `SourceObservationGeo`
  - `SourceObservation`
  - `AcquisitionProviderResult<T>`
- **Wikivoyage API Boundary & Types**:
  Created `be/src/modules/tours/interfaces/wikivoyage-api.interface.ts` defining MediaWiki response models, internal section enums (`SEE`, `DO`, `EAT`, `OTHER`), and `WikivoyageEntry`.
- **Wikivoyage API Service & Balanced Parser**:
  Created `be/src/modules/tours/services/wikivoyage-api.service.ts`:
  - Balanced brace extractor preventing premature termination on nested templates and links.
  - Recognizes characterized listing templates (`see`, `do`, `eat`, `listing`, `listado`, `ver`, `hacer`, `comer`).
  - Robust parameter parsing (`name`/`nombre`, `content`/`description`/`descripción`/`contenido`, `lat`/`latitude`, `long`/`lon`/`longitude`, `wikidata`).
  - Sibling failure isolation (malformed entries skipped individually without failing valid siblings).
  - Explicit error discrimination: `missingtitle` -> `not_found`, HTTP/network/parse error -> `failed`.
- **Fixtures and Comprehensive Tests**:
  - Saved 7 fixtures under `be/test/fixtures/wikivoyage/`: `san-telmo.json`, `la-boca.json`, `recoleta.json`, `palermo.json`, `missing-article.json`, `mediawiki-error.json`, `malformed-entry.json`.
  - Unit tests in `be/src/modules/tours/services/wikivoyage-api.service.spec.ts` (12 tests) verifying fixture parsing, coordinate parsing, QID extraction, sibling fault isolation, and mocked HTTP transport failures (HTTP 500, timeouts, malformed payloads).
- **Wikivoyage Acquisition Provider**:
  Created `be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts`:
  - Narrow `acquire(destination, options?)` signature.
  - Maps `WikivoyageEntry` into provider-neutral `SourceObservation` with stable evidenceKey (`wikivoyage:${articleSlug}:${entrySlug}`).
  - Returns `{ status: 'success', value: [] }` on missing article.
  - Unit tests in `be/src/modules/tours/providers/wikivoyage-acquisition.provider.spec.ts` (4 tests).
- **Conservative Mechanical Candidate Synthesizer**:
  Created `be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.ts`:
  - Strictly mechanical mapping:
    - `place` -> `role: 'venue'`, `expectedKind: 'PLACE'`
    - `area` -> `role: 'area'`, `expectedKind: 'AREA'`
    - `route` -> `role: 'route'`, `expectedKind: 'ROUTE'`
    - `tourism_activity`, `operator`, `editorial` -> `componentHints: []`
  - Zero semantic inference: `themes: []`, `traits: []`, `intents: []`, `orderedByEvidence: false`.
  - Unit tests in `be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.spec.ts` (5 tests).
- **NestJS Module Wiring**:
  Registered and exported `WikivoyageApiService`, `WikivoyageAcquisitionProvider`, and `StructuredExperienceCandidateSynthesizerService` in `be/src/modules/tours/tours.module.ts`. Downstream orchestration untouched.
- **Live Wikivoyage Characterization**:
  Characterized San Telmo, La Boca, Buenos Aires/Recoleta, and Palermo (Buenos Aires) with live metrics:
  - San Telmo: 9 entries (7 place, 2 tourism_activity); coords 4/9 (44%), QID 4/9 (44%); latency 229ms.
  - La Boca: 4 entries (3 place, 1 tourism_activity); coords 0/4 (0%), QID 4/4 (100%); latency 210ms.
  - Buenos Aires/Recoleta: 9 entries (8 place, 1 tourism_activity); coords 3/9 (33%), QID 5/9 (56%); latency 235ms.
  - Palermo (Buenos Aires): 13 entries (12 place, 1 tourism_activity); coords 5/13 (38%), QID 5/13 (38%); latency 370ms.
- **Phase 1 Hardening (Coordinate Validation & Strict Numeric Parsing)**:
  - Hardened `WikivoyageApiService` coordinate parsing to reject partially numeric inputs (e.g. `"12abc"`, `"-34.61foo"`) using strict regex `/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/` and finite number check.
  - Added geographic boundary checks: latitude within `[-90, 90]` and longitude within `[-180, 180]`.
  - Added 5 dedicated unit tests in `be/src/modules/tours/services/wikivoyage-api.service.spec.ts` covering valid coordinates, non-numeric strings, partially numeric strings, out-of-range latitude, and out-of-range longitude.

# In Progress

None. Phase 1 is complete.

# Not Started

- Phase 2: Deterministic Corroboration Merge & Evidence Merging.
- Phase 3: Dimension-Aware Preference Ranking & Source Routing Table.
- Phase 4: Google Places Migration to Shared Candidate/Resolver Pipeline.
- Phase 5: Proactive OSM Gap-Filling Acquisition Provider.
- Phase 6: Tavily/Web Long-Tail Discovery Refinement.
- Phase 7: End-to-End Validation & Integration Verification.

# Verification

- `yarn test --runInBand` (`be/`): PASS — 110 suites, 747 tests (zero regressions, +3 suites, +26 tests).
- `yarn lint:check` (`be/`): PASS — 0 errors across entire repository.
- `yarn run check` (`be/`): TypeScript compilation in `be/src/` has 0 errors. Pre-existing errors in `test/acceptance` remain unchanged.
- Live characterization: `be/test/characterize-wikivoyage.ts` executed successfully against live MediaWiki API.

# Important Decisions / Invariants

- The operational implementation plan is authoritative; this progress checkpoint is a verified execution index.
- Milestone scope strictly preserved: Phase 1 provides adapter, provider, mechanical synthesizer, and module wiring. It does NOT wire into `CoverageAnalyzer`, deficit routing, tour solver, or tour generation.
- Strict mechanical synthesis: no semantic inference for themes/traits/intents. `GeoEntityHint` generated only for `place`, `area`, and `route`. `tourism_activity` leaves `componentHints` empty.
- `SourceObservation` remains strictly provider-neutral.
- No premature operational complexity (no caching/throttling before characterization proves necessity).

# Next Action

Phase 1 is complete. Stop before Phase 2. Next action will be to plan and implement Phase 2 (Deterministic Corroboration Merge) upon user instruction.
