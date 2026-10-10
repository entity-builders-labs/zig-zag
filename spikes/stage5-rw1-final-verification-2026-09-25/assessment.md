# Stage 5 — Trace + RW1 final verification: assessment (2026-09-25)

Branch `feat/preference-first-selection`. Starting HEAD `94e9cb1`
(verified equal to the fork remote before any change). Code under test:
`576bbe5` (COLD 1, WARM, COLD 2, COLD 3) and `3097641` (COLD 4). Numbers
and tables: `summary.md`; per-candidate rows: `matrix.json`.

Two levels are kept apart throughout:

- **deterministic backend decision** — what identity/geography/admission/
  persistence did with a given candidate (same input → same decision);
- **nondeterministic extraction/provider result** — which candidates the
  extractor emitted and which provider answers came back.

## 1. Trace fidelity (hard gate)

Changes (`576bbe5`, `3097641`, `d38d4be`), all observability — no identity,
geography, admission, dedupe or schema change:

| Distinction | Typed name in the trace | Before Stage 5 |
| --- | --- | --- |
| nothing acquired | deficit `NO_CANDIDATE_ACQUIRED` | same |
| provider failed, nothing acquired | deficit `PROVIDER_FAILURE` / `OPERATIONAL_FAILURE`; hint + candidate reason `PROVIDER_FAILURE` | deficit right, but hint/candidate summary said **`NO_OSM_MATCH`** (fixed; RED test first) |
| acquired, not corroborated | `CANDIDATE_UNCONFIRMED` | same |
| acquired, contradicted (IdentityVerifier REJECTED every acquired candidate) | **`CANDIDATE_REJECTED`** | merged into UNCONFIRMED |
| ambiguous | `AMBIGUOUS` / `AMBIGUOUS_CANDIDATES` / `KNOWLEDGE_DEFICIT`, attempts keep the MULTIPLE evidence, no winner | same; candidate summary could mask it behind UNCONFIRMED (fixed) |
| identity conflict | `CONFLICTED` / `IDENTITY_CONFLICT` | candidate summary could say NO_OSM_MATCH (fixed) |
| resolved, outside | `RESOLVED` + `OUTSIDE` (+ distance), no deficit | same |
| resolved, geography unknown | `RESOLVED` + `UNDETERMINED` | same |
| incomplete source composition | candidate `INCOMPLETE_SOURCE_COMPOSITION`; composite outcome `NOT_EVALUATED` / `NOT_PERSISTED` / not planner-eligible; every missing component named with its deficit in the summary | coverage numbers only, components not in the summary |
| extractor output not understood | `extractor_envelope_unrecognized: top-level …` | silently `[]` (indistinguishable from an empty answer) |
| dedupe fail-closed | composite outcome `NOT_PERSISTED` + `dedupe.conflictingExperienceIds` + recorded signals | reason code only |

A candidate with no resolved component now lists **every component's
distinct reason** in source order; `NO_OSM_MATCH` is never the only word
when a component ended with something more specific.

Per component the trace carries: hint + evidence keys, expected role/kind,
every attempt (strategy, provider, query, outcome, selected identity,
evidence incl. convergence/multiplicity, verdict), identity status,
GeoEntity id + kind + canonical geometry, relation (or none when not
resolved), deficit reason + classification. Per composite: coverage
(total / identity-resolved / geo-accepted / unresolved / ambiguous /
conflicted / ratio / completeness / open research deficits), composite
geographic decision, persistence, planner eligibility. Bounded: no raw
provider payloads, no geometry repeated, no source documents.

Deterministic proof: `trace-failure-semantics.spec.ts` (15 tests: every
terminal state distinct, partial A-B-C-D-E-F-G keeps C/E/… named, ambiguous
keeps multiplicity without a winner, outside ≠ unresolved, timeout =
OPERATIONAL_FAILURE, partial composite never evaluated/persisted/eligible,
dedupe conflict explained); aggregation mutation-checked; extraction spec
envelope cases. **False `NO_OSM_MATCH` regression:** Case H (acquired then
unconfirmed → `UNCONFIRMED_MATCH`, now also `AMBIGUOUS` for Pasaje) plus the
new provider-failure case.

Live: the bitácora answered every question in §3 below from
`generation-trace.json` alone.

**Status: PASS.**

## 2. RW1 runs — OBSERVED

3 COLD + 1 WARM as budgeted, plus one targeted COLD 4 control after the
envelope fix (§4). All completed.

- **Extractor variance (nondeterministic):** web composites extracted:
  COLD 1 = 1 (2 hints), COLD 2 = 0, COLD 3 = 0, COLD 4 = 1 (2 hints) —
  across 9 web extraction passes over walk-tour evidence, 2 produced a
  candidate. COLD 4 proves a zero-candidate pass was a genuine empty model
  answer (no envelope note). Previous samples of the same request: Stage 3
  E2E 7 hints, Stage 4 3 and 2 hints.
