# RW4: candidate selection before identity verification (2026-10-03)

Status: forensic characterization plus two bounded, generic corrections.
No COLD #12 or WARM was run, and no canonical state was persisted
(`db-after-probe.json`: 0 GeoEntity, identity, hint-memory and Experience
rows).

## Harness

`run.sh` is the same harness as `../verifier-characterization-2026-10-03`:
the real `ExperienceProposalResolverService`, local Nominatim and Overpass,
Geoapify, live Wikidata, the real Overture index (snapshot
`rw4-uco-aoi-20261003`, a PARTIAL AOI), a stub catalog, and the COLD #11
ROUTE_LIKE grant. The live spec now also records the raw Nominatim pools for
every member hint, in both the default window and the provider-maximum
window (`resolver-replay.json` → `nominatimPools`). The unit fixture
`be/src/modules/tours/fixtures/rw4-ojo-de-agua-nominatim-pool.json` is the
same local-Nominatim response, captured with the adapter's field mapping.

## Ojo de Agua forensics (observed, not reconstructed)

1. **The five candidates.** The resolver's query (country `ar`, soft viewbox
   biased to Ciudad de Mendoza, `limit=5`) returned only these, all
   `exactName` matches:

   | OSM id | kind | province | distance from Mendoza centre |
   | --- | --- | --- | --- |
   | node/198407364 | place=hamlet | Córdoba (Pedanía San Carlos, Minas) | 383 km |
   | node/6348417568 | place=hamlet | Neuquén (Catán Lil) | 756 km |
   | node/5138938937 | place=hamlet | Tucumán (Tafí del Valle) | 727 km |
   | node/5128388825 | place=hamlet | Salta (General Güemes) | 986 km |
   | node/5110696301 | place=isolated_dwelling | Jujuy (Cochinoca) | 1080 km |

2. **Province.** None of the five is in Mendoza.
3. **Kinds.** Four are settlements (hamlet, importance 0.133) and one is a
   dwelling (0.107). None is a venue.
4. **The intended establishment.** It is not in the five. The full pool
   (`limit=40`) holds 31 exact-name homonyms. One of them is in Mendoza:
   `osm:node:4797394430`, `amenity=restaurant`, named "Ojo de Agua", in
   Distrito Agrelo, Departamento Luján de Cuyo. Its importance is 0 and it
   ranks near the bottom of the pool (28th to 30th, depending on the
   viewbox). The Overture AOI index independently holds "Ojo de Agua
   Argentina" (Meta 681888061832723, "Bajo Las Cumbres S/n") about 8 m from
   that node. That is a plausible physical candidate, but its name is not
   exact. The source describes "a winery lunch", links
   `https://ojodeagua.ch/`, and captions "Wine and lunch at Ojo de Agua in
   Lujan de Cuyo".
5. **Why Córdoba won.** `destinationPoint` was available: the scope window
   centre for Ciudad de Mendoza. `bestNominatimMatch` correctly picked the
   nearest of the five, the Córdoba hamlet at 383 km. Distance ranking did
   not cause the error, and neither did selection by importance. Nominatim's
   global importance chose which five came back, and the soft viewbox did not
   override it. The restaurant was truncated **before** any client-side
   evaluation.
6. **`destinationPoint`.** Available (see 5).
7. Not applicable.
8. **Discarded before the verifier.** Yes, by provider truncation (26
   homonyms, including the only Mendoza member). The resolver then passes
   ONE selected member to the verifier. That is acceptable only because
   multiplicity is carried as evidence (MULTIPLE never verifies without a
   discriminating fact).
