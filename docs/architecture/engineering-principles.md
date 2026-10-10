# Engineering principles

Status: canonical maintainability guidance for Zig-Zag architecture and code quality.

This document explains the repository-wide engineering rules enforced by `/AGENTS.md`. It is intentionally tool-agnostic: Codex, Claude, Antigravity, human contributors, and future agents should produce code that respects the same boundaries.

Some sections are backend-specific and some are frontend-specific; the general principles apply across the repository.

Operational enforcement lives in `/AGENTS.md`: its mandatory engineering-principles gate applies automatically to every non-trivial task. The principles below are architectural constraints, not optional review suggestions. This document owns rationale and examples; `/AGENTS.md` owns the required preflight, implementation discipline, and PASS/FAIL completion procedure.

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

A completed cutover deletes superseded decision-making code, contracts, adapters, compatibility projections, and tests that exist only for the discarded architecture unless an explicit current product requirement still depends on them.

Zig-Zag is early-stage: persisted development data and historical internal contracts are disposable by default. Do not preserve historical-read compatibility, dual authorities, or legacy fallbacks "just in case", and do not move obsolete code into a `legacy`/`compat` module merely to keep it. Compatibility is retained only when the product/user explicitly requires it.

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

The checklist below is part of the mandatory completion gate in `/AGENTS.md`, not an optional retrospective. Before a milestone is considered complete, ask:

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

Passing tests, typecheck, and lint are required. They do not override architectural violations. Any applicable FAIL blocks completion until it is corrected or an explicit product-level exception is agreed.

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

# Frontend-specific principles

The frontend is not a second implementation of the backend domain. It is a client of canonical backend contracts plus local presentation and interaction state.

The goal is to keep screens easy to reason about, preserve cross-platform behavior, and prevent UI code from gradually becoming an alternative source of business truth.

## 14. Keep remote-data access out of presentational components

Presentational components should render typed props and emit user intents/events. They should not decide how to call backend endpoints.

Prefer:

```text
screen / feature hook
      ↓
typed API layer / query hook
      ↓
backend

screen / feature hook
      ↓
presentational component
```

Avoid:

```text
TourStopCard
  ├─ axios.get(...)
  ├─ retry policy
  ├─ navigation
  ├─ analytics
  └─ rendering
```

API transport belongs in `fe/api` and feature-level data/orchestration hooks. A reusable UI component should not know endpoint URLs, auth headers, retry semantics, or backend transport details.

## 15. Backend/domain truth must not be re-invented in the frontend

The backend is authoritative for domain semantics such as:

- Experience identity;
- classification;
- quality;
- planning feasibility;
- persisted tour state;
- canonical geographic meaning;
- generation status and trace semantics.

The frontend may derive presentation state from canonical data, but it must not reproduce backend policies with a second, drifting implementation.

### Bad

```ts
const isStrongExperience =
  experience.qualityScore >= 3 &&
  locallyGuessThemeMatch(experience, requestedTheme);
```

when the backend already owns strong-match semantics.

### Better

Render backend-provided canonical state or introduce an explicit API contract if the UI genuinely needs a derived domain fact.

## 16. Typed API contracts are boundaries, not suggestions

Do not compensate for unclear API contracts with widespread casts, `any`, or ad-hoc optional chaining.

Prefer a typed boundary:

```text
HTTP payload
   ↓
typed API function / decoder
   ↓
frontend domain/view model
   ↓
components
```

If an API response shape changes, update the canonical frontend contract in one place and let type errors expose affected consumers.

Do not copy backend enums/string literals independently into multiple screens. Centralize shared frontend representations or generate/share types where practical.

## 17. Separate server state, interaction state, and derived presentation state

These are different categories and should not be mixed indiscriminately.

- **server state**: tours, Experiences, media, generation status;
- **interaction state**: selected tab, expanded accordion, draft form values;
- **derived presentation state**: formatted labels, display geometry mode, grouped day sections.

Avoid copying server data into local component state merely to render it. That creates synchronization bugs.

Prefer deriving presentation values from the current canonical data unless local editing/draft semantics require a deliberate fork.

## 18. Components and hooks should have one dominant responsibility

A screen can orchestrate several concerns, but large components/hooks that simultaneously own transport, domain transformation, navigation, timers, side effects, analytics, and rendering become difficult to test and evolve.

When a component/hook grows, split by responsibility rather than by arbitrary line count.

Typical boundaries:

```text
API/query hook       → remote state
feature hook         → interaction/orchestration
view-model helper    → deterministic presentation transformation
component            → rendering + user events
```

Do not create tiny abstractions for every expression; extract when there is a meaningful responsibility or reusable policy.

## 19. Side effects must be explicit and lifecycle-safe

Network calls, navigation, subscriptions, timers, notifications, and persistence are side effects.

Do not trigger them during render or hide them in helpers that appear pure.

Effects must:

