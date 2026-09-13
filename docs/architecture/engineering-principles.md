# Engineering principles

Status: canonical maintainability guidance for Zig-Zag backend architecture.

This document explains the repository-wide engineering rules enforced by `/AGENTS.md` and `be/AGENTS.md`. It is intentionally provider-agnostic and tool-agnostic: Codex, Claude, Antigravity, human contributors, and future agents should produce code that respects the same boundaries.

## 1. Normalize external systems at the boundary

External providers expose different schemas, capabilities, names, and quality signals. That variation belongs in provider adapters, not in the domain core.

```text
Google / Geoapify / OSM / Wikivoyage / Wikidata / Web
                         ↓
                  provider adapters
                         ↓
                normalized typed facts
──────────────────── domain boundary ────────────────────
                         ↓
 synthesis / quality / classification / catalog
 identity / ranking / composition / planning
```

The core may retain provenance such as provider/source identity for traceability, but it should not infer domain semantics from provider names.

### Good

```ts
const observation: SourceObservation = {
  ...,
  qualityEvidence: normalizedQualityEvidence,
};
```

```ts
const score = computeQualityScore(observation.qualityEvidence);
```

### Bad

```ts
if (observation.provider === 'google_places') {
  const rating = observation.metadata?.rating;
}

if (observation.provider === 'wikivoyage') {
  // infer editorial quality here
}
```

Provider-specific branching is expected in adapters/factories/configuration. It is a design smell in core domain/application services.

## 2. Typed facts, not metadata protocols

Flexible metadata is useful for provenance, diagnostics, and forward-compatible optional information. It must not become an undocumented protocol between services.

If downstream behavior depends on a value, define that value in an explicit type.

### Bad

```ts
const metadata = observation.metadata as Record<string, unknown>;
const reviewCount = metadata.userRatingCount as number;
```

The consumer now secretly knows the provider's raw schema.

### Better

```ts
interface RatingEvidence {
  value: number;
  reviewCount?: number;
}

interface QualityEvidence {
  consumerRating?: RatingEvidence;
  editorialListing?: EditorialListingEvidence;
  notability?: NotabilityEvidence;
}
```

A typed contract makes units, optionality, semantics, and ownership reviewable.

## 3. Prefer evidence types over provider types

When two providers expose equivalent evidence, the domain abstraction should describe the evidence, not one vendor.

For example, if both Google and Geoapify can supply a consumer rating, prefer a concept such as `consumerRating` over a core field named after one provider.

Provider-specific provenance may still accompany the normalized evidence for trace/debug purposes.

This keeps extension open:

```text
new provider
→ implement adapter normalization
→ existing core continues unchanged
```

rather than:

```text
new provider
→ modify synthesizer
→ modify quality service
→ modify ranking
→ modify planner
→ add more provider switches
```

## 4. One canonical implementation per domain policy

Zig-Zag has policies whose meaning must remain globally consistent:

- preference-facet matching;
- strong/weak match semantics;
- quality scoring;
- geographic validation;
- classification;
- Experience identity/dedupe;
- coverage/sufficiency;
- composition;
- feasibility and planning.

For each policy, there should be one canonical primitive or service. Other code composes it rather than reproducing equivalent logic.

Before implementing a new helper, search for the existing policy owner. If it cannot support the required behavior, evolve that canonical API deliberately.

Two helpers that answer the same business question differently are architectural debt even if both pass their local tests.

## 5. Unknown is a first-class state

Absence of evidence is not negative evidence and must not be converted into a convenient semantic value.

Examples:

- missing rating is not rating `0`;
- missing quality is not an automatic threshold-pass score;
- missing classification is not a traveler-request-derived classification;
- missing route order is not an arbitrary component order;
- missing AREA geometry is not permission to fabricate a polygon;
- provider failure is not evidence that an entity does not exist.

Use nullable/explicit degraded/unknown states and let downstream policies decide how unknown affects eligibility.

## 6. No magic defaults to make a pipeline green

