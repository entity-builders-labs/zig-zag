# RW4: contextual physical identity, real replays (2026-10-03)

Diagnostic only. No COLD #12 or WARM was run. Every run persisted 0
canonical rows (`*/db-after-probe.json`).

## Harness (`run.sh`)

- The real discovery extractor runs on the exact SolSalute window the
  COLD #11 extractor saw (`be/src/modules/tours/fixtures/rw4-solsalute-deep-source-window.json`,
  copied from the COLD #11 trace, step 14), with the COLD #11 route_like
  request facts. There is no web fetch.
- The extracted candidates go through the real resolver, the real OSM
  locality grounder (local Nominatim and Overpass), Geoapify, live
  Wikidata, and the Overture AOI snapshot `rw4-uco-aoi-20261003`. The
  catalog is a stub.
- A grounding probe grounds the source caption's locality and records
  where the two historical Ojo de Agua candidates lie. It is never passed
  to the resolver and is not a verdict.

## Runs

| Run | Extractor | Candidates | Outcome |
| --- | --- | --- | --- |
| run-1 | cloudflare `@cf/qwen/qwen3.8-27b` (the COLD #11 extractor) | none | HTTP 429: daily Workers AI allocation exhausted |
| run-groq-1, run-groq-2 | groq `qwen/qwen3.8-27b` | 0 | extractor returned `{"candidates": []}` |
| run-gemini-1 | gemini `gemini-3.5-flash-lite` | Uco (Valle de Uco area + 3) and Luján (Luján de Cuyo area + A16 + Ojo de Agua) | see below |
| run-gemini-2 | gemini | Uco only | Bodega Azul got `physicalKindAssertion` term "Bodega": admitted by the gate, which exposed a defect (now fixed) |
| run-gemini-3 | gemini, after the fix | Uco only | no kind or locality assertion admitted |

## Grounding probe (real OSM, all runs)

`"Lujan de Cuyo"` grounds to `osm:relation:2989830` Departamento Luján de
Cuyo. It is the outermost member of the nested pair it forms with
`osm:relation:2989586` Distrito Ciudad de Luján de Cuyo.

- `osm:node:4797394430`, the Agrelo restaurant, is **INSIDE** it.
- `osm:node:198407364`, the Córdoba hamlet, is **OUTSIDE** it.

The administrative relationship is therefore grounded by point-in-polygon
containment against a real boundary, not by matching an address string.

## Decisions (run-gemini-1 for the Luján candidate, run-gemini-3 for Uco)

- **Ojo de Agua: AMBIGUOUS.** NOMINATIM returned 31 results and selected
  `osm:node:4797394430` (EXACT_NAME/MULTIPLE, NEARBY nothing). The extractor
  emitted no `localityAssertion` and no `physicalKindAssertion` for it. The
  source's caption "Wine and lunch at Ojo de Agua in Lujan de Cuyo" is
  admissible: the deterministic gate accepts it on the real window, as unit
  tests show. The verifier never received it, so there was no context to
  decide with. **Missing fact: the extractor's component-specific locality
  assertion.**
- **Alfa Crux and SuperUco: INSUFFICIENT_EVIDENCE.** Each is an Overture
  exact match with UNKNOWN multiplicity (AOI snapshot). The source never
  places either in a locality in one sentence. Only `sourceLink` was
  admitted (provenance, not identity).
- **Bodega Azul: INSUFFICIENT_EVIDENCE.** NOMINATIM's only result is the Azul
  (Buenos Aires) wine shop, which is not an exact name. No locality is
  asserted.
- **A16: no candidate acquired.** Its link was kept as provenance only.
- **Hamlet in Córdoba:** never selected, because the full window holds the
  Luján member. When the hamlet is reached (pre-fix window, in unit tests),
  LOCALITY and PHYSICAL_KIND contradictions reject it.

## Milestone 3: Overture (analysis first, no storage change)

The full Overture records captured on 2026-10-02 (`../overture/*.json`)
were checked against the new policy. Each one was asked whether a field
the import discards would change a decision.

| Fixture | Fields discarded at import | Would it change the decision? |
| --- | --- | --- |
| Alfa Crux (Meta 113197860037852) | locality "Villa San Carlos", category `winery`, group homepage website, phone shared with "Crux Cocina" | No. The source states no component locality. The website and phone are shared, so they are not identity. The category would only show kind compatibility. |
| SuperUco (Meta 276131252581993) | locality "El Manzano Histórico", category `restaurant`, website `superuco.com` (the same host as the source link) | No. The source states no locality, and a URL is provenance, not identity. |
| Bodega Azul / La Azul | the winery (Tupungato) and the store (Tunuyán) share website and phone | No. No record carries the source's exact name; the shared website and phone identify neither facility. |
| A16 | — | No. No record carries the exact name. |

**Decision: no migration, no reimport.** The snapshot's spatial extent
exists only inside the untyped `manifest` JSON
(`operationalBoundary.bbox`). Reading it would make a canonical decision
depend on a metadata bag, so an Overture pool is never a complete
comparison for a locality (`NOT_ESTABLISHED`).

**Implemented:**
- `lookupExactPlace` returns every exact-name row (`candidates`) instead of
  `rows[0]`.
- The resolver selects from the pool with the shared policy: the
  context-distinguished member, otherwise the member nearest the scope
  window. This is a choice of what to try, not evidence.
- The selected member answers to the same scope admission as NOMINATIM and
  PLACES.
- Each candidate carries `upstreamDatasets` (`meta`, for example) and
  `structuralKind: UNKNOWN`.

## Final five-fixture replay on the M3 code (`fixtures-replay-m3/`)

Hand-built COLD #11 hints, real providers, real Overture index, 0 writes.

| Component | Decision |
| --- | --- |
| Alfa Crux | INSUFFICIENT_EVIDENCE: Overture EXACT_NAME/UNKNOWN |
| SuperUco | INSUFFICIENT_EVIDENCE: Overture EXACT_NAME/UNKNOWN |
| Bodega Azul | INSUFFICIENT_EVIDENCE: the Nominatim wine shop in Azul (BA), not an exact name |
| A16 | no candidate acquired |
| Ojo de Agua | AMBIGUOUS: the Luján restaurant from a pool of 31, with no stated locality on the hint |
