# HISTORICAL PRODUCT CALIBRATION — NOT A CANONICAL PR #71 REVIEW

- Reviewed product SHA: `15af1ccb641122d633de4c5f1fd853d963ba0a18`
- Reviewed commit: docs(rw4): record IdentityVerifier evidence characterization
- Baseline SHA: `1842004715930ea2cc2f27aed0ff483d90888ec7`
- Baseline commit: style(overture): apply prettier to snapshot index files
- Declared range: `1842004715930ea2cc2f27aed0ff483d90888ec7..15af1ccb641122d633de4c5f1fd853d963ba0a18`
- Commits in range: 2
- Track reviewed against: `preference-first-selection`
- Model: `openrouter/qwen/qwen3.8-27b:free`
- Checkout mode: isolated `git archive` export; no branch, worktree,
  index, or PR state was created or modified

## Reviewer result

- `code_review_verdict`: **CHANGES_REQUIRED**
- `architecture_verdict`: **ARCHITECTURE_DRIFT_WARNING**
- Findings emitted: 3
- JSON schema valid: false
- Evidence sufficiency gate passed: true
- Finding paths absent from the reviewed checkout: 0
- Observed repository read tool calls: 20
- Reviewed checkout unchanged: true

### Why the canonical schema did not validate here

This is a property of the calibration, not of the reviewer. The canonical
schema requires `pr_number` and `base_branch`, which only exist for a live
pull request. A declared historical range is deliberately not bound to a PR,
so those runtime facts are not supplied and the model cannot emit them.
Conversely, the runtime facts supplied here include `baseline` and `range`,
which the model copied into the object and which `additionalProperties: false`
rejects. In the live pipeline the runtime facts carry exactly the canonical
fields, so this specific mismatch does not arise. The live pipeline would
have refused to publish this output, which is the correct fail-closed
behaviour and is itself evidence that the schema guard works.

```text
/private/var/folders/jk/p3vccfhd5kl72hw05lhgx5rh0000gn/T/opencode/calib-identityverifier/review.json invalid
[
  {
    instancePath: '',
    schemaPath: '#/required',
    keyword: 'required',
    params: { missingProperty: 'pr_number' },
    message: "must have required property 'pr_number'"
  }
]
```


## Tool-call evidence

```text
checkout_unchanged=true
inspect_exit=0
tool_calls<<EOF
  24 grep
  24 read
EOF
observed_read_paths=20
normalize_exit=0
schema_valid=false
verdict=CHANGES_REQUIRED
architecture_verdict=ARCHITECTURE_DRIFT_WARNING
finding_count=3
evidence_gate_passed=true
finding_paths_missing=0
```

## Findings

- [MEDIUM] F1: EXACT_NAME/UNKNOWN multiplicity + corroborating NEARBY still VERIFIES
  File: `be/src/modules/tours/services/identity-verifier.service.ts`:103-109
  Reason: Pre-existing (the old code verified on any corroborated match), but directly exposed by this delta: Overture partial snapshots are the only production source of exactName=UNKNOWN (overture-places-index.service.ts:211-216), and the delta's own rationale (L95-102; identity-evidence-collector.service.ts:64-68) establishes that NEARBY is centered on the selected candidate and cannot decide which same-named facility the source meant. The same argument applies to uniqueness: a Wikidata item within 200m of the candidate cannot rule out another same-named facility outside the non-exhaustive AOI. A false VERIFIED here would persist a GeoEntity plus hint memory on the strength of a single record in a non-exhaustive dataset — the mirror image of the Ojo de Agua failure this delta fixes. Not demonstrated live (no matching item near the fixtures in either replay). The delta's comment "It can confirm a unique candidate" (L97) is inaccurate for UNKNOWN multiplicity, and no test pins this shape either way.
  Required fix: Either extend the disambiguation guard so that a NEARBY corroboration cannot VERIFY when an EXACT_NAME/DECLARED_ALIAS evidence of multiplicity UNKNOWN is present (treat unproven uniqueness like a collision for NEARBY-driven verification only), or deliberately document the retained semantics in the 2026-09-22 amendment / verifier header and pin it with a test. Record the decision in the open-findings section of the progress doc.

- [LOW] F2: committed evidence not reproducible under its own harness filenames (run.sh + live-spec outDir)
  File: `spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/run.sh`:24-27
  Reason: run.sh and the live spec write `resolver-replay.json` and `db-after-probe.json`, while the committed evidence is `resolver-replay.pre-fix.json`/`.post-fix.json` and `db-after-probe.pre-fix.json`/`.post-fix.json`; the pre/post distinction (verifier at f3910172 vs post-fix) is not encoded in run.sh. A reviewer re-running the committed harness cannot regenerate the committed artifact names. Diagnostic-only, not a gate. The second affected location is the outDir of be/test/live/rw4-identity-verifier-characterization.live-spec.ts.
  Required fix: Have the harness name outputs with build provenance (e.g. include the HEAD/BUILD_COMMIT in the filename or copy to the .pre-fix/.post-fix names in run.sh), so committed evidence is regenerable.

