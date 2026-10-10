# Media Relevance Ranking and Representative Tour Cover Selection — Design

Status: deferred, execute after `preference-first-selection` is complete
Branch when authored: `feat/preference-first-selection`
Date: 2026-09-12
Related:
- `docs/superpowers/specs/2026-09-10-destination-cover-photo-async-resolution.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `be/src/modules/media/services/wikimedia-commons.service.ts`
- `be/src/modules/media/services/media-enrichment-processor.service.ts`
- `be/src/modules/media/services/media-presentation.resolver.ts`
- `be/src/modules/integrations/photos/providers/wikimedia-photo.provider.ts`
- `be/src/modules/tours/services/tour-image.service.ts`

================================================================================
1. PURPOSE AND EXECUTION ORDER
================================================================================

This specification is intentionally NOT part of the current
`preference-first-selection` implementation.

It defines the next media-quality project to execute only after the current
preference-first selection work is complete and stable.

Reason for separation:

- preference-first selection decides WHICH Experiences belong in the Tour;
- this project decides WHICH photos best represent an already-known Experience
  and WHICH selected Experience best represents an already-built Tour;
- mixing both concerns in the same rollout would make regressions difficult to
  attribute and would invite media concerns to alter deterministic Experience
  selection.

Hard dependency:

1. finish `preference-first-selection`;
2. establish its green verification baseline;
3. create a dedicated implementation branch from that completed baseline;
4. execute this media-quality design without changing preference semantics.

This document is the canonical deferred design. Do not opportunistically
implement pieces of it while fixing Android image-delivery bugs.

================================================================================
2. PROBLEM STATEMENT
================================================================================

The current system can successfully obtain real documentary image URLs while
still presenting poor or irrelevant imagery.

Two distinct quality failures exist.

### 2.1 Experience photo quality

The canonical V2 media enrichment path currently calls
`WikimediaCommonsService.findPhotosForExperience()`.

Its current behavior is approximately:

1. search Commons by `"<experience name> <destination label>"`;
2. request a small result set;
3. if any image results exist, return them;
4. otherwise fall back to coordinate geosearch;
5. persist returned photos in provider/result order;
6. `MediaPresentationResolver` chooses the first persisted photo as
   `primaryPhoto`.

The pipeline therefore lacks an explicit stage responsible for determining
whether a photo is actually a strong visual representation of the Experience.

A technically valid Wikimedia image is not necessarily a good product image.

### 2.2 Tour cover representativeness

`TourImageService.resolveDestinationCoverImage()` currently resolves a cover
primarily from the administrative destination label and destination
coordinates.

That assumption is insufficient.

Example:

- destination: Puerto Iguazú;
- selected Experiences include Cataratas del Iguazú, Garganta del Diablo and
  Hito Tres Fronteras;
- a generic image of Puerto Iguazú can be factually correct but still be a poor
  cover for the Tour;
- the cover should normally represent the strongest landmark/Experience that
  actually defines the generated itinerary.

The Tour cover must become itinerary-aware rather than destination-label-only.

================================================================================
3. NON-GOALS
================================================================================

This project must NOT:

- change which Experiences are selected for a Tour;
- change preference interpretation, facet weighting or deterministic ranking;
- change daily planning, ordering, duration or route feasibility;
- make an LLM the authority for whether a place or image entity is real;
- add Android networking workarounds;
- solve React Native image rendering failures;
- replace the existing durable media/outbox lifecycle;
- download and persist image binaries in Postgres;
- remove truthful image provenance or attribution.

Android delivery/fallback reliability belongs to the separate bugfix plan:
`docs/superpowers/plans/2026-09-12-android-image-delivery-and-media-enrichment-hardening.md`.

================================================================================
4. CURRENT-STATE FINDINGS TO PRESERVE
================================================================================

### 4.1 URL-only persistence remains correct

The existing media domain persists image URLs plus metadata rather than image
binary bodies. Preserve this invariant.

### 4.2 Media enrichment remains asynchronous

`ExperienceMediaEnrichmentRequested` and `ExperienceMediaUpdated` remain the
canonical lifecycle boundary. Quality improvements must fit inside that
pipeline rather than moving synchronous media lookup into Tour selection.

### 4.3 Existing provider provenance remains authoritative

Every persisted candidate must retain truthful source/provider, attribution,
license and source URL where available.

### 4.4 There are currently overlapping Wikimedia implementations

The repository contains both:

- `WikimediaCommonsService`, used by canonical V2 media enrichment; and
- `WikimediaPhotoProvider`, which performs stronger entity-oriented matching,
  including Wikipedia/geographic verification and additional Commons photos.

The implementation phase must explicitly decide how to converge these rather
than silently maintaining two independent media-quality policies.

Do not simply duplicate logic from one class into the other.

================================================================================
5. TARGET ARCHITECTURE
================================================================================

Target Experience-media flow:

Experience
    ↓
Exact/verified entity context
    ├── canonical Experience name
    ├── GeoEntity identity
    ├── Wikidata QID when available
    ├── Wikipedia page identity when available
    ├── provider external identity when available
    └── verified coordinates
    ↓
Media candidate acquisition
    ├── canonical Wikipedia lead image
    ├── exact-entity Wikimedia Commons images
    ├── entity/geographic Wikimedia fallback
    └── future provider-specific sources under their own policy
    ↓
MediaCandidate[]
    ↓
Hard eligibility filters
    ↓
Deterministic relevance/quality scoring
    ↓
Stable ranked list
    ↓
primaryPhoto + gallery order
    ↓
URL-only persistence + provenance

Target Tour-cover flow:

Completed/selected Tour Experiences
    ↓
Representative-Experience selection
    ↓
Best eligible primary media for those Experiences
    ↓
Tour cover suitability check
    ↓
Tour.coverImage
    ↓
Destination-level fallback only if itinerary media is unavailable

================================================================================
6. MEDIA CANDIDATE CONTRACT
================================================================================

Introduce one normalized internal candidate contract before persistence/ranking.
The exact TypeScript location may be decided during implementation, but the
semantic fields are required.

Illustrative contract:

```ts
interface MediaCandidate {
  url: string;
  provider: string;
  sourceUrl?: string;
  caption?: string;
  author?: string;
  authorUrl?: string;
  license?: string;
  licenseUrl?: string;
  width?: number;
  height?: number;

