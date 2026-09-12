# Exploration Signals — Canonical Addendum

Status: **canonical design addendum for Preference-First A7 and later composition**
Written: 2026-09-11
Branch of record: `feat/preference-first-selection`

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/plans/2026-09-11-a7-evidence-backed-exploration-signals.md`
- `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`

This addendum supersedes the old A7 idea that one scalar `iconicity` score is a
sufficient representation of `PreferenceSpec.explorationStyle`.

The product-level preference remains useful:

```ts
explorationStyle: 'iconic' | 'local_deep_dive' | 'balanced'
```

but it is explicitly **not a tourism-standard taxonomy and not a categorical
property of an Experience**. It is a traveler-side ranking preference that is
translated into deterministic ranking weights over independent, evidence-backed
signals.

---

## 1. Decision

Replace the conceptual model:

```text
Experience.iconicity: 0..1
        +
user.explorationStyle
        ↓
ranking tilt
```

with:

```text
grounded source evidence
        ↓
ExplorationSignals
  prominence
  tourismIntensity
  localCharacter
        +
user.explorationStyle
        ↓
deterministic ranking tilt
```

There is no valid equality/matching predicate:

```text
experience.explorationStyle == user.explorationStyle
```

and there is no `exploration_style` facet.

---

## 2. Why one `iconicity` axis is insufficient

A single low↔high iconicity axis collapses several independent concepts:

- public prominence / fame;
- tourism intensity;
- local cultural character;
- quality;
- semantic relevance to the traveler.

Those concepts must remain separate.

Canonical examples:

```text
high prominence + high quality + real local cultural value
  → Teatro Colón may satisfy all three; it is not a "tourist trap" merely
    because it is famous.

low prominence + no local evidence
  → an obscure mediocre venue does NOT become a good local-deep-dive choice.

high tourism intensity + high local character
  → both signals may legitimately coexist; ranking policy decides the tilt.
```

Therefore:

> **Low prominence is not evidence of local character.**

and:

> **High prominence is not evidence of poor quality or inauthenticity.**

---

## 3. Canonical signal model

A7 should expose an evidence-aware structure conceptually equivalent to:

```ts
export interface EvidenceBackedExplorationSignal {
  value: number | null;       // normalized 0..1 when known
  confidence: number;         // normalized 0..1
  evidence: ExplorationSignalEvidence[];
  reasonCodes: string[];      // deterministic/debuggable, not product copy
}

export interface ExplorationSignals {
  prominence: EvidenceBackedExplorationSignal;
  tourismIntensity: EvidenceBackedExplorationSignal;
  localCharacter: EvidenceBackedExplorationSignal;
}
```

Exact field names may vary slightly during implementation, but these semantics
are mandatory.

### 3.1 `prominence`

Answers:

> How publicly prominent / widely recognized / destination-defining is this
> Experience or its grounded components?

Grounded/measurable inputs may include:
- Google Places user-rating/review count (log-scaled; count, not rating quality);
- Wikidata sitelink count;
- Wikipedia/Wikidata article presence where already available;
- Wikivoyage listing/prominence metadata;
- explicit landmark/heritage/notability metadata as a weaker supporting signal.

`prominence` is not quality. A famous low-quality place can be prominent.

### 3.2 `tourismIntensity`

Answers:

> How strongly does grounded evidence indicate concentration around mainstream
> tourist visitation / tourist-circuit usage?

Accept only evidence that actually supports this concept, for example:
- trusted structured source metadata explicitly marking a major tourist
  attraction / tourism hotspot;
- grounded source claims normalized by a future evidence-classification layer;
- future measurable tourism-flow or tour-density signals when available.

Do NOT infer high tourism intensity merely from fame/review count.

If current evidence cannot support this dimension, return `value:null`.

### 3.3 `localCharacter`

Answers:

> How strongly does grounded evidence support a meaningful local/neighborhood/
> traditional/community character?

Potential grounded claims/signals include:
- "popular with locals";
- "neighborhood institution";
- "traditional market";
- "family-run since ...";
- "local institution";
- "community cultural venue";
- explicit source evidence of local/traditional usage or identity.

Absence from Wikidata/Wikivoyage/Google is NOT local-character evidence.
Low review count is NOT local-character evidence.
Low prominence is NOT local-character evidence.

If no positive grounded evidence exists, return `value:null`, not `0` solely
because the Experience is obscure.

---

## 4. Unknown is different from zero

This distinction is mandatory:

```text
null / unknown
  = we do not currently have enough grounded evidence to score this signal

0
  = we have meaningful evidence supporting the low end of this signal
