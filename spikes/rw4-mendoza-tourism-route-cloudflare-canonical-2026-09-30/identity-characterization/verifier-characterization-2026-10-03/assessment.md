# RW4 — IdentityVerifier evidence-driven characterization (2026-10-03)

Status: diagnostic plus one bounded, generic `IdentityVerifier` correction.
No COLD #12 or WARM was run. No canonical state was persisted
(`db-after-probe.*.json`: 0 GeoEntity / identity / hint-memory / Experience
rows in both runs).

## Harness

`run.sh` runs `be/test/live/rw4-identity-verifier-characterization.live-spec.ts`
on a fresh disposable DB that holds only a copy of the already-imported
Overture snapshot `rw4-uco-aoi-20261003` (release `2026-09-23.1`, AR,
`PARTIAL_PARTITION` / `OPERATIONAL_AOI`, bbox `[-69.5,-34,-68.5,-33]`, 4,328
rows). It uses the real `ExperienceProposalResolverService` with local
Nominatim/Overpass, Geoapify, live Wikidata, and the real
`OverturePlacesIndexService`. The catalog is a stub, and the grant is
the COLD #11 ROUTE_LIKE grant.

- `resolver-replay.pre-fix.json`: the verifier at `f3910172`.
- `resolver-replay.post-fix.json`: the corrected verifier. In this run,
  Geoapify timed out (5 s) for Alfa Crux and A16. Live Wikidata NEARBY for
  Ojo de Agua returned no match here, but returned a match in the pre-fix run.

## Observed outcomes

| Hint | Strategy reached | Evidence reaching the verifier | Pre-fix | Post-fix |
| --- | --- | --- | --- | --- |
| Alfa Crux | OVERTURE_IDENTITY `79eb9ee4…` (Meta 113197860037852) | EXACT_NAME/UNKNOWN (partial snapshot); Wikidata NEARBY found no item | **REJECTED** (deficit CANDIDATE_REJECTED) | INSUFFICIENT_EVIDENCE (CANDIDATE_UNCONFIRMED) |
| SuperUco | OVERTURE_IDENTITY `753ed444…` (Meta 276131252581993) | same as Alfa Crux | **REJECTED** | INSUFFICIENT_EVIDENCE |
| Bodega Azul | NOMINATIM `osm:node:4082354791` 'Supermercado del Vino "La Bodega de Azul"'; Overture 0 exact; Geoapify 7 results, all DESTINATION_INCOMPATIBLE | Wikidata NEARBY found no item (no name evidence) | **REJECTED** | INSUFFICIENT_EVIDENCE |
| A16 | nothing acquired (Nominatim 5 results with no exact match; Overture 0 exact; Geoapify 0) | none | no candidate | no candidate (PROVIDER_FAILURE in this run from the Geoapify timeout) |
| Ojo de Agua (Luján control) | NOMINATIM `osm:node:198407364` = **hamlet in Córdoba province**, 383 km outside | EXACT_NAME/MULTIPLE (5 same-name hamlets); Wikidata NEARBY matched both names | **VERIFIED** → would `upsertGeoEntity` + `rememberVerifiedHintName` | AMBIGUOUS, no writes |

Both composites stay rejected. Uco: UNCONFIRMED_MATCH. Luján: unresolved A16.

## Evidence ledger (four fixtures)

- **Source address or link (L1, SolSalute):** hyperlinks only. Alfa Crux
  links to the group page `agostinowinegroup.com/alfa-crux-wines`, SuperUco to
  `superuco.com`, Bodega Azul to `bodegalaazul.com`, and A16 to `a16sa.com`. The
  source gives no component address, so `addressHint` is absent for all four.
  Linked-page addresses (L2) never become hint facts.
- **Overture record (import → index):** the index keeps name,
  `alternateNames`, lat/lon, freeform `address`, upstream dataset/id/update
  time, and license. **It discards** locality, region, postcode, taxonomy and
  basic category, websites, phones, and brand at import. `lookupExactPlace`
  also never reads the stored `address` or `alternateNames`, and sets
  `declaredAlias` to UNKNOWN. So no Overture fact other than the exact name
  reaches the verifier.