- **Backend decisions (deterministic):** every emitted component was
  processed the same way in every run: the same hints ended with the same
  canonical OSM identity (El Zanjón, Solar French, Plaza Dorrego, Parque
  Lezama, Mercado, Carnavales de la Calle Defensa …) and the same
  unresolved set ended `NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION`.
  COLD 2/3 differ from COLD 1/4 only in what the extractor emitted.

## 3. Required RW1 questions

| Question | Answer (observed) |
| --- | --- |
| Source-backed composites extracted | 2 (COLD 1, COLD 4); 0 in COLD 2/3 |
| Component sets | {Lezama Park, Plaza Dorrego}; {Plaza Dorrego, El Mercado de San Telmo} |
| Resolved | 2/2 and 2/2 |
| Unresolved / ambiguous in composites | none / none |
| Relations | all INSIDE (VALIDATION_AREA San Telmo) |
| Reached CompositeGeographicValidation | both |
| Accepted / rejected by CGV | both ACCEPTED (`component_defined`) |
| Persisted | COLD 1 yes (NEW, exactly 2 components); COLD 4 **no — AMBIGUOUS_DEDUPE** (§5) |
| Partial composite attempted to persist | no (none extracted) |
| Partial state reached planner | no; real planner boundaries return exactly the PERSISTED outcomes |
| Component promoted to standalone Experience | no: COLD 1 persisted the composite and no Lezama Experience appeared; standalone Plaza Dorrego / Mercado Experiences come from their own structured Places observations |

## 4. NOT OBSERVED live (proof stays deterministic)

| Behavior | Live | Deterministic proof |
| --- | --- | --- |
| Partial composite (resolved + unresolved components) | not observed in 4 COLDs | Stage 4 `partial-composite-isolation.integration-spec.ts` (real Postgres, mutation-checked) + `trace-failure-semantics.spec.ts` |
| AMBIGUOUS / CONFLICTED / provider-failed component | not observed | Stage 4 facts/policy specs + this stage's trace spec |
| OUTSIDE / INTERSECTS / UNDETERMINED relation | not observed | Stage 4 policy relation matrix |
| Plaza de Mayo acquisition + relation | never emitted as a hint (evidence text only) | Stage 1/4 design fixture only |
| Calle Defensa as ROUTE (Line/MultiLineString → INTERSECTS) | never a ROUTE hint; only the PLACE "Carnavales de la Calle Defensa" | Stage 4 MultiLineString fixtures |
| POINT_RADIUS scope | not exercised (AREA destination) | Stage 4 |
| MultiLineString route reaching the planner | no ROUTE GeoEntity created | — (debt stays) |
| Genuine KNOWLEDGE_DEFICIT | none: every live deficit is `NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION` | — |

## 5. Historical finding — Experience dedupe blocked 2-stop composites (fixed post-milestone; live re-confirmation attempted 2026-09-25 and inconclusive)

Observed live under the Stage 5 code and reproduced deterministically:

- COLD 1: composite {Lezama, Plaza Dorrego} persisted first → the
  independently sourced single-venue "Plaza Dorrego" →
  `AMBIGUOUS_DEDUPE`.
- COLD 4: single-venue Plaza Dorrego and Mercado persisted first → the
  complete, CGV-accepted composite {Plaza Dorrego, Mercado} →
  `AMBIGUOUS_DEDUPE`, never planner-visible.

Historical cause: `setOverlap` divides by the larger set, so single {A} vs
composite {A,B} scores `componentOverlap = 0.5`; the old ambiguity gate let
that structural membership signal fail-close the second Experience. A 3-stop
composite scored 1/3, exposing the cardinality/order artifact. This contradicted
the canonical rule that a standalone and composite may legitimately share the
same GeoEntity.

Stage 5 intentionally did **not** change that identity policy inline. The
separate correction landed post-milestone in
`d6f060344073eba101f16ee8ebc1a798a9aed378`
(`fix(tours): separate membership from experience identity`), after
regressions were added in
`a690714b0e7f45af11f763d6b2426c981c21bdd0`.

The fix is policy-scoped rather than a threshold adjustment:
- `setOverlap` and the SAME rules are unchanged;
- standalone-vs-composite is detected from **distinct GeoEntity count**;
- shared component / role-aware overlap alone has no SAME/AMBIGUOUS authority
  for that shape;
- name/semantic identity evidence can still make the pair AMBIGUOUS;
- composite-vs-composite partial-overlap behavior is preserved;
- ambiguous evidence is reported from the candidate that actually triggered
  ambiguity;
- trace evidence includes `standalone_composite_shared_membership`.