- [LOW] F3: non-null assertion on destination.countryCode
  File: `be/test/live/rw4-identity-verifier-characterization.live-spec.ts`:145-146
  Reason: resolveDestination degrades to point-scale on provider failure (destination-resolution.service.ts:99-104, "never throws"); in that case countryCode is undefined and `destination.countryCode!` would crash the diagnostic probe instead of recording the failure. Diagnostic-only.
  Required fix: Fail the probe with a recorded error when destination.countryCode is undefined (or when scale !== 'area', which the spec already checks for `scale` but not for countryCode).


## Reviewer verification summary (verbatim)

Read-only inspection only; no commands were executed. No unit tests, integration tests (require disposable Postgres), e2e, the live probe (require docker containers zigzag-postgres, Nominatim, Overpass, Geoapify, live Wikidata), typecheck, lint, or Git range verification were run; no CI evidence section was present in the input, so the CI state of head 15af1ccb641122d633de4c5f1fd853d963ba0a18 is unknown, and all test/CI results cited in the progress document are author-reported and unverified here. The incremental baseline is 1842004715930ea2cc2f27aed0ff483d90888ec7 (range 1842004715930ea2cc2f27aed0ff483d90888ec7..15af1ccb641122d633de4c5f1fd853d963ba0a18). Coverage limitation: the following remain unverified and are recorded as open work, correctly not attempted in this delta — the EXACT_NAME/SINGLE-vs-contradiction gap (RW4-ID-CONTRADICTION-1), QID homonym false-positive risk (RW4-ID-QID-HOMONYM-1), the UNKNOWN-multiplicity + corroborating-NEARBY VERIFIED hole (F1, neither fixed nor recorded), the repo-owned Overture COMPLETE_COUNTRY importer, Bodega Azul evidence acquisition (declared alias or component-bound fact), A16 coverage, COLD #12 and WARM reuse, and the e2e flake (RW4-E2E-FLAKE-1). The inspector read all 11 changed files on disk plus the canonical contracts they depend on, so this is a full read of the incremental range; the verdict rests on static analysis, not executed suites.


## Canonical context actually assembled

Assembled by `scripts/agent-review-context` from the historical snapshot at
`15af1ccb641122d633de4c5f1fd853d963ba0a18`, resolving its canonical roadmap from that snapshot's own authority
index. North Star section: ## 3. NORTH STAR / canonical convergence roadmap (docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md)

## Files inspected by the reviewer (as declared by the reviewer)

```text
.review-input/context.md
.review-input/input.md
be/src/modules/tours/services/identity-verifier.service.ts
be/src/modules/tours/services/identity-verifier.service.spec.ts
be/src/modules/tours/interfaces/experience-resolution.interface.ts
be/src/modules/tours/services/experience-proposal-resolver.service.ts
be/src/modules/tours/services/experience-proposal-resolver.service.spec.ts
be/src/modules/tours/services/identity-evidence-collector.service.ts
be/src/modules/tours/utils/identity-evidence-builder.util.ts
be/src/modules/tours/utils/nominatim-match.util.ts
be/src/modules/tours/utils/component-resolution-facts.util.ts
be/src/modules/tours/services/area-route-anchor-resolver.service.spec.ts
be/src/modules/tours/services/destination-resolution.service.ts
be/src/modules/integrations/overture/overture-places-index.service.ts
be/src/modules/integrations/overture/overture.module.ts
be/src/modules/integrations/osm/osm.module.ts
be/src/modules/integrations/integrations.module.ts
be/src/modules/tours/utils/geographic-validation-authorization.util.ts
be/src/modules/tours/interfaces/experience-discovery.interface.ts
be/prisma/schema.prisma
be/prisma/migrations/20261002120000_add_overture_places_index/migration.sql
be/test/integration/support/test-db.ts
be/test/support/assert-disposable-database.ts
be/test/jest-live.json
be/test/live/discovery/discovery-live.helper.ts
docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md
docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/ (directory listing; resolver-replay.post-fix.json spot-checked)
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/db-snapshot.sh
(the attached delta.diff for the declared range 18420047..15af1ccb)

```

## What this calibration does NOT establish

- This is **not** a canonical review of PR #71. It is not published, carries
  no `zig-zag-contextual-review` marker, and is not bound to PR #71's HEAD.
- It says nothing about the current state of `feat/preference-first-selection`.
- The reviewer cannot execute tests, builds, or git. Any question requiring
  execution is unproven by construction, not merely unchecked.
- One free-tier model reading one declared range is a single sample. It is
  not a statistical claim about review accuracy.

## Provider failures observed

_None._