- **Province:** you could derive it from the Overture point (Meta-sourced)
  with a canonical admin-boundary lookup. No typed per-component region fact
  from the source exists here (no area hint was emitted live). A provincial
  match alone could not verify a physical establishment anyway.
- **Independence:** the name, category, and location of an Overture row come
  from one upstream record (Meta, or Microsoft for one A16 row), so they are
  one fact. The source hyperlink and the provider's website are two
  independent declarations, but they establish a brand, not a facility:
  `bodegalaazul.com` covers the winery and the store, and `a16sa.com` is the
  city deli, not the winery. Wikidata NEARBY searches around the
  candidate's own point, so it is not independent of the candidate.
- **Discarded before the verifier:** the Overture category, locality,
  address, and alternate names (above). `addressConfirmed` is computed only
  on the LOCAL_OSM_POOL path, so the NOMINATIM, PLACES, and OVERTURE paths
  never compare an address. No typed *contradiction* evidence exists at all.

## Policy findings

1. **False negative label, canonical violation (fixed).** The rule
   `EXACT_NAME / UNKNOWN` plus "NEARBY found nothing" returned REJECTED.
   That turns NOT_CORROBORATED into CONTRADICTED, against amendment
   2026-09-22 §6. The non-verification itself was correct: no
   discriminating evidence exists for Alfa Crux or SuperUco.
2. **False positive (demonstrated, fixed).** NEARBY corroboration was
   treated as disambiguation of a `MULTIPLE` same-name pool. Because the
   search is centered on the selected member, any member with its own
   Wikidata item "corroborates" itself. Result: "Ojo de Agua" → a Córdoba
   hamlet, with catalog and hint-memory writes.
3. **Retained, not demonstrated:** a corroborating OWN_QID or OBSERVATION_QID
   still singles out a MULTIPLE member (RW1 San Telmo `Q1026688`). These are
   structural links, not proximity searches. Because the match is name-only
   against the QID labels, they remain a **potential** false-positive class
   for homonyms that each carry their own QID. Open risk.
4. **Structural gap: EXACT_NAME/SINGLE versus contradiction.** Rule 1 returns
   before any other evidence, and the evidence union has no contradiction
   type. A complete-country unique name would verify even when the
   source contradicts it. Today the only contradiction check is downstream
   composite geography (`REGION_CONFLICT` / `COUNTRY_CONFLICT` for
   source-named AREAs), and that runs *after* GeoEntity persistence. Not
   demonstrated by these fixtures, because no contradicting typed fact
   exists for them. Open.

## Correction

`IdentityVerifier` rule 4 changes, and it can only ever produce
AMBIGUOUS or INSUFFICIENT_EVIDENCE instead of the old outcome (never a new
VERIFIED):

- NEARBY corroboration over a MULTIPLE exact-name or alias pool → AMBIGUOUS.
- NEARBY finding no matching item → falls through to the multiplicity
  fallback (INSUFFICIENT_EVIDENCE or AMBIGUOUS), never REJECTED.
- A partial NEARBY match (hint-only or candidate-only), or a failing
  OWN_QID/OBSERVATION_QID match, stays REJECTED.

There are no winery-, Mendoza-, or Overture-specific branches, and no scores
or distances.

## Component-identity blockers that remain

- The Overture snapshot is an operational AOI, so exact-name multiplicity is
  UNKNOWN by contract. Alfa Crux and SuperUco can verify (EXACT_NAME/SINGLE)
  only after a `COMPLETE_COUNTRY` AR import. No importer is in the repo.
- Bodega Azul: no record declares the source name, and the "Bodega La Azul"
  spelling is MULTIPLE (winery and store). It needs a provider-declared alias
  or a component-bound independent fact.
- A16: no exact record. "Bodega A16" is two unconflated rows.
- Even with a complete AR snapshot, the Uco composition needs every member,
  so Bodega Azul still blocks it.