9. **Luján de Cuyo provenance.** The source asserts it explicitly: a section
   heading "Lujan de Cuyo Itinerary" and the photo caption above. The typed
   component hint does not carry it. `GeoEntityHint` has `name`, `role`,
   `expectedKind`, `evidenceKeys` and an optional `addressHint`, and has no
   locality and no URL. Only the LLM-named Experience ("Lujan de Cuyo Wine
   Tasting Itinerary") carries it, and that is not a typed per-component
   fact.
10. **Discriminating evidence.** These facts would discriminate: a typed
    source-asserted locality matched to the candidate's administrative
    containment, which is contextual and still not proof alone; the source's
    component URL (`ojodeagua.ch`) matched to a provider-declared website,
    which neither the OSM node (no `website` tag) nor the Overture index
    (websites dropped at import) carries today; a street address; or a QID.
    None reaches the verifier today.

## Corrections (generic, no fixture-specific branch)

1. **Selection boundary.** Component identity acquisition now requests
   Nominatim's whole result window (`resultWindow: 'PROVIDER_MAXIMUM'`,
   Nominatim's documented cap of 40; the cache key includes it). This applies
   to every NOMINATIM component attempt. The exact-name multiplicity is now
   counted over the pool the provider actually serves. A sample of 28 names
   used in RW1 to RW4 showed no SINGLE→MULTIPLE flip; only already-MULTIPLE
   pools grew (for example, "Caminito" grew from 5 to 29 and "Palermo" from
   5 to 35).
2. **Explicit contradiction.** There is a new typed evidence
   `IDENTITY_CONTRADICTION` (`fact: 'WIKIDATA_QID'`). It applies when the
   observation the hint cites declares a QID and the candidate declares a
   different own QID. It is built locally, with no network call, and
   `IdentityVerifier` checks it **before** every positive rule
   (convergence, EXACT_NAME/SINGLE, ADDRESS_MATCH, alias SINGLE,
   catalog-hint memory, OWN_QID). Before this change, the resolver returned
   on a local VERIFIED without ever collecting Wikidata, and the collector
   silently preferred the candidate's own QID over the source's. The two
   declared identities were never compared. A local REJECTED now also skips
   the Wikidata round trip.

No numeric confidence, no distance threshold, and no Mendoza-, winery-,
Overture- or Nominatim-specific verification rule.

## Post-fix real replay

| Hint | Outcome | Notes |
| --- | --- | --- |
| Ojo de Agua | NOMINATIM 31 results → selects `osm:node:4797394430` (Luján de Cuyo restaurant), EXACT_NAME/MULTIPLE, NEARBY nothing → **AMBIGUOUS** | The Córdoba hamlet is no longer selected. Correct geography, insufficient identity. 0 writes. |
| Alfa Crux | OVERTURE EXACT_NAME/UNKNOWN → INSUFFICIENT_EVIDENCE | unchanged (PARTIAL snapshot) |
| SuperUco | OVERTURE EXACT_NAME/UNKNOWN → INSUFFICIENT_EVIDENCE | unchanged |
| Bodega Azul | NOMINATIM pool = 1 non-exact record (Supermercado del Vino "La Bodega de Azul", Azul, Buenos Aires) → INSUFFICIENT_EVIDENCE; Overture 0 exact | unchanged; Geoapify timed out this run |
| A16 | Nominatim: 3 exact "A16" records are house numbers in Río Negro, San Juan and Buenos Aires, not in the biased resolver window; nothing acquired | negative control holds |

Catalog-write safety: `wouldPersistCalls = []`, and the DB snapshot shows 0
canonical rows.

## Findings not changed (recorded)

- **Overture selection and admission.** `lookupExactPlace` returns
  `rows[0]` by featureId (an arbitrary member). `OVERTURE_IDENTITY` also
  never applies `admitComponentLocation`, unlike NOMINATIM and PLACES.
  Neither changes an outcome today: a MULTIPLE pool is AMBIGUOUS whichever
  row is selected, and no Overture fact other than the name reaches the
  verifier. This was not demonstrated as a wrong decision, so it is left
  open.
- **OSM-derived convergence.** Nominatim and Geoapify both index OSM.
  `IDENTITY_CONVERGENCE` between them is two indexes of one upstream record,
  each selected by name and proximity. Today it verifies even over a
  MULTIPLE pool. It was not observed (Geoapify returned 0 for Ojo de Agua),
  so it is left open.
- **Source facts dropped at extraction.** These are the component URL and
  the explicit locality.
- **Provider facts dropped at Overture import.** These are the website,
  category and locality.
- **Kind compatibility.** A `venue` hint can resolve to a settlement node
  (hamlet). The canonical rule is that discovery's `expectedKind` is a
  proposal, not truth. This task does not change that.