  entityEvidence: {
    kind:
      | 'canonical_page_lead'
      | 'wikidata_entity'
      | 'exact_title'
      | 'verified_geographic_match'
      | 'text_search'
      | 'geographic_fallback';
    sourceEntityId?: string;
    sourceEntityTitle?: string;
    confidence: number;
  };

  providerRank?: number;
  searchRank?: number;
  roleHint?: 'hero' | 'gallery' | 'unknown';
}
```

Do not persist invented confidence as external truth. Confidence is an internal
ranking signal describing how strongly ZigZag linked the image to the verified
Experience.

================================================================================
7. HARD ELIGIBILITY FILTERS
================================================================================

A candidate must be rejected before scoring when it is clearly unsuitable.
At minimum reject:

- SVG/vector-only assets when the presentation surface expects photography;
- maps, locator maps and route diagrams;
- flags, coats of arms and logos;
- PDFs/audio/video/non-photo formats;
- obviously tiny images below a documented minimum usable resolution;
- missing/invalid URLs;
- known placeholder/dummy images;
- candidates whose entity evidence is incompatible with the resolved
  Experience;
- pathological aspect ratios unsuitable for any supported presentation role.

Do not use a low score to retain content that should be categorically rejected.

================================================================================
8. DETERMINISTIC MEDIA SCORING
================================================================================

V1 ranking must be deterministic and explainable.

No LLM call is required for V1 ranking.

Recommended signal groups:

1. Entity relevance / identity confidence — highest weight
   - canonical page lead image;
   - same Wikidata entity;
   - exact verified page/title match;
   - verified geographic match;
   - generic text/geographic result only as lower-confidence fallback.

2. Source prominence
   - canonical lead image outranks arbitrary Commons search result;
   - explicit provider rank/search rank may contribute but is never the sole
     authority.

3. Technical quality
   - sufficient pixel dimensions;
   - useful landscape/portrait ratio for the requested role;
   - reject/penalize extreme crops or very low resolution.

4. Presentation-role suitability
   - hero/cover should strongly prefer landscape imagery with enough width;
   - gallery ranking may accept additional orientations.

5. Metadata relevance
   - caption/title tokens matching the verified entity can raise confidence;
   - generic destination-only tokens must not beat an exact entity match.

Suggested initial weighting envelope, to be finalized with fixtures:

- entity relevance: 40–50%;
- source prominence: 15–25%;
- technical quality: 15–20%;
- cover/gallery suitability: 10–15%;
- metadata relevance: 5–10%.

Weights must live in one documented configuration/utility, not scattered
through providers.

Stable tie-break rules are required so identical inputs yield identical media
ordering.

================================================================================
9. EXPERIENCE PRIMARY PHOTO RULES
================================================================================

`MediaPresentationResolver` must stop defining primary media as simply the
first persisted provider result.

Desired invariant:

`primaryPhoto` is the highest-ranked eligible media item for the Experience and
requested presentation role.

Gallery order must reflect the same deterministic ranking.

If no documentary candidate passes eligibility:

- use the existing presentation fallback policy;
- mark it truthfully as fallback;
- never relabel a generic fallback as documentary/authentic media.

================================================================================
10. REPRESENTATIVE TOUR COVER SELECTION
================================================================================

The Tour cover must be selected from the generated itinerary before falling
back to a generic destination photo.

### 10.1 Candidate Experiences

Only Experiences actually materialized into the Tour are eligible for the
primary itinerary-aware cover path.

### 10.2 Representative-Experience score

Define a deterministic score from signals already known after Tour planning,
for example:

- Experience preference/relevance score already produced by selection;
- quality score;
- iconic/prominence signal when available;
- whether it is a major anchor rather than a generic supporting stop;
- availability of a high-confidence hero-suitable image;
- avoid selecting purely logistical/supporting Experiences as covers.

This score must NOT feed back into Experience selection. It runs after selection
and planning.

### 10.3 Cover fallback order

Recommended order:

1. best hero-suitable media from the most representative selected Experience;
2. next representative selected Experience with eligible hero media;
3. verified destination-level iconic photo;
4. neutral/category fallback according to presentation policy.

The current destination-level resolver therefore remains useful, but becomes a
fallback rather than the first semantic authority.

================================================================================
11. REQUIRED REGRESSION FIXTURES
================================================================================

### 11.1 Puerto Iguazú / Cataratas del Iguazú

Input scenario:

- destination: Puerto Iguazú, Misiones, Argentina;
- selected Tour Experiences include:
  - Cataratas del Iguazú;
  - Garganta del Diablo;
  - Hito Tres Fronteras.

Required assertions:

- a verified high-quality Cataratas/Parque Nacional photo outranks a generic
  Puerto Iguazú city image when Cataratas is a selected major Experience;
- a city street, unrelated facility, logo, map or low-resolution image cannot
  become primary cover merely because a provider returned it first;
- the final reason/provenance for the chosen cover is inspectable.

### 11.2 Famous urban landmark

Example: Paris with Eiffel Tower selected.

Verify that exact landmark media wins over loosely related Paris images when
used as the Experience primary image.

### 11.3 Non-iconic local Experience

Use a restaurant/café/local venue fixture where an exact entity photo should
beat a famous but unrelated destination landmark.

This protects against over-applying city-level prominence.

### 11.4 No acceptable media

All candidates rejected or unavailable.

Verify truthful fallback behavior with no fabricated documentary status.

================================================================================
12. OBSERVABILITY / BITÁCORA
================================================================================

Media decisions should be auditable without exposing secrets.

For enrichment and cover selection retain enough structured trace information
to answer:

- which providers were queried;
- which candidate URLs/entities were considered;
- which hard-rejection reason removed a candidate;
- the score breakdown for ranked candidates;
- which candidate became `primaryPhoto` / `coverImage` and why;
- which fallback path was used.

Do not dump large binary data or provider secrets into generation metadata.

================================================================================
13. PROVIDER POLICY
================================================================================

### Wikimedia / Wikipedia

Remain first-class sources for authentic, attributable documentary imagery.
Use exact entity/page identity whenever possible before generic text/geosearch.

### Google Places or other commercial providers

Treat as a separate future provider policy.

Before adding a provider to persisted media, explicitly verify:

- URL/reference lifetime;
- caching/storage restrictions;
- attribution requirements;
- whether a transient photo token/reference may legally/technically be stored;
- request cost and quota behavior.

Do not model every provider as a permanently cacheable URL merely because
Wikimedia URLs behave that way.

================================================================================
14. IMPLEMENTATION SEQUENCE AFTER PREFERENCE-FIRST COMPLETION
================================================================================

Phase M1 — characterize current behavior

- freeze real regression fixtures including Iguazú;
- capture current candidate/result ordering;
- add failing tests before ranking changes.

Phase M2 — candidate normalization and hard filtering

- introduce `MediaCandidate` boundary;
- converge duplicated provider filtering/entity evidence;
- preserve existing URL-only persistence and outbox lifecycle.

Phase M3 — deterministic Experience media ranking

- central scoring utility;
- stable tie-break;
- ranked persistence/presentation;
- `primaryPhoto` comes from ranked media.

Phase M4 — itinerary-aware Tour cover selection

- representative selected Experience scoring;
- hero suitability;
- destination resolver becomes fallback;
- preserve async/SSE persistence semantics.

Phase M5 — observability and live verification

- trace decision/rejection reasons;
- verify Iguazú plus at least two unrelated destinations on real provider data;
- confirm iOS, Android and web consume identical chosen URLs after transport
  concerns are removed.

================================================================================
15. ACCEPTANCE CRITERIA
================================================================================

This project is complete only when all are true:

- provider result order alone cannot determine `primaryPhoto`;
- deterministic hard filters reject clearly non-photographic/irrelevant media;
- deterministic scoring chooses the strongest eligible media;
- the same candidate input always produces the same ranking;
- Tour cover selection considers selected Tour Experiences before generic
  destination media;
- the Puerto Iguazú regression selects Cataratas/Parque Nacional imagery when
  Cataratas is a major selected Experience and qualifying media exists;
- local venue Experiences are not replaced visually by unrelated famous city
  landmarks;
- no preference-first selection semantics change;
- URL-only persistence, attribution and provider provenance are preserved;
- fallback status remains truthful;
- regression/unit/integration tests document the decision policy.

================================================================================
16. EXPLICIT HANDOFF NOTE
================================================================================

Do NOT begin this specification until `preference-first-selection` is declared
complete and its baseline tests are green.

When implementation starts, first re-audit the then-current repository because
media code may have changed while preference-first work was finishing. Treat
this document as the semantic contract, not as permission to blindly apply
2026-09-12 line-level assumptions.
