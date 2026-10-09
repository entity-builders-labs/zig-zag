# RW4-ID-FALSE-VERIFY-2 fix: convergence inherits the name grade (2026-10-09)

Owner-approved Variant A. Base: `c1bbf288`. Spec: amendment §19.6 (rule 5).

## Defect

`IDENTITY_CONVERGENCE` was CORROBORATING whatever the hint↔candidate name
grade. Two strategies returning one record therefore verified a candidate
that only OVERLAPs the hint, provided no material competitor was known and
the geography was bounded. Example: "National Bank" verified as Edificio
First National Bank of Boston. Convergence proves only that one record key
was returned twice.

## Change

- `IDENTITY_CONVERGENCE` carries a typed `correspondence: NameCorrespondence`.
- The resolver computes it with `hintCandidateCorrespondence`, a new helper
  in `identity-name-correspondence.util.ts`. Competitor examination reads
  the same grade, so there is one authority.
- `identityEvidenceRole`: EQUIVALENT → CORROBORATING; OVERLAP and NONE →
  RETRIEVAL_ONLY.
- `IdentityVerifier` rule 5 decides only for a CORROBORATING convergence.
  `NO_MATERIAL_COMPETITOR` cannot promote retrieval-only evidence.

## 30-hint replay

Same harness as the forensic (`../rw4-functional-composite-campaign-2026-10-05/identity-false-verify-2-2026-10-07/`):
- local Overpass and Nominatim;
- live Wikidata;
- recorded Places.

The harness also records `rememberVerifiedHintName` calls per hint
(`replay.forensic.spec.ts.txt`).

| Hint | Before (`c1bbf288`) | After | Memory before → after |
| --- | --- | --- | --- |
| National Bank | VERIFIED `GROUNDED_CONVERGENCE` | INSUFFICIENT_EVIDENCE `NO_DECISIVE_EVIDENCE` | remembered → none |
| El Zanjón de Granados | VERIFIED `GROUNDED_CONVERGENCE` | INSUFFICIENT_EVIDENCE `NO_DECISIVE_EVIDENCE` | remembered → none |
| Farmacia la Estrella | VERIFIED `GROUNDED_CONVERGENCE` | INSUFFICIENT_EVIDENCE `NO_DECISIVE_EVIDENCE` | remembered → none |
| Museo Nacional del Cabildo | VERIFIED `GROUNDED_CONVERGENCE` | INSUFFICIENT_EVIDENCE `NO_DECISIVE_EVIDENCE` | remembered → none |

The other 26 hints are identical in final status, decision, rule,
candidate, memory writes and every per-attempt decision. That includes:
- Club Atlético: AMBIGUOUS `MATERIAL_COMPETITOR_KNOWN` (rule 4);
- Cabildo: VERIFIED `GROUNDED_UNIQUE_ALIAS`;
- Don Carlos, Catedral and Bar El Federal: AMBIGUOUS.

Files: `replay-before-c1bbf288.json`, `replay-after.json`.

## Tests

Regressions added:
- R1: generic "Kestrel Bank" → "First Kestrel Bank of Hollowmere", at
  verifier and resolver level. It is not VERIFIED, with no GeoEntity write
  and no hint memory.
- R2: SHARED and INDEPENDENT upstreams at verifier level; every upstream ×
  OVERLAP/NONE in the provenance matrix.
- R3: role matrix.
- R4: EQUIVALENT convergence still verifies, at verifier and resolver level.
- The trust invariant's evidence alphabet now includes convergence at all
  three grades.

**Group 1: expectations corrected because they pinned the defect.**
- Kestrel Hall → Annex.
- The resolver "control" (National Bank shape).
- Provenance-matrix VERIFIED at any upstream.
- El Zanjón projected facts and resolver Case A.
- The Farmacia gate.

**Group 2: OVERLAP convergence was only scaffolding.** Each test now uses
legitimate EQUIVALENT evidence, and its subject is unchanged:
- defect-A examination;
- contradiction table;
- NEARBY;
- geography;
- Wikidata unavailable;
- IDENTITY_CONFLICT;
- trusted-observation cross-identities;
- memory (unit);
- memory round-trip (integration, now via a declared `alt_name`).

## Mutations (`mutation-results.txt`)

- M1: the role policy makes OVERLAP convergence CORROBORATING again. 13
  tests fail.
- M2: rule 5 ignores the role. 16 tests fail.

Both sources were restored byte-for-byte.

## Deferred

- Durable hint memory does not record the deciding rule or the evidence
  strength.
- Memory learned under the old rule stays trusted. Live acceptance must
  use a fresh catalog.