A default is safe only when it is genuinely part of the product/domain contract.

A value introduced primarily to make a test, threshold, or branch pass is suspicious.

Bad examples:

```ts
qualityScore = qualityScore ?? 3.0;
```

```ts
classification = classification ?? requestedUserFacet;
```

```ts
radiusMeters = 25_000; // silently converts unresolved neighborhood AREA to a generic point scope
```

When a new canonical invariant exposes old missing data, fix the data-production path or migrate stale fixtures. Do not weaken the invariant merely to preserve previous behavior.

## 7. Tests model domain truth

Fixtures are executable architecture documentation. They must use current scales, units, and semantics.

Prefer explicit values when they determine the scenario:

```ts
qualityScore: 4.2 // deliberately strong on a 0..5 scale
```

instead of a helper default whose historical meaning may no longer be valid.

If a test claims warm catalog reuse, the first run must persist enough canonical evidence/classification/quality for the second run genuinely to satisfy current strong-match rules. A manual DB update between runs would invalidate what the test claims to prove.

## 8. Migration must end in one authority

Large refactors may need buildable intermediate states. That does not justify permanent dual pipelines.

```text
acceptable during migration:
legacy authority + new pieces under construction

required at cutover:
new canonical authority only
```

A completed cutover should delete or make unreachable superseded decision-making code. Compatibility code retained for historical reads must not remain an active generation fallback.

## 9. Generalize bugs; do not hardcode examples

Real-world spikes often reveal a general missing concept through one concrete example.

Example:

```text
San Telmo → Nominatim addresstype=suburb
```

The architectural question is not "how do we special-case San Telmo?" It is "how should neighborhood-scale urban AREA entities be represented and resolved canonically?"

Fix the general boundary/model. Add the concrete case as a regression test.

The same rule applies to providers, destinations, themes, route types, and user requests.

## 10. Dependency direction

Higher-level domain services should depend on normalized interfaces and domain capabilities. Provider implementations depend inward on those contracts, not the reverse.

Prefer:

```text
Domain policy → normalized interface ← provider adapter
```

Avoid:

```text
Domain policy → Google class / OSM schema / Wikivoyage metadata keys
```

This principle applies even when NestJS DI makes direct imports convenient.

## 11. Keep policy separate from transport and orchestration

Transport answers "how do we obtain data?"
Normalization answers "what fact did that data establish?"
Policy answers "what does that fact mean for Zig-Zag?"
Orchestration answers "what should happen next?"

Do not collapse these concerns simply because they occur sequentially.

Example for quality:

```text
provider response
→ adapter extracts normalized quality evidence
→ deterministic provider-neutral quality policy computes score
→ materialization persists canonical score
→ sufficiency applies quality floor
```

Each layer has one reason to change.

## 12. Maintainability review is part of correctness

Before a milestone is considered complete, ask:

1. Did provider knowledge leak beyond adapters/configuration?
2. Did we create an implicit metadata protocol?
3. Did we duplicate an existing domain policy?
4. Did we introduce a magic semantic default?
5. Are units/scales explicit and current?
6. Does a special case represent a general missing concept?
7. Is legacy decision-making still reachable after a claimed cutover?
8. Can a new provider be added by implementing an adapter rather than editing multiple core services?
9. Do tests prove the behavior they claim, using canonical persisted state?
10. Is the dependency direction still inward toward domain contracts?

Passing tests, typecheck, and lint are required. They do not override architectural violations.

## 13. Automate enforceable rules

Agent instructions document the policy; CI should enforce what can be checked mechanically.

Good candidates for architecture/lint tests include:

- provider identifiers imported or branched on outside allowed directories;
- forbidden dependencies from domain code into concrete provider adapters;
- reintroduction of deleted legacy orchestration callers;
- stale semantic scales/units where statically detectable;
- duplicated canonical-policy entry points;
- unsafe `any`/casts at selected domain boundaries.

The goal is not maximal lint strictness. The goal is preventing known architectural regressions from depending solely on reviewer memory.
