# RW4-ID-FALSE-VERIFY-1 — identity trust forensic (2026-10-07)

The C3 retry (`../c3-retry-cold/`, HEAD `d4e0754f`) persisted the source stop
"Don Carlos" as `osm:node:5332434913` "Carlos Pellegrini" (`historic=tomb`).
The fix is `d7a7f088`; the rules are in spec amendment §19.3.

## Method

`replay-harness.forensic.spec.ts.txt` runs the real
`ExperienceProposalResolverService.resolve` with:
- the real local Overpass pool of `osm:relation:1224652` (Buenos Aires),
  2712 POIs;
- the real local Nominatim;
- the production `WikidataApiService` (live, read-only);
- empty Places and catalog stubs.

A spy on `IdentityVerifier.decide` records the evidence and the decision of
each attempt. To rerun it, copy it under `be/src/` as `*.spec.ts`, set
`FORENSIC_OUT` and `HINTS`, and run it with jest. No provider with a quota
was called.

## Files

| File | Content |
| --- | --- |
| `don-carlos-before-fix.json` | The decision on the pre-fix semantics, with rule labels only. Pass 1: `AMBIGUOUS / MATERIAL_COMPETITOR_KNOWN` (11). Pass 2: `VERIFIED / QID_LINK` on `OWN_QID` (the hint only overlaps the label). It also holds the 47 pool records containing "carlos". |
| `don-carlos-old-semantics-restored.json` | Fixed code with the old trust rules restored (OVERLAP counts, QID before competitors): `VERIFIED / QID_LINK` again. This is the mutation proof. |
| `suspicious-hints-after-fix.json` | 13 C3 hints that verified on a non-equivalent name, replayed after the fix. |
| `rw1-hints-after-fix.json` | El Zanjón (`GROUNDED_CONVERGENCE`), Farmacia la Estrella and three exact-name controls. |
| `c3-verified-attempts-by-correspondence.json` | Every C3 `VERIFIED` attempt, graded with `nameCorrespondence`. |
| `c3-hint-memory-by-correspondence.json` | Every persisted hint memory row in the C3 DB, graded the same way. |

## Findings

Same-class false positives in C3, closed by the fix (replay verdict after):

| Hint | Persisted as | Chain | After |
| --- | --- | --- | --- |
| Don Carlos | Carlos Pellegrini (tomb; Q270446 is the person) | OWN_QID, hint OVERLAP | AMBIGUOUS |
| Catedral | Catedral Constructiva (Q27954921 is a painting) | OWN_QID, hint OVERLAP | AMBIGUOUS |
| Bar El Federal | Plaza República Federal de Brasil (a square) | OWN_QID, hint OVERLAP | AMBIGUOUS |
| Club Atlético | Club Atlético Atlanta | NEARBY OVERLAP/OVERLAP | INSUFFICIENT_EVIDENCE |
| Plaza | a square with its own QID | OWN_QID, hint OVERLAP | AMBIGUOUS |

Likely-correct identities that no longer verify through a name-linked QID
(accepted recall loss, RW4-ID-EQUIV-RECALL-1): "La Librería del Avila",
"The San Telmo Market" and "Cabildo".
