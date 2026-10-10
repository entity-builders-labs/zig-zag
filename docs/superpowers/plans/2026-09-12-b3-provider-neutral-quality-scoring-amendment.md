# B3 Amendment — Provider-Neutral Quality Scoring

Status: **normative amendment to B3 of `2026-09-11-preference-first-selection-implementation.md`.**
Written: 2026-09-12.

Canonical clarification:
- `docs/superpowers/specs/2026-09-12-provider-neutral-quality-scoring-clarification.md`

This amendment must be read together with B3 before implementation. It narrows B3 semantics; it does not start B3 and does not authorize unrelated refactors.

## B3 correction

`quality-score.util.ts` MUST be provider-neutral. Do not assume Google Places capabilities.

Current `IPlacesApiService` can be backed by:
- `google`;
- `geoapify`.

`PlaceData.rating` and `PlaceData.userRatingCount` are optional. Geoapify intentionally returns them as unavailable. Therefore a missing rating/review count is `unknown`, never zero and never a negative quality signal.

### Supported inputs

The scorer should consume a normalized evidence input rather than provider-specific service objects. Conceptually:

```ts
interface QualityScoreInput {
  placesRating?: number | null;
  placesReviewCount?: number | null;
  wikivoyageListed?: boolean | null;
  wikidataSitelinkCount?: number | null;
  componentQualityScores?: Array<number | null>;
  componentNotabilitySignals?: number[];
  // Future normalized, grounded research signals may be added later.
}
```

The exact shape may follow existing metadata structures, but the utility must remain pure and deterministic and must not inspect `PLACES_PROVIDER` to decide quality.

### Semantics

- Places rating + review-count confidence contribute only when actually present.
- `rating === undefined/null` is not `0`.
- `userRatingCount === undefined/null` is not `0`.
- A provider that lacks rating/review capability is not penalized.
- Wikivoyage/Wikidata may independently produce non-null quality.
- Multi-component Experiences may derive quality from grounded component quality/notability when the composite has no direct rating.
- Do not assign a flat route/walk score.
- If no usable grounded signal exists, return `null`.
- Missing one signal must not erase valid signals from other sources.

### Geoapify acceptance

B3 MUST explicitly work for Geoapify-shaped data:

```ts
placesRating: undefined
placesReviewCount: undefined
```

With WV/WD or component evidence, quality may still be non-null and may clear the quality floor.

With no other usable grounded evidence:

```ts
qualityScore === null
```

Do not produce `0`, a low default, or a provider penalty.

### Future agentic/research boundary

B3 should be designed so future agentic research can add normalized grounded quality signals without replacing the deterministic scorer.

Future research may improve evidence coverage for Experiences that lack direct provider ratings, especially routes, walks, neighborhoods, cultural institutions and Geoapify-sourced places. It must contribute evidence/provenance, not an opaque LLM-authored “quality rating”.

The authority remains:

```text
grounded evidence -> deterministic quality-score utility -> qualityScore
```

### Required tests — add to existing B3 matrix

Keep the original B3 tests and add:

- rating/review missing is treated as unknown, not zero;
- Geoapify-shaped input + Wikivoyage/Wikidata evidence -> non-null quality;
- Geoapify-shaped input + strong component evidence -> can clear `QUALITY_FLOOR`;
- Geoapify-shaped input + no other evidence -> `null`;
- an otherwise identical evidence bundle scores the same when optional unsupported Places fields are omitted rather than present as `undefined`;
- no branch or magic constant penalizes `provider='geoapify'`;
- future/unknown provider capability gaps behave the same way: absence is neutral, not negative evidence.

### Scope guard

Do not in B3:
- call Google/Geoapify/Wikivoyage/Wikidata directly from `quality-score.util.ts`;
- add agentic research calls;
- invent a fallback rating with an LLM;
- change `PLACES_PROVIDER` selection;
- modify facet matching or strong/weak semantics beyond consuming the resulting `qualityScore` through the already-defined quality floor;
- start B4 or later checkpoints.