- have clear ownership;
- have correct dependency lists;
- clean up subscriptions/timers/listeners;
- tolerate rerenders;
- avoid duplicate requests/actions caused by lifecycle churn.

For SSE, maps, and generation-progress flows, cleanup and idempotent subscription behavior are part of correctness.

## 20. Async UI states are explicit product states

Remote flows should deliberately model relevant states such as:

```text
idle / loading / success / empty / degraded / error / retrying
```

Do not collapse materially different backend states into one spinner or one generic fallback if the distinction affects user behavior.

Likewise, do not fabricate successful presentation data to hide missing backend state. Unknown/degraded remains visible as such when meaningful.

## 21. Cross-platform behavior is a first-class constraint

Zig-Zag targets web, iOS, and Android from the same frontend.

A fix is incomplete if it solves one target by silently degrading another.

Top-level screens retain a stable full-viewport application shell. Responsive max widths belong to suitable inner content, not around the entire screen.

Platform-specific implementations (`.web.tsx`, native modules, platform APIs) are appropriate where capabilities genuinely differ. They must preserve the same user/domain semantics unless the product explicitly defines otherwise.

Avoid sprinkling `Platform.OS` conditionals throughout business/UI logic when a platform-specific adapter/component boundary is clearer.

## 22. Design system before local styling conventions

Shared visual semantics should use canonical tokens/components rather than repeated literal styling.

Prefer:

- design tokens for color/spacing/typography;
- shared primitives for recurring interaction patterns;
- consistent states for disabled/loading/error/selected;
- one canonical component when two surfaces mean the same thing.

Avoid copy/pasted color values, spacing formulas, typography definitions, and button semantics across screens.

A one-off layout may remain local; a repeated semantic pattern should become shared.

## 23. Navigation is orchestration, not hidden component behavior

Low-level presentational components should normally emit intents such as `onPressExperience(id)` rather than owning route construction themselves.

Navigation belongs at screen/feature boundaries where route context and product flow are known.

This keeps components reusable and prevents domain cards from accumulating routing assumptions.

## 24. Avoid duplicated transformation logic across screens

Formatting and deterministic view-model transformations that carry product meaning should have one canonical implementation.

Examples:

- Experience geometry presentation;
- tour/day totals presentation;
- media fallback selection;
- generation-state labels;
- component grouping/order presentation.

If two screens independently reconstruct the same concept from raw API fields, extract a typed shared helper/view-model function.

Pure presentational formatting that genuinely differs by surface does not need forced unification.

## 25. Accessibility and interaction semantics are part of correctness

Interactive elements should expose the correct semantic role and usable state across supported platforms.

At minimum:

- use real interactive primitives rather than clickable decorative containers where possible;
- preserve keyboard/web interaction where relevant;
- provide accessible labels for icon-only actions;
- respect disabled/loading states;
- keep touch targets practical;
- do not encode essential meaning through color alone.

Accessibility regressions are not merely visual polish issues.

## 26. Performance work must follow ownership and measurement

Do not add memoization, caches, duplicated local state, or bespoke virtualization preemptively everywhere.

Optimize known hotspots such as large lists, maps, expensive geometry transformations, and high-frequency updates based on measured or structurally obvious cost.

Prefer fixing ownership/data-flow problems before masking them with `useMemo`/`useCallback` everywhere.

A rerender is not automatically a bug; unstable subscriptions, repeated network calls, expensive transformations, or poor list/map behavior are.

## 27. Frontend tests should prove user-visible contracts

Tests should focus on meaningful behavior and boundaries rather than implementation trivia.

Good targets include:

- API contract mapping;
- feature-hook state transitions;
- generation/loading/error/degraded flows;
- navigation outcomes;
- cross-platform rendering behavior where implementations differ;
- regression cases for canonical view-model transformations.

Do not preserve stale frontend tests by reintroducing removed backend fields or legacy domain concepts.

If a fixture is based on an obsolete backend schema, migrate the fixture/test to current contracts.

## 28. Frontend maintainability review is part of correctness

Before considering a frontend milestone complete, ask:

1. Is any presentational component making direct backend/API calls?
2. Did we duplicate backend/domain truth locally?
3. Are API contracts explicit and typed?
4. Did `any`, unchecked casts, or generic metadata become a hidden contract?
5. Are server state and local interaction state being unnecessarily duplicated?
6. Does one component/hook own too many unrelated responsibilities?
7. Are side effects explicit, idempotent, and cleaned up correctly?
8. Are async/degraded/error states represented deliberately?
9. Does the change behave correctly on web, iOS, and Android?
10. Did we introduce repeated literal styles instead of using the design system?
11. Is navigation owned at the appropriate feature/screen boundary?
12. Did we duplicate a deterministic transformation already implemented elsewhere?
13. Are accessibility semantics preserved?
14. Is a performance workaround hiding a data-flow/ownership problem?
15. Do tests exercise current product contracts rather than obsolete implementation details?

As with backend work, passing typecheck/lint/tests is necessary but not sufficient if the architecture becomes harder to maintain.
