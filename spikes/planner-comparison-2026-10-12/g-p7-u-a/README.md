# G-P7-U.A — preference-utility encoding (2026-10-14)

Gate G-P7-U, part A only (task 33.0; design "P-D7 preference-first
objective"). Protocol: `PROTOCOL.md`. Evidence:

- `runs/encoding.json`: reference orderings × scenarios.
- `runs/current_code.json`: the live code on the same values.
- `runs/provenance.json`: the owner's provenance rule on the live facet
  vocabulary, and the live interpreter on the same inputs.

**Status (owner, 2026-10-14):** G-P7-U.A **RESOLVED**; G-P7-U.B **OPEN**;
P-D7 **OPEN**.

- The owner decided the PROVENANCE-1 rule (§4), then confirmed A with two
  adjustments (§6): UNKNOWN takes the median only as an ordering
  projection, and confidence never discounts DIRECT evidence.
- Implementation is tasks 25.2, 25.4 and 25.6.
- Part B (preference vs travel, mode friction, UNKNOWN-hours) is not
  touched.
**No coefficient is introduced.** The only numbers in the evidence are the
live code's own constants (`semanticWeight 1`, `qualityWeight 0.5`), which
are reproduced so they can be measured, and the scenario values.

## 1. Current pipeline (inspected 2026-10-14)

Request flow:

1. Request.
2. `PreferenceInterpreterService` (LLM; deterministic regex fallback).
3. `buildPreferenceSpec`.
4. Catalog window snapshot: every verified Experience in the geographic
   window, plus resolved anchor ids.
5. `ExperienceCompositionService.compose`:
   - strong facet matches via `isStrongFacetMatch`;
   - one pgvector similarity batch over exactly these ids
     (`WHERE id IN (...)`, cosine = 1 − distance);
   - hard exclusion via `findHardExclusionMatches`;
   - `composeSet`.
6. `PlanningCandidateNormalizerService`.
7. Greedy planner.

**Embeddings are never retrieval.** There is no ANN query. The candidate pool
is the catalog window plus anchors, so an Experience without an embedding
still reaches composition and planning. The pipeline is not
"embedding-first".

**Facet weights** (`buildPreferenceSpec`, `calculateEffectiveWeight`):

- A wizard theme or intent has weight 1.0 × 1.0 = 1.0.
- A free-text facet has weight importance × confidence, with importance
  taken from the interpreter's strength (strong 1.0, medium 0.7, weak 0.5).
- Duplicates on (dimension, key) keep the highest weight, so a wizard facet
  wins a same-key collision.
- `required` is always false.

These are canonical: Preference-First design 2026-09-10 §3 and §4.

**Explicit match** (`isStrongFacetMatch`) is binary. It requires the
canonical matcher, real geography, known quality ≥ 3.0/5 and a classification
not known to be thin. Consequence: every Experience with a non-zero explicit
affinity has **known** quality. Quality can only be UNKNOWN in the zero-affinity
tier.

## 2. Defects — confirmed / disproven

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The planner recombines semantic + preferenceWeight + quality | CONFIRMED | `daily-planning-candidate-sort.util.ts:10` `plannerRelevanceScore`. Used by the greedy sort, placement scoring, must-anchor placement, ordering, and the generation's solution comparison. |
| 2 | This is a second policy authority | CONFIRMED | `composeSet` orders by Σ matched weight → semantic → quality → tilt → anchor → id. The planner uses an additive sum. They disagree on A2, B2 and E1 (`runs/current_code.json`). |
| 3 | Semantic can outweigh explicit affinity | CONFIRMED, for free-text weights | A2 (medium free-text facets, weight 0.42): the planner ranks B (one facet, sim 0.98) above A (both facets, sim 0.60): 1.90 vs 1.79. With wizard weights 1.0 the order holds in A1. Also confirmed: **quality can outweigh semantic** (B2: 1.92 vs 1.80). |
| 4 | Missing embedding is coerced to 0 | CONFIRMED, in both places | Composition service: `semantic.scores.get(id) ?? 0` (lines 123–125). Normalizer: `semanticSimilarity ?? 0` (line 70). In C1 the real `composeSet` pushes U — equal explicit evidence and the best quality — out of the initial portfolio into the reservoir, only because its similarity became 0. |
| 5 | `rankCandidatesByRelevance` is dead | CONFIRMED | Only `candidate-ranking.util.spec.ts` imports it. The live imports from that file are the `CandidateScoreBreakdown` type only. |
| 6 | Legacy `evaluateExperiencePreferences` is dead | CONFIRMED | Only specs import it. `findHardExclusionMatches` in the same file is live. |
| 7 | Trace `qualityBonus` carries raw quality | CONFIRMED | `experience-generation.service.ts:499` writes the 0..5 `qualityScore` into a field named for a weighted bonus. `totalScore` is a placeholder. |
| 8 | Accessibility need is not enforced | CONFIRMED, and wider | The wizard's `mobility.accessibilityNeeds` is merged with the interpreter's `accessibilityPreferences` into one `softConstraints.accessibility` list that nothing consumes. The interpreter fallback files "silla de ruedas / wheelchair" (a need) as a preference. The schema has **no canonical accessibility fact**, so every Experience is UNKNOWN today. |

Additional findings (not in the brief):

- **Grounding is a no-op key.** `groundingStrength` is constant 1 for every
  candidate of a facet reservation, so it never orders anything.
- **Soft anchors.** Resolved soft venue anchors are live
  (`resolvedSoftIds`). The spec (§12.3) asks for a "strong deterministic
  anchor boost", but `composeSet` applies it as the **last** key, after
  quality and tilt. The planner ignores it.
- **Soft avoidances and soft constraints are unused.** `exclusions.themes` /
  `exclusions.traits` and the dietary / budget / group soft constraints have
  no live consumer and carry no weight or confidence. The interpreter fallback
  writes "avoid churches" into both `excludedThemes` and `hardExclusions`.
  Vegan → hard `non-vegan food` is the only live soft-to-hard rule.
- **Evidence support is a substring check** (`runs/provenance.json`). The
  interpreter accepts an excerpt when the lower-cased user text *contains*
  it, so `theme:art` with evidence "arte" is accepted from "quiero ir el
  martes al centro".
- **The fallback has its own alias table and matches substrings.** Its
  `candidateKeywords` duplicate entries of `DIMENSION_KEY_SYNONYMS`. It
  triggers on `includes` (the same "martes" → `theme:art`), and it records
  the trigger word, not a user span, as the evidence.
- **The facet vocabulary has no version.** `INITIAL_DIMENSION_VOCABULARY` and
  `DIMENSION_KEY_SYNONYMS` export no version identifier.

## 3. Results

`runs/encoding.json`: 46 independent checks over 27 scenarios.

Every free-text facet in a scenario is labelled DIRECT or INFERRED under the
owner's rule (§4). The mixed-source scenarios are:

- **E1d / E1i.** One wizard pick against four weak free-text facets, which
  are DIRECT in E1d and INFERRED in E1i.
- **E2d / E2i.** One wizard pick against "me encanta la arquitectura y el
  arte" (DIRECT) or "los edificios de Gaudí y el MALBA" (INFERRED).
- **K1.** A weak, low-confidence DIRECT facet against a strong,
  high-confidence INFERRED one.
- **K2.** The same key arriving both DIRECT and INFERRED.
- **K3a / K3b.** Channel neutrality: the same request with the channels
  swapped.
- **K4.** Confidence never discounts DIRECT: a wizard pick against a
  strong DIRECT free-text facet interpreted at confidence 0.6.
- **K5.** Confidence still orders INFERRED evidence.
- **J1–J3.** Soft venue anchors against DIRECT evidence, INFERRED evidence
  and semantic similarity.

| Policy | Pass | Fails |
|---|---|---|
| live planner (additive) | 35/46 | A2, B2, C1, C2, C3, E1i, E2i, K1, K4, J3, I1 |
| live composition remainder | 38/46 | C1, C3 (UNKNOWN = 0); E1i, E2i, K1, K4 (no provenance); J3 (anchor last); I1 |
| E0 count + median | 40/46 | E1i, E2i, E3, K1, K5, J3 |
| E1 Σ weight across sources + median | 41/46 | E1i, E2i, K1 (INFERRED weight outranks DIRECT); K4; J3 |
| E2 channel tiers + median (rejected, Q1) | 40/46 | E1d, E2d, K3a, K4 (channel overrides DIRECT free text); K1; J3 |
| E2 channel tiers + UNKNOWN = 0 / lower tier / 0.5 / tier skip | 33–39/46 | as E2, plus the UNKNOWN failures below |
| P provenance + UNKNOWN = 0 | 43/46 | C1, C3, I1 (missing embedding punished) |
| P provenance + skip the semantic key for a tier with any UNKNOWN | 39/46 | C1, C3, I1: one missing embedding switches off semantic refinement for the whole tier and reorders known peers by quality |
| P provenance over the live dedupe (highest weight wins) | 45/46 | K2: a strong INFERRED duplicate displaces the user's DIRECT statement of the same key |
| P provenance with confidence also discounting DIRECT (rejected, owner decision 2) | 45/46 | K4: a wizard pick outranks an equally strong DIRECT free-text facet only because of interpreter confidence |
| **P provenance + tier-median ordering projection (adopted)** | **46/46** | — |

`unknownIsProjectionOnly` in `runs/encoding.json` shows C1 under the
adopted policy. U is ranked second of four, between known peers, but its
typed assessment stays `semanticAffinity: UNKNOWN`. No cosine is imputed.

A fixed UNKNOWN = 0.5 fails C3: on a low-range cosine model (0.18–0.33) it
ranks U above every known peer, i.e. it rewards U, because the fixed value is
scale-dependent.

Structural results:

- **Pairwise "compare semantics only when both are known" is not an
  order.** A (UNKNOWN, q 3.0), B (0.90, q 2.0) and C (0.20, q 4.0) give the
  cycle A > B > C > A. Sorting with it is undefined.
- **Normalization is irrelevant to ordering within a request.** Ordering by
  matched weight equals ordering by matched ÷ possible weight. The possible
  weight is still emitted, because B needs it to compare preference with
  travel across requests ("one strong facet" vs "five weak facets").
- **A per-candidate order does not determine the routing objective.** Three
  order-preserving prize maps disagree on whether one higher-tier Experience
  is worth more than two lower-tier ones (tie / one / two). Mixed-radix
  encoding with base > pool size is lossless per candidate, but it imposes
  lexicographic **set** semantics and makes every preference digit dominate
  travel. That is precisely the preference-vs-travel exchange rate that B owns.

## 4. Source authority — provenance (owner Q1 and the PROVENANCE-1 rule, 2026-10-14)

Owner decision: the authority boundary follows the **provenance** of a
preference, not the UI channel. A preference the user stated directly in
free text must not rank below a wizard pick merely because an interpreter
extracted it. The intended order of evidence is:

1. direct user preference evidence;
2. inferred / derived preference evidence;
3. soft explicit anchor affinity (§5);
4. semantic refinement;
5. generic quality.

**What the current contract preserves:**

| Step | Carries | Direct vs inferred? |
|---|---|---|
| Wizard pick (`normalizeWizardFacet`) | importance 1.0, confidence 1.0, `source: 'wizard'` | direct by construction: the user selected it |
| Interpreter facet (`PreferenceFacet`) | `strength` (user emphasis) → importance; `confidence` (interpretation certainty); `evidence[]` (verbatim excerpts, validated as substrings of the user's text — unsupported or missing excerpts are rejected); `source: 'free_text'` | **not recorded.** The excerpt proves the facet is grounded in the user's words; it does not say whether the key is the user's own concept ("me encanta la arquitectura" → architecture) or a mapping the interpreter derived ("los edificios de Gaudí" → architecture) |
| Fallback regex facet | the trigger word as evidence (not a user span), confidence 0.9, strength `strong` | not marked; and the trigger is a substring match ("martes" → art), so even "literal" is not guaranteed |
| Normalization trace (`FacetNormalizationDecision`) | `VALID_AS_EMITTED` / `REPAIRED_UNIQUE_VOCABULARY_MATCH` (dimension repair), evidence | trace only; about vocabulary repair, not provenance |
| `RequestedFacet` (in `PreferenceSpec`) | `weight` = importance × confidence, `source` | **evidence, strength and confidence are collapsed or dropped**: the planner-facing contract keeps only the channel |

Confidence is not provenance. A model can be highly confident about an
inference and uncertain about a literal statement, so ranking by confidence
would invent the distinction rather than read it.

Audit result (before the rule): `PreferenceSpec` could not distinguish
direct from inferred evidence for free-text facets. That gap is
PROVENANCE-1. `runs/provenance.json` confirms it on the live interpreter: a
facet from "me encanta la arquitectura" and one from "los edificios de
Gaudí" are identical except for the excerpt, and `RequestedFacet` drops even
that.

**Owner rule (2026-10-14).** A deterministic provenance validator owns the
classification, not the LLM:

1. A wizard-selected facet is DIRECT by construction.
2. A free-text facet is DIRECT only when its quoted user-text evidence maps
   deterministically to the same canonical key, through the versioned facet
   vocabulary or its explicit aliases/synonyms.
3. Otherwise it is INFERRED. That covers any semantic inference,
   generalization, entity knowledge, ontology relation, embedding
   similarity, external knowledge or LLM interpretation beyond that
   mapping.

What the interpreter and the validator each own:

- **The interpreter** emits the key, the excerpt, importance, confidence and
  source.
- **The validator** derives DIRECT | INFERRED.
- An INFERRED facet is still valid and is never rejected for being
  INFERRED.
- Confidence is not provenance.
- Embeddings never certify DIRECT.
- The mapping stays narrow: no ontology growth to make more facets DIRECT.

**Reference implementation on the live vocabulary** (spike only,
`characterization/provenance-rule.characterization.spec.ts`). It uses the
real `INITIAL_DIMENSION_VOCABULARY` and `DIMENSION_KEY_SYNONYMS`. A
free-text facet is DIRECT when one of its excerpts occurs token-bounded in
the user text **and** contains, token-bounded, the canonical key or an alias
of that key in the same dimension. Accents and case are normalized. There is
no stemming and no fuzzy match. Results, all 19 as the rule states:

| Case | Facet | Provenance | Why |
|---|---|---|---|
| "me encanta la arquitectura" | theme:architecture | DIRECT | alias `arquitectura` |
| "quiero arte moderno" | theme:modern_art | — | no `modern_art` key exists, so `canonicalizeFacetKey` rejects it |
| "quiero arte moderno" | theme:art | DIRECT | alias `arte` |
| "quiero arte moderno" | local_character:contemporary | DIRECT | alias `moderno` (alias review item) |
| "quiero ver los edificios de Gaudí" | theme:architecture | INFERRED | no vocabulary term in the excerpt |
| "quiero conocer la ESMA" | theme:history | INFERRED | entity knowledge |
| "quiero conocer la ESMA" | intent:visit | DIRECT | alias `conocer` |
| "quiero ir el martes al centro", excerpt "arte" | theme:art | INFERRED | "arte" only occurs inside "martes" |
| "lo HISTÓRICO" / "vida nocturna" / "a day trip" / "I love architecture" | history / nightlife / day_trip / architecture | DIRECT | accents, multi-word aliases, snake keys, the canonical key itself |
| "obras arquitectónicas" | theme:architecture | INFERRED | inflection without an explicit alias |
| "un día de playa" | theme:beach and nature_type:coast | DIRECT, both | aliases are dimension-scoped |
| "una zona tranquila" | trait:tranquilo | INFERRED | `trait` is an open dimension with no vocabulary to certify against |
| "no me interesa la arquitectura" | theme:architecture | DIRECT | provenance is lexical; polarity is not provenance (residual, §6) |
| excerpt names a different key | theme:history from "la arquitectura" | INFERRED | the alias belongs to another key |

**Does it close PROVENANCE-1? Yes, at the contract level.** The rule is
deterministic and owner-decided, and it is computable from data the
interpreter already produces: key, excerpts and the user text. Three
implementation prerequisites follow from the live code (task 25.4); none is
a decision:

- **Version the vocabulary.** It has no version today. The
  provenance decision records the vocabulary version it was derived under.
- **Token-bounded checks.** Evidence support and the fallback triggers must
  be token-bounded, not substring. The fallback must use the vocabulary's
  aliases instead of its own `candidateKeywords` table (single source).
- **Carry provenance and excerpts through.** `PreferenceFacet` and
  `RequestedFacet` carry `provenance`, with the excerpt and vocabulary
  version as its explanation. Dedupe selects by provenance class first, then
  weight (K2).

## 5. Soft venue anchors (owner Q2, 2026-10-14)

Owner decision: soft venue-anchor affinity is a **separate typed signal**.
It is never merged into facet affinity or treated as a theme, and it may
rank before semantic similarity.

Position relative to facet evidence, from the existing product and spec
semantics:

- **Spec §4 (D3).** A soft venue anchor is a "strong inclusion tilt, not
  guaranteed inclusion". §12.3 calls it a "strong deterministic anchor
  boost". Neither places it above facet coverage.
- **Accepted plan 2026-09-11 (task C2) and the code** order weighted facet
  coverage first. The soft-anchor boost comes after similarity, quality and
  tilt. Required case: "soft venue anchor can be selected because of boost
  but is allowed to lose". No live test exercises a soft anchor.
- **The interpreter** emits `soft` precisely for weak or ambiguous mentions,
  e.g. a place named in passing while describing a theme.

Conclusion: no product or spec source puts a soft anchor above any facet
evidence. It **follows** facet evidence, DIRECT and INFERRED alike, and the
owner's 2026-10-14 hierarchy confirms that position. It precedes semantic
refinement (J3), which resolves the spec ("strong") vs plan/code ("last")
conflict in favour of the spec. That placement is the remaining difference
from the live code. J1 and J2 check that an anchor never outranks DIRECT or
INFERRED evidence.

## 6. Decision — G-P7-U.A RESOLVED (owner, 2026-10-14)

Within one request, after hard eligibility, the eligible Experiences are
ordered lexicographically by:

1. **DIRECT facet evidence.** The Σ of the user's stated **importance** of
   matched DIRECT facets.
   - Interpreter confidence never discounts a facet once deterministic
     validation has established DIRECT.
   - A wizard pick and a DIRECT free-text facet have the same authority
     (K3a / K3b / K4).
   - Importance is the existing `strength` → importance mapping (strong /
     medium / weak). It is a separate notion from confidence and is
     preserved as is. Nothing new is introduced.
2. **INFERRED facet evidence.** The Σ of importance × confidence over
   matched INFERRED facets, where confidence stays meaningful (K5). It is
   never added to DIRECT.
3. **Soft venue-anchor affinity.** A separate typed signal, never a facet
   match.
4. **Semantic similarity.** The typed assessment is `KNOWN{similarity}` or
   `UNKNOWN{reason}`.
   - For deterministic ordering only, an UNKNOWN candidate occupies the
     median position of the known similarities in the same higher-priority
     tier (1–3). With no known peer, the key is skipped for that tier.
   - This is an ordering projection, not semantic evidence. UNKNOWN is
     never converted to 0, and never stored or reported as the median
     cosine.
   - Known peers keep their relative order. UNKNOWN is neither
     systematically rewarded nor penalized (C1, C3, I1).
   - Its request-relative rank may change when the cohort changes; that is
     accepted.
5. **Generic quality.** `KNOWN | UNKNOWN`, with the same projection. It is
   labelled generic, not preference.
6. **Experience id**, as the deterministic tie-break.

Other parts of the decision:

- **Dedupe.** One facet per (dimension, key). The highest provenance class
  wins, then the highest weight within that class. An INFERRED duplicate
  never displaces a DIRECT one, and never lends it weight (K2).
- **No new number.** No coefficient, threshold or exchange rate between
  levels.
- **Boundary.** As in §7: a structured assessment, with the scalar prize
  deferred to part B.

**Polarity gap (POLARITY-1, task 25.6).** Provenance is lexical:
"no me interesa la arquitectura" contains an architecture alias.

- A negated mention must not become a positive facet, not even a weaker
  one. Confidence is not a proxy for polarity or negation.
- Today, polarity rests only on the LLM's choice between `preferredFacets`
  and `excludedThemes`. No deterministic check confirms that a positive
  facet's excerpt is not negated. The fallback recognizes negation only
  for the religion pattern.
- Positive/negative polarity must be established before DIRECT facet
  evidence participates in preference utility. How it is established is
  task 25.6 and is not decided here.

**Residuals.** These are recorded and do not block A:

- **Open dimension.** `trait` facets are always INFERRED: that dimension
  has no vocabulary to certify against.
- **Alias quality is now authority.** Aliases such as `moderno` →
  local_character:contemporary and `familiar` → winery_scale:boutique
  decide DIRECT. They are reviewed when the vocabulary is versioned (25.4).

## 7. Owner and planner boundary

**Owner.** One dedicated preference-utility derivation responsibility runs
once per composition snapshot, after eligibility and before composition.

- It reuses `isStrongFacetMatch` as the only facet-truth primitive.
- It owns the single semantic-similarity batch, which moves out of the
  composition service.

**Consumers**, none of which recombines the signals:

- Composition orders reservation candidates, remainder fill and the
  reservoir. Its set-level policies stay its own.
- Facet retrieval and sufficiency keep using the matcher for coverage.
- The planner normalizer copies the assessment.
- The trace renders it.

**Planner boundary.**

- The planning candidate carries a typed preference assessment:
  - explicit facet evidence with provenance, and matched/requested weights;
  - soft-anchor affinity;
  - semantic `KNOWN{similarity} | UNKNOWN{reason}`;
  - generic quality `KNOWN | UNKNOWN`;
  - the policy version and a within-request preference rank.

  These replace the untyped `semanticScore` / `preferenceWeight`.
- The optimizer request carries no preference structure. Its per-candidate
  prize is projected from the assessment by the versioned objective policy,
  which part B decides. The adapter only performs the integer conversion.
- Scalarization is deferred, because a per-candidate order does not
  determine the additive set objective (§3).

## 8. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Additive weighted sum (live planner; `0.6/0.3/0.1`-style blends) | Not monotone in explicit evidence; quality crosses semantic (A2, B2, E1); needs unevidenced coefficients. |
| UI-channel tier (wizard before free text) | Owner Q1: authority follows provenance, not channel (fails E1d, E2d, K3a). |
| Σ weight across provenance classes (E1) | Lets INFERRED weight outrank a DIRECT statement (E1i, E2i, K1). |
| Confidence discounting DIRECT evidence | Owner decision 2: deterministic validation establishes DIRECT, so the channel and interpreter confidence do not change authority (K4). |
| Imputing or storing the median as the UNKNOWN similarity | Owner decision 1: the median is an ordering projection only. |
| Live max-weight dedupe | A strong INFERRED duplicate displaces the DIRECT statement of the same key (K2). |
| LLM-asserted provenance | Owner rule: the deterministic validator owns DIRECT / INFERRED. |
| Embedding similarity or stemming to certify DIRECT | Owner rule: the mapping is the versioned vocabulary and its explicit aliases only. |
| Facet count (E0) | Ignores the canonical weights (E3). |
| UNKNOWN = 0 or lower tier | Punishes enrichment lag as irrelevance (C1, C3, I1, live `composeSet`). |
| UNKNOWN = constant 0.5 | Scale-dependent; rewards UNKNOWN on low-range cosine models (C3). |
| Skip semantics when either side is UNKNOWN (pairwise) | Not transitive (cycle). |
| Skip semantics for a tier containing an UNKNOWN | Reorders known peers (C1, C3). |
| A scalar prize in A | Not determined by the order; the cardinal values are part B. |
| Confidence as a provenance proxy | Interpretation certainty is not provenance. |
