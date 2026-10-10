# Experience Identity / Dedupe — Postgres Integration Gate before B6

Status: **required verification gate; planned, not implemented.**
Written: 2026-09-12.
Branch: `feat/preference-first-selection`.

Related:
- `docs/superpowers/specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md`
- `docs/superpowers/specs/2026-09-12-living-tourism-knowledge-base-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`

---

## 1. Gate

**Do not start B6 until this gate is green against real Postgres.**

B6 changes extraction authority and therefore increases the importance of the canonical identity boundary. Before changing what candidates carry, the existing persistence/dedupe path must prove that it can safely distinguish:

```text
Case 1: SAME
Case 2: NEW
Case 3: AMBIGUOUS
```

for realistic multi-component tourism Experiences.

Mocks/unit tests remain useful for the pure scoring primitive, but they are not sufficient for this gate. The gate must exercise the real Prisma/Postgres persistence path, component relations, evidence rows, transaction/advisory-lock path and canonical re-read.

Recommended test file:

`be/test/integration/tour-generation/experience-identity-dedupe.integration-spec.ts`

Use the existing integration-test database conventions and real `ExperienceCatalogService`. External network providers are not required for this identity gate; seed resolved `GeoEntity` rows directly through the real catalog/persistence boundary.

---

## 2. Why Postgres is mandatory

The production identity behavior does not stop at `decideExperienceDedupe()`.

`ExperienceCatalogService.persistVerifiedExperience()`:
- acquires identity advisory locks;
- loads real existing Experiences by canonical name / component overlap;
- constructs fingerprints from persisted components/evidence/metadata;
- calls `decideExperienceDedupe()`;
- for `SAME`, enriches the existing row/evidence/metadata;
- for `NEW`, creates a new Experience + component/evidence relations;
- for `AMBIGUOUS`, does not create or mutate a canonical Experience.

The resolver additionally converts `AMBIGUOUS` into an `AMBIGUOUS_DEDUPE` rejection.

The required semantics must therefore be tested where these pieces meet, not only against an in-memory fingerprint fixture.

---

## 3. Shared San Telmo fixture

Create real GeoEntities in the integration DB, with stable test coordinates and real distinct IDs, for example:

```text
AREA / context if needed:
San Telmo

PLACE components:
Plaza Dorrego
Mercado de San Telmo
Pasaje Defensa
El Zanjón de Granados
Parque Lezama
Casa Mínima
Immigration / conventillo fixture
Architecture fixture
```

The exact coordinates need only be deterministic and geographically coherent for these identity tests. These tests are about canonical Experience identity, not provider lookup.

Persist Experiences through the real `ExperienceCatalogService.persistVerifiedExperience()` contract with normal components/evidence/metadata.

Themes/intents may deliberately be identical across different Experiences to prove that classification equality does not define identity.

---

## 4. Case 1 — SAME converges to one canonical Experience

### Observation A

```text
canonicalName: San Telmo Historical Walking Tour
metadata:
  themes: [history]
  intents: [walk]
components:
  Plaza Dorrego
  Mercado de San Telmo
  Pasaje Defensa
  El Zanjón de Granados
evidence:
  source-A
```

Persist A.

Expected:

```text
dedupeDecision = NEW
Experience count = 1
```

### Observation B

A second source describes the same real Experience with equivalent structure and sufficiently consistent identity, for example the same role-aware component set and compatible name/semantics:

```text
canonicalName: Historical Walk through San Telmo
metadata:
  themes: [history]
  intents: [walk]
components:
  same canonical GeoEntity ids as A
evidence:
  source-B
```

Persist B.

Expected:

```text
dedupeDecision = SAME
returned canonical id = A.id
Experience count remains 1
```

Re-read from Postgres and assert:
- exactly one canonical Experience exists for these observations;
- evidence contains both source-A and source-B exactly once;
- component relations were not duplicated;
- semantic metadata did not regress because of provider order;
- no duplicate Experience row exists.

### Case 1b — repeated observation is idempotent

Persist B again.

Expected:
- SAME;
- Experience count still 1;
- evidence row count/set does not duplicate identical evidence;
- components remain unique.

### Case 1c — input/provider order invariance

In an isolated DB fixture/run, apply equivalent observations in reverse order.

Expected invariant:
- one canonical identity, not two;
- same final evidence set;
- equivalent merged semantic metadata;
- same SAME/NEW convergence behavior modulo generated database ids and any explicitly first-seen canonical-name policy.

Do not require generated UUID equality between isolated runs.

---

## 5. Case 2 — NEW preserves multiple real Experiences with the same facets

Seed/persist two evidence-backed distinct walks in San Telmo.

### Walk A — Colonial / Historical Walk

```text
themes: [history]
intents: [walk]
components:
  Plaza Dorrego
  Mercado de San Telmo
  Pasaje Defensa
  El Zanjón de Granados
```

### Walk B — Immigration History Walk

```text
themes: [history]
intents: [walk]
components:
  Mercado de San Telmo
  Immigration / conventillo fixture
  Casa Mínima
  Parque Lezama
```

Both intentionally share:
- destination;
- AREA/scope;
- `intent:walk`;
- `theme:history`;
- at least one real component.

But evidence/structure establish two different real Experiences.

Expected:

```text
A => NEW
B => NEW
Experience count = 2
A.id != B.id
```

