# A7 — Evidence-Backed Exploration Signals

Status: **next implementation task after approved A6/A6.1**
Branch: `feat/preference-first-selection`
Written: 2026-09-11

Canonical references:
- `docs/superpowers/specs/2026-09-11-exploration-signals-design.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`

This task **supersedes the old A7 — Iconicity util** section from the main
implementation plan.

Do not implement a single `computeIconicity(): 0..1` utility as the canonical
representation of exploration style.

---

## Context

A1–A6.1 are approved.

`PreferenceSpec.explorationStyle` remains:

```ts
'iconic' | 'local_deep_dive' | 'balanced'
```

but it is a traveler-side meta-preference, not a standardized taxonomy on
Experiences and not a facet.

A7 now introduces independent evidence-backed signals that later composition can
use to translate that meta-preference into a ranking tilt.

Canonical rule:

```text
low prominence != local character
high prominence != low quality
unknown != zero
```

---

## 1. Scope

Create a deterministic exploration-signal utility/model for three independent
signals:

```text
prominence
tourismIntensity
localCharacter
```

No provider calls.
No LLM calls.
No embeddings.
No acquisition.
No live orchestration wiring.
No database migration.

A7 is a pure/canonical primitive similar in scope to A4/A5.

---

## 2. Target interfaces

Create a file such as:

`be/src/modules/tours/utils/exploration-signals.util.ts`

and, if cleaner, a nearby interface file.

Use a shape conceptually equivalent to:

```ts
export interface ExplorationSignalEvidence {
  source: string;
  key: string;
  value?: string | number | boolean;
}

export interface EvidenceBackedExplorationSignal {
  value: number | null;
  confidence: number;
  evidence: ExplorationSignalEvidence[];
  reasonCodes: string[];
}

export interface ExplorationSignals {
  prominence: EvidenceBackedExplorationSignal;
  tourismIntensity: EvidenceBackedExplorationSignal;
  localCharacter: EvidenceBackedExplorationSignal;
}
```

Exact naming may be adjusted for repository conventions, but preserve:
- independent dimensions;
- nullable unknown state;
- deterministic confidence/provenance;
- no single opaque `iconicity` score.

Keep values normalized to `0..1` when non-null.
Clamp/sanitize corrupt numeric inputs deterministically.

---

## 3. Input contract

Do not make the utility depend directly on a giant Prisma row or provider
service. Give it a small normalized deterministic input contract representing
available grounded facts.

Conceptually:

```ts
export interface ExplorationSignalInput {
  placesReviewCount?: number | null;
  wikidataSitelinkCount?: number | null;
  wikipediaPresent?: boolean | null;
  wikivoyageListed?: boolean | null;
  heritageOrLandmark?: boolean | null;

  // Only accepted when already grounded/normalized by a trusted evidence layer.
  explicitTourismIntensityEvidence?: Array<{
    strength: number;
    evidenceKey: string;
    source: string;
  }>;

  explicitLocalCharacterEvidence?: Array<{
    strength: number;
    evidenceKey: string;
    source: string;
  }>;
}
```

Do not keyword-scan arbitrary descriptions, names, snippets or raw JSON inside
A7.

If current repository metadata cannot yet supply one of the later evidence
arrays, support an empty input and produce `unknown`; do not fabricate a score.

---

## 4. Prominence

Implement a deterministic prominence score from genuinely measurable inputs.

Candidate inputs:
- Places review/user-rating count;
- Wikidata sitelink count;
- Wikipedia presence;
- Wikivoyage listing;
- heritage/landmark as a small supporting term only.

Use saturation/log-like normalization for unbounded counts so one giant number
does not dominate linearly.

For example, implement explicit pure helpers rather than magic inline math:

```ts
normalizeReviewCount(...)
normalizeSitelinkCount(...)
computeProminence(...)
```

Weights/thresholds must be named constants and unit-tested.

Important:
- Places *rating value* is quality, not prominence; do not use star rating here.
- Review *count* may contribute to prominence.
- `heritage=true` alone must not force a near-1 prominence score.
- absence of a source should reduce confidence/known evidence, not automatically
  imply prominence 0.