Deterministic validation on `d6f0603`:
- `experience-dedupe.util.spec.ts`: **10/10**;
- Gate 1 `experience-identity-dedupe.integration-spec.ts` on
  `zigzag_test`: **19/19**;
- full unit suite: **2045/2046**, with only the existing
  `preference-first-architecture` baseline red.

Therefore the defect is **fixed deterministically**. The original COLD 1/COLD 4
rows above remain historical Stage 5 observations; they have not been rewritten
as if the run happened under new code. A post-`d6f0603` live COLD
re-confirmation was attempted on 2026-09-25 (three fresh databases) and was
**inconclusive** — no standalone/composite shared-membership pair was emitted
(web extraction failed with Groq 429 OTPM in two runs; the third grounded
successfully but extracted zero candidates). See
`spikes/post-dedupe-live-confirmation-2026-09-25/`. Live confirmation that both
legitimate Experiences now persist therefore remains pending.

## 6. El Zanjón / Plaza de Mayo / Calle Defensa / Solar de French

See `summary.md` "Named cases". El Zanjón identity stable (`osm:node:9953027884`,
two independent convergence paths, WARM verified-hint reuse, corroboration
unchanged). Solar de French: canonical reuse stable within these runs
(`osm:node:6903962986`); the node vs Stage 3 `osm:relation:9314953`
divergence remains explicit — different hint texts and strategies, nothing
merged by proximity. Plaza de Mayo / Calle Defensa ROUTE: not exercised.
Mafalda / Farmacia / Recoleta: not emitted; no verified-hint noise observed
(0 duplicate hint keys within a kind in any DB).

## 7. WARM (COLD 1 DB, new process)

- 4/4 resolved components via `CATALOG_REUSE` only, onto the same
  GeoEntity ids as COLD 1 (El Zanjón via `CATALOG_VERIFIED_HINT_MATCH`).
- Same Experience ids (`SAME` dedupe) for Mercado San Telmo and Museo
  Histórico Nacional; counts unchanged (13 / 17 / 13 / 11 / 12); 0 duplicate
  identities or Experience names.
- Identity calls: Geoapify search/details 10 → 0, Wikidata 13 → 0,
  Wikipedia en 5 → 0; remaining Nominatim 1 / Overpass 2 = destination
  resolution + one POI pool for 3 hints unresolved in COLD too (failures
  are not remembered — Stage 3 debt). Latency 338 s → 65 s.
- The WARM candidate set differs from COLD 1 (7 vs 29 rows): extractor/
  acquisition-plan variance, and WARM's preference interpretation degraded
  on a Groq 429 (operational). Not catalog instability: every hint seen in
  both runs mapped to the same GeoEntity.

## 8. NEAR / ratio / minimum distributions

- OUTSIDE distances: **none observed** (every resolved component INSIDE).
- Resolution ratios among composites: 2/2, 2/2. Among all rows: 1/1 or 0/1.
- Composite sizes: 2, 2 (plus earlier stages: 7 → 5/7, 3, 2).

## 9. THRESHOLD DECISIONS

| Threshold | Decision |
| --- | --- |
| NEAR distance to AREA boundary | **NOT SELECTED — insufficient evidence** (0 OUTSIDE components live; only the design fixture exists) |
| Partial-resolution ratio | **NOT SELECTED — insufficient evidence** (no partial composite live; admission remains full source composition) |
| Minimum component count | **NOT SELECTED — insufficient evidence** (2 composites, both 2 stops; the dedupe finding shows 2-stop composites are real) |

## 10. Debt (carried / new)

- RESOLVED POST-MILESTONE: Experience dedupe single-vs-2-stop composite (§5)
  — fixed by `d6f0603`; deterministic validation green; bounded live
  re-confirmation attempted 2026-09-25 and inconclusive (extraction variance),
  so live re-confirmation remains pending.
- NEW: extraction yield is low on walk evidence (2/9 passes); extractor/prompt
  work is out of scope here, and nothing was steered.
- NEW: failed identity resolutions are re-attempted every run (WARM re-queried
  the OSM pool for 3 known-unresolved hints).
- Carried: POINT_RADIUS relation for ROUTE/AREA = UNDETERMINED (not hit live);
  MultiLineString planner footprint falls back to a point (no ROUTE live);
  `required` columns (no migration); San Martín hardening; `catalog-reuse`
  flake; `representativePoint` first polygon; anchor `nominatim` namespace.
- Observed, outside milestone: Geoapify routing = 124 requests per run in
  COLD 1/WARM, 30 elsewhere (planner travel times).

## 11. STOP conditions

None triggered during Stage 5: no new lifecycle schema, identity authority,
geography engine, provider fallback, taxonomy or persistence model was needed.
The dedupe finding correctly remained reported rather than being folded into
Stage 5. Its later resolution in `d6f0603` is a separate post-milestone
policy correction and does not reopen or rewrite the completed Stage 5 run.