Re-read from Postgres and assert:
- both canonical rows survive;
- each retains its own component set/evidence;
- neither silently absorbs the other;
- matching facets are allowed to be identical;
- retrieving history/walk candidates can return both.

This test is deliberately capable of exposing an over-aggressive dedupe rule. If the current algorithm returns `AMBIGUOUS` or `SAME` for a fixture that clearly represents two evidence-backed real Experiences, fix the identity policy before B6 rather than weakening this test.

### Case 2b — same name/theme is still not sufficient identity

Add a controlled fixture where two independently evidenced walks use the same or near-identical display title but have clearly distinct structural composition/source identity.

Expected: they must not become SAME merely because name/theme match.

If current data does not provide enough evidence to establish NEW safely, the acceptable result is AMBIGUOUS — never forced SAME. The test fixture used for the mandatory NEW assertion must contain enough independent identity evidence to justify NEW.

---

## 6. Case 3 — AMBIGUOUS does not corrupt the catalog

Seed existing Walk A:

```text
Plaza Dorrego
Mercado
Pasaje Defensa
El Zanjón
```

Then submit an incoming candidate with conflicting/incomplete identity evidence, e.g. substantial overlap but a structurally meaningful difference:

```text
Plaza Dorrego
Mercado
Pasaje Defensa
Parque Lezama
```

Tune the fixture using the real current thresholds so that the pure decision is genuinely `AMBIGUOUS`, not by mocking the decision.

Expected from `persistVerifiedExperience()`:

```text
dedupeDecision = AMBIGUOUS
```

Then assert against Postgres:
- Experience count is unchanged;
- no new Experience row was created for the ambiguous incoming observation;
- existing canonical Experience components were not mutated by the ambiguous observation;
- existing evidence/metadata were not silently merged from the ambiguous observation;
- returned dedupe candidates/evidence identify why the decision was ambiguous.

### Case 3b — resolver behavior

Through the real resolver/materialization boundary (external OSM/Places transports may be mocked, persistence real), prove that an `AMBIGUOUS` catalog decision becomes:

```text
status = rejected
rejectionReasons includes AMBIGUOUS_DEDUPE
```

and still creates no new canonical Experience.

---

## 7. Facets must not become identity keys

Add a direct regression matrix around Cases 1/2:

```text
same area + same theme + same intent + distinct real structure => may be NEW
same area + different theme + same real structure/evidence => may be SAME
```

The exact decision still depends on the complete identity evidence, but these tests must prove that classification fields alone cannot dictate identity.

User preferences must not appear anywhere in the dedupe input.

---

## 8. Component overlap boundaries

Add focused real-DB cases around overlap:

1. **100% role-aware component identity + compatible real name/evidence** → SAME.
2. **partial overlap + clearly distinct structure/evidence** → NEW when evidence is strong enough.
3. **partial/high overlap + insufficient/conflicting evidence** → AMBIGUOUS.

No test may encode a rule like `N% overlap => SAME` as the sole authority.

---

## 9. Persistence assertions required in every case

After each operation, query the real DB again rather than trusting only the returned object.

Assert as appropriate:
- Experience row count;
- canonical ids;
- `experience_component` membership and uniqueness;
- roles / required flags where relevant;
- evidence set and deduplication;
- metadata / classification preservation;
- no mutation on AMBIGUOUS;
- no hidden duplicate canonical row.

Transactions must commit and the final assertions must observe committed state.

---

## 10. What this gate does NOT test

This is not yet the living-knowledge enrichment implementation.

In particular, do not expand this gate to require SAME observations to automatically add newly discovered components to an existing Experience unless/until that merge policy is separately designed. The current SAME path enriches evidence/metadata but component-set evolution needs its own explicit policy because blindly unioning stops can corrupt route identity.

Also out of scope here:
- proactive refresh scheduler;
- observation TTL/freshness;
- ExperienceFamily;
- itinerary redundancy scoring;
- B6 extraction changes;
- live external provider calls.

---

## 11. Exit criteria before B6

B6 is unblocked only when all of the following are true:

- [ ] Case 1 SAME integration test is green on real Postgres.
- [ ] SAME is idempotent under repeated observation.
- [ ] SAME convergence is provider/input-order independent for identity outcome/evidence/metadata.
- [ ] Case 2 proves two distinct San Telmo walks with the same `history + walk` facets survive as separate canonical Experiences.
- [ ] Classification/facet equality alone cannot collapse identity.
- [ ] Case 3 AMBIGUOUS creates no new row and mutates no canonical row.
- [ ] Resolver surfaces `AMBIGUOUS_DEDUPE` without persistence corruption.
- [ ] Component/evidence assertions are verified by Postgres re-read, not mocks.
- [ ] Full existing integration suite remains green.
- [ ] Full backend regression remains green.

If any mandatory fixture that should be NEW is classified SAME/AMBIGUOUS, or any AMBIGUOUS observation mutates canonical state, stop and repair identity/dedupe before starting B6.

---

## 12. Suggested verification sequence

```text
1. Add RED integration tests for SAME / NEW / AMBIGUOUS.
2. Run only experience-identity-dedupe.integration-spec.ts.
3. Inspect failures against the real persisted fingerprints/decisions.
4. Make the smallest identity/dedupe fix required; do not weaken fixtures to fit the implementation.
5. GREEN the identity gate.
6. Run full tour-generation integration suite.
7. Run full backend suite.
8. Record exact counts/results in progress documentation.
9. Only then start B6.
```