```

Do not collapse missing evidence to zero.

This protects the ranking from turning sparse-data Experiences into fake
`local_deep_dive` winners.

A deterministic ranking policy must define neutral handling for unknown values;
unknown must not be treated as positive evidence.

---

## 5. `explorationStyle` translation

`explorationStyle` remains a traveler-side meta-preference.

### `iconic`

Ranking tilt:
- positive weight toward known `prominence`;
- no automatic penalty/bonus from unknown `localCharacter`;
- quality, requested facets, semantic relevance, hard feasibility and anchors
  remain independent and authoritative in their own positions.

It does NOT mean "select the highest review count regardless of preferences".

### `local_deep_dive`

Ranking tilt:
- positive weight toward **positively evidenced** `localCharacter`;
- negative/moderating weight toward **positively evidenced** high
  `tourismIntensity`;
- prominence may be neutral or only weakly moderating according to the
  documented composition weights;
- low/unknown prominence by itself gives **no local-deep-dive bonus**.

Canonical prohibition:

```text
local_deep_dive != inverse(prominence)
```

### `balanced`

Adds no material exploration-style tilt. Other ranking signals decide.

---

## 6. Ranking-only boundary

Exploration signals are ranking context only.

They MUST NOT:
- create a requested facet match;
- upgrade weak → strong;
- satisfy coverage;
- stop targeted acquisition;
- create an acquisition deficit;
- bypass PostGIS geography;
- bypass evidence/identity validation;
- bypass hard exclusions;
- override a must-anchor feasibility failure;
- override planner feasibility;
- turn an unsupported Experience into a tourism Experience.

The canonical order remains conceptually:

```text
truth / eligibility
  geography + identity + evidence + facet match + quality + hard constraints
        ↓
eligible candidates
        ↓
personalization / ranking
  facet weights + semantic similarity + quality + exploration signals
  + anchors + diversity
        ↓
planner feasibility
```

---

## 7. Evidence/provenance

Every non-null exploration signal must be explainable from grounded inputs.

A7 is deterministic. It does not ask an LLM whether an Experience is "iconic"
or "authentic".

A7 may consume already-normalized grounded facts from providers/catalog metadata.
Future research/classification stages may enrich the normalized evidence set, but
they must preserve provenance to source evidence.

At minimum, signal debug/provenance should make it possible to explain:

```text
prominence=0.86
because:
- placesReviewCount=24500
- wikidataSitelinks=42
- wikivoyageListed=true

localCharacter=unknown
because:
- no grounded local-character evidence currently available
```

Do not store generated prose as the authority for the score.

---

## 8. Persistence boundary

A7 does not require a new database table or schema migration.

For v1, compute ExplorationSignals deterministically from the hydrated canonical
Experience/provider metadata already available to composition, or expose a pure
input contract that can be fed by that metadata later.

Do not persist one opaque `iconicity` scalar as the canonical truth.

If exploration evidence/signals are persisted later for performance, persist:
- the independent signal values;
- version/provenance/inputs needed for invalidation;
- unknown distinctly from known zero.

That future persistence is not part of A7 unless existing metadata already has a
natural non-invasive place and the implementation plan explicitly requires it.

---

## 9. Relationship to future autonomous research

The future Travel Agent may discover richer evidence that improves these
signals. Examples:
- local newspapers/blogs describe a place as a neighborhood institution;
- Wikivoyage describes an attraction as heavily touristed;
- a historical source establishes strong local/traditional significance.

That future evidence can enrich `localCharacter` / `tourismIntensity` /
`prominence` after normal evidence validation.

However, `explorationStyle` itself remains a ranking preference, not a missing
fact that forces acquisition.

A future research policy MAY use it as secondary query/source guidance while it
is already researching legitimate uncovered facets/capacity, but it must never
become:

```text
"local_deep_dive is uncovered => acquire until local_deep_dive is satisfied"
```

---

## 10. Composition correction

Where the main implementation plan currently shows:

```ts
iconicity: number;
```

that is superseded by:

```ts
explorationSignals: ExplorationSignals;
```

or a thin composition-ready projection retaining the three independent signal
values plus known/unknown state.

Composition derives one deterministic `explorationTilt` from:

```text
PreferenceSpec.explorationStyle + ExplorationSignals
```

The derived tilt is request-specific and should not be persisted as an intrinsic
Experience property.

Trace/Bitácora should expose the contributing human-readable signals when they
materially affected ranking, e.g.:

```text
Más destacada por ser una referencia ampliamente reconocida
Priorizada por evidencia de carácter barrial/local
Moderada por alta intensidad turística
```

with exact scores/provenance available only in technical details.

---

## 11. Required semantic tests

A7 and later composition tests must prove:

1. high review count/sitelinks can increase prominence without changing quality;
2. low prominence alone does NOT create localCharacter;
3. missing local evidence yields `localCharacter.value === null`, not a positive
   local score;
4. explicit grounded local-character evidence can produce a positive score;
5. tourismIntensity is unknown when unsupported rather than inferred from
   prominence alone;
6. `iconic` can reorder otherwise-comparable eligible candidates toward known
   prominence;
7. `local_deep_dive` can reorder toward grounded localCharacter and/or away from
   grounded high tourismIntensity;
8. an obscure candidate with no local evidence does not beat a genuinely
   local-evidenced candidate merely because it is obscure;
9. `balanced` adds no exploration tilt;
10. changing explorationStyle does not change factual facet coverage;
11. no exploration signal creates strongness/sufficiency/acquisition authority;
12. deterministic repeat input produces identical signals and ranking.

---

## 12. Canonical replacement rule

Any older plan/spec wording that says:

```text
computeIconicity(): 0..1
iconic = high iconicity
local_deep_dive = low iconicity
```

is superseded by this addendum.

The word `iconicity` may still appear historically in characterization/progress,
but new implementation authority is **evidence-backed ExplorationSignals**.