If there are no meaningful prominence inputs, return `value:null`.

---

## 5. Tourism intensity

Do not derive tourismIntensity from prominence/review count alone.

A7 only consumes explicit normalized tourism-intensity evidence if available.

Examples of acceptable future upstream evidence:
- source explicitly identifies a major tourist attraction/hotspot;
- grounded research evidence indicates unusually heavy tourist-circuit use;
- future structured tourism-density evidence.

For current A7:
- combine explicit grounded strengths deterministically if supplied;
- otherwise `value:null`;
- keep evidence keys/source provenance.

Do not build a keyword classifier in this task.

---

## 6. Local character

Do not derive localCharacter from obscurity.

Canonical prohibition:

```text
low review count
OR no Wikidata
OR no Wikivoyage
OR low prominence
    !=
local character
```

A7 only produces positive/known localCharacter from explicit normalized grounded
evidence supplied to the utility.

Examples of future acceptable upstream evidence:
- neighborhood institution;
- popular with locals;
- traditional market;
- long-standing family-run/local institution;
- community cultural venue;
- explicit local/traditional identity from trusted sources.

For current A7:
- combine explicit grounded strengths deterministically when supplied;
- otherwise `value:null`;
- preserve provenance.

---

## 7. Unknown semantics

This is a required part of the implementation, not documentation-only.

```ts
value: null
```

means insufficient grounded evidence.

`value: 0` means there is actual grounded support for the low endpoint, if such
evidence is representable by the input contract.

Do not automatically convert missing arrays/metadata into zero.

Confidence for an unknown signal may be `0`, but value remains `null`.

---

## 8. Exploration-style ranking projection

A7 should also expose a pure helper that converts
`PreferenceSpec.explorationStyle + ExplorationSignals` into a deterministic
ranking-only tilt, e.g.:

```ts
export interface ExplorationTilt {
  score: number;
  contributions: Array<{
    signal: 'prominence' | 'tourismIntensity' | 'localCharacter';
    contribution: number;
    reasonCode: string;
  }>;
}

computeExplorationTilt(style, signals): ExplorationTilt
```

This helper is allowed in A7 because it defines the canonical semantics that C2
will later consume, but **do not wire it into composition yet** unless the main
plan explicitly reaches C2.

Required semantics:

### `iconic`
- positive contribution from known prominence;
- unknown prominence => neutral, not negative;
- local/tourism signals do not become hard filters.

### `local_deep_dive`
- positive contribution from known positive localCharacter;
- negative/moderating contribution from known high tourismIntensity;
- low/unknown prominence alone gives no positive contribution;
- do not implement `1 - prominence` as local score.

### `balanced`
- score exactly neutral (prefer `0`) regardless of signals.

Keep weights as named deterministic constants.

---

## 9. Tests — required

Add focused unit tests covering at least:

### Prominence
1. many Places reviews > few Places reviews, holding other evidence equal;
2. more Wikidata sitelinks > fewer, holding other evidence equal;
3. review count changes prominence but never changes/reads quality rating;
4. no prominence evidence => `value:null`;
5. corrupt negative/NaN/Infinity counts sanitize safely;
6. huge counts saturate instead of increasing unboundedly;
7. heritage alone is only a modest supporting signal.

### Local character
8. no explicit local evidence => `value:null` even for an obscure Experience;
9. low review count alone does NOT generate localCharacter;
10. explicit grounded local evidence produces positive localCharacter;
11. multiple grounded local evidence inputs combine deterministically;
12. provenance/evidence keys are retained.

### Tourism intensity
13. high prominence alone does NOT generate tourismIntensity;
14. no explicit tourism evidence => `value:null`;
15. explicit grounded tourism-intensity evidence produces a known score;
16. provenance/evidence keys are retained.

### Exploration tilt
17. `iconic`: known higher prominence gives higher tilt;
18. `iconic`: unknown prominence is neutral;
19. `local_deep_dive`: grounded localCharacter gives positive tilt;
20. `local_deep_dive`: grounded high tourismIntensity moderates/penalizes;
21. `local_deep_dive`: obscure + no local evidence gets NO bonus;
22. `balanced`: exact neutral tilt;
23. same input repeated => deep-equal deterministic result.

### Architectural boundary
24. utility has no provider/Prisma/LLM/embedding dependency;
25. there is no `exploration_style` facet generation/matching in this task;
26. no exploration signal is exposed as a boolean `matches`/`satisfied` result.

---

## 10. Current metadata mapping

Before implementing the adapter that supplies `ExplorationSignalInput`, inspect
what fields actually exist today in hydrated Experience metadata and the current
source adapters.

Do not invent unavailable fields merely to make tests pass.

If current A7 can only compute robust `prominence` while
`tourismIntensity/localCharacter` remain unknown for real catalog rows, that is
acceptable and preferable to heuristics based on absence.

The utility/interface must still support future explicit grounded evidence so B1,
B2/future research-agent work can populate it later without replacing A7's
semantics.

If an existing metadata field already explicitly represents one of these facts,
map it only when its provenance/meaning is clear.

---

## 11. Main-plan corrections this A7 supersedes

Read the main plan, but apply these replacements:

### Old A7

Do NOT implement:

```text
A7 — Iconicity util
computeIconicity(): 0..1
```

Implement this A7 plan instead.

### C1 CompositionCandidate

Old:

```ts
iconicity: number;
```

Future C1 must use:

```ts
explorationSignals: ExplorationSignals;
explorationTilt: number; // request-specific derived ranking signal, if useful
```

or an equivalent thin projection preserving independent signals.

### C2 ordering

Where the main plan says "exploration-style tilt", interpret it as:

```text
computeExplorationTilt(PreferenceSpec.explorationStyle, ExplorationSignals)
```

Never raw iconicity inversion.

### Trace / Bitácora

Future trace should record, when relevant:
- explorationStyle;
- known/unknown exploration signals;
- deterministic tilt/contributions;
- provenance/reason codes in technical details.

Do not expose a fake `iconicity` fact as the whole explanation.

---

## 12. Non-goals

Do NOT:
- implement C1/C2 composition wiring;
- call Places/Wikidata/Wikivoyage live;
- run web research;
- add LLM classification;
- add embeddings;
- add a database table/migration;
- persist an opaque iconicity scalar;
- create a hard filter for explorationStyle;
- make explorationStyle part of coverage/sufficiency/acquisition;
- infer localCharacter from missing popularity data;
- infer tourismIntensity from review count alone;
- start Checkpoint B.

---

## 13. Verification

At minimum:

```bash
cd be

yarn test <new exploration-signals unit spec path>
yarn typecheck
npx eslint <new/changed A7 files>
yarn test src/modules/tours
```

No real Postgres integration test is required solely for the pure A7 utility
unless the implementation adds a real metadata adapter that genuinely benefits
from a persistence round-trip.

CI remote is not the gate.

---

## 14. Commit/progress discipline

Implementation commit recommendation:

```text
feat(tours): add evidence-backed exploration signals
```

Push and obtain the real SHA.

Then update progress with:
- base HEAD;
- A7 implementation SHA;
- actual current metadata fields mapped;
- which signals are computable today vs unknown without future evidence;
- tests/results;
- explicit confirmation that low prominence is never treated as localCharacter;
- explicit confirmation that no exploration signal affects coverage/sufficiency;
- explicit confirmation that Checkpoint B did not start.

Progress commit recommendation:

```text
docs(progress): record A7 exploration signals
```

Push and STOP for review.

---

## Definition of Done

A7 is complete when:

```text
grounded normalized evidence
        ↓
ExplorationSignals
  prominence         known or unknown
  tourismIntensity   known or unknown
  localCharacter     known or unknown
        ↓
computeExplorationTilt(style, signals)
        ↓
ranking-only deterministic context
```

and all of the following are true:
- no single canonical `iconicity` scalar represents exploration style;
- unknown is distinct from zero;
- low prominence is not local evidence;
- high prominence is not low quality;
- explorationStyle remains outside facet coverage/acquisition;
- no provider/LLM/embedding calls are introduced;
- later composition can consume these signals without changing factual matching.
