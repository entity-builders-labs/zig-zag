# Stage 3 — verified hint memory: live COLD/WARM gate (2026-09-25)

Branch `feat/preference-first-selection`, starting HEAD `d1059a7`
(verified equal to `fork/feat/preference-first-selection` before any
change).

Harness: `be/test/live/place-cutover-cold-warm.live-spec.ts` (the same
harness as `spikes/stage3-place-cutover-cold-warm-2026-09-25/`, extended —
not a new one), run with `SPIKE_OUT_DIR` pointing here. Real production
`ExperienceProposalResolverService.resolve`, fresh dedicated database
`zigzag_spike_stage3_place_cutover` (dropped, recreated, `prisma migrate
deploy`, 0 GeoEntities before COLD), real Geoapify, local Nominatim and
Overpass, live Wikidata. Solar de French is now part of the default corpus;
the strategy-isolated PLACES characterization is opt-in
(`LIVE_PLACES_ISOLATED=1`) and was **not** re-run (captured once in the
cutover evidence). Evidence: `matrix.json`, `summary.md`.

## What changed

The previous run's blocker 1: hints whose text differs from the canonical
GeoEntity name missed exact-name catalog reuse on WARM and re-acquired 3–9
provider calls onto the same GeoEntity.

Fix: **verified hint memory** on the GeoEntity row itself —
`verifiedHintNames text[]` (verbatim hint) + `verifiedHintNameKeys text[]`
(`normalizeGeoName` key, positionally aligned, DB CHECK on equal
cardinality, GIN index). The resolver appends a hint only after
IdentityVerifier accepted an external resolution to a GeoEntity of the
hint's expected kind; the catalog read unions canonical-name and
verified-hint matches (multiplicity kept); a single verified-hint match is
typed `CATALOG_VERIFIED_HINT_MATCH` evidence that IdentityVerifier accepts
like EXACT_NAME(SINGLE) (MULTIPLE → AMBIGUOUS). Not an alias engine: no
similarity, no backfill, no global uniqueness.

## COLD/WARM (full corpus + Solar de French)

| Hint | COLD | memory | WARM | WARM evidence | WARM identity calls / ms | Same GeoEntity |
| --- | --- | --- | --- | --- | --- | --- |
| Farmacia la Estrella | PLACES, `IDENTITY_CONVERGENCE(NOMINATIM)` | REMEMBERED | **CATALOG_REUSE** | `VERIFIED_HINT(SINGLE; "farmacia la estrella")` | **0** / 110 | yes |
| Mafalda Statue | LOCAL_OSM_POOL, `WIKIDATA(OWN_QID)` | REMEMBERED | **CATALOG_REUSE** | `VERIFIED_HINT(SINGLE; "mafalda statue")` | **0** / 85 | yes |
| El Zanjón de Granados | NOMINATIM, `IDENTITY_CONVERGENCE(LOCAL_OSM_POOL)` | REMEMBERED | **CATALOG_REUSE** | `VERIFIED_HINT(SINGLE; "el zanjon de granados")` | **0** / 139 | yes |
| Recoleta Cemetery | PLACES, `WIKIDATA(OWN_QID Q831322)`; persistence REUSED the Cementerio GeoEntity | REMEMBERED (on Cementerio de la Recoleta) | **CATALOG_REUSE** | `VERIFIED_HINT(SINGLE; "recoleta cemetery")` | **0** / 127 | yes |
| Casa Mínima | LOCAL_OSM_POOL `EXACT_NAME(SINGLE)` | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 104 | yes |
| Mercado de San Telmo | same | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 95 | yes |
| Plaza Dorrego | same | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 119 | yes |
| Basílica de San Francisco | same | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 115 | yes |
| Parque Lezama | same (the park) | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 97 | yes |
| Cementerio de la Recoleta | same | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 94 | yes |
| Plaza San Martín | PLACES `EXACT_NAME(SINGLE)` (Retiro) | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 107 | yes |
| Solar de French | PLACES, `IDENTITY_CONVERGENCE(NOMINATIM; osm:relation:9314953)` | REMEMBERED | CATALOG_REUSE | `EXACT_NAME(SINGLE)` | 0 / 167 | yes |
| Galería Güemes | **UNCONFIRMED** (fail closed) | — (never remembered) | UNCONFIRMED | — | 4 / 4203 | — |
| Defensa Street | **UNCONFIRMED** (never a PLACE) | — (never remembered) | UNCONFIRMED | — | 4 / 5457 | — |
| San Martín *(adversarial, harness-only)* | LOCAL_OSM_POOL → Monumento al General San Martín (known debt) | REMEMBERED | CATALOG_REUSE | `VERIFIED_HINT(SINGLE; "san martin")` | 0 / 171 | yes |

"Identity calls" = Geoapify search/details, Nominatim, Overpass, Wikidata,
Wikipedia, Serper, SerpApi, Google Places. The only other WARM request per
hint is `localhost:1`, the local embedding provider indexing the accepted
Experience — not identity work. The harness asserts the WARM gate for every
COLD-resolved name-divergent and exact-name hint.

Exact-name hints are also remembered (the rule is "every VERIFIED external
resolution", not "only when the text differs"): it keeps the memory valid if
a later provider-backed update changes `GeoEntity.name`. WARM still reports
them as `EXACT_NAME` because a canonical-name match wins for the same row.

## Provider calls

| Provider | COLD | WARM | WARM for the 12 gated hints |
| --- | --- | --- | --- |
| Geoapify geocode/search | 6 | 2 (Güemes, Defensa) | 0 |
| Geoapify place-details | 4 | 0 | 0 |
| Nominatim (local) | 7 | 2 (Güemes, Defensa) | 0 |
| Overpass (local) | 15 | 2 (Güemes, Defensa) | 0 |
| Wikidata | 22 | 2 (Güemes, Defensa) | 0 |
| en.wikipedia.org | 6 | 0 | 0 |
| Serper / SerpApi / Google Places | 0 / 0 / 0 | 0 / 0 / 0 | 0 |

Plus destination resolution (1 Nominatim, 1 Overpass) once per run. Previous
run's WARM for the four name-divergent hints: 17 identity calls, 3.9–7.2 s
each → now 0 calls, 85–139 ms.

## DB counts

| | GeoEntity | GeoEntityIdentity | verified-hint entries |
| --- | --- | --- | --- |
| after COLD | 12 | 18 | 13 |
| after WARM | 12 | 18 | 13 |

No array holds a duplicate key (asserted). Cementerio de la Recoleta holds
two entries (`Cementerio de la Recoleta`, `Recoleta Cemetery`), both from
independent VERIFIED resolutions. Güemes and Defensa hold none.

## Query / index evidence

Lookup (`ExperienceCatalogService.findGeoEntityIdsByVerifiedHintKey`):

```sql
SELECT "id" FROM "geo_entity"
WHERE "verifiedHintNameKeys" @> ARRAY[$key]::text[]
  AND "kind" = $kind::"GeoEntityKind"
  AND "latitude" BETWEEN $minLat AND $maxLat
  AND "longitude" BETWEEN $minLon AND $maxLon
ORDER BY "id"
```

`@>` (not `= ANY(...)`, which GIN cannot serve). Index:
`CREATE INDEX "geo_entity_verifiedHintNameKeys_idx" ON "geo_entity" USING
GIN ("verifiedHintNameKeys")` (declared as `@@index([verifiedHintNameKeys],
type: Gin)`), migration `20260925180000_add_geo_entity_verified_hint_names`.

- Real Postgres, 5,001 PLACE rows all inside the bbox, after `ANALYZE`
  (`verified-hint-memory.integration-spec.ts`, asserted):
  `Bitmap Index Scan on "geo_entity_verifiedHintNameKeys_idx"` → `Bitmap
  Heap Scan` with kind/bbox as Filter; no Seq Scan.
- This live DB (12 rows, no statistics): `Index Scan using
  geo_entity_latitude_longitude_idx` with the `@>` as Filter — still bounded
  and index-backed, never a sequential scan; at this size the planner
  prefers the btree.

The canonical-name half of the lookup is unchanged (kind + bbox Prisma
query, normalized-name comparison over that bounded pool).

## Remaining real deficits (not fixed here)

1. **San Martín** (adversarial bare-name control added by this harness, not
   an observed source-backed production hint): IdentityVerifier still lets
   `WIKIDATA_IDENTITY_MATCH(OWN_QID)` override `DECLARED_ALIAS_MATCH
   (MULTIPLE)`. New consequence: verified hint memory records whatever
   IdentityVerifier VERIFIED, so this control's wrong resolution is now also
   remembered and WARM reuses it catalog-first without re-verification
   against providers. If the verifier rule is hardened later, the stale
   entry must be cleared (development data is disposable per the
   early-stage deletion rule). Hardening debt; not a Stage 3 blocker.
2. `representativePoint` uses the first polygon of a MultiPolygon.
3. `AreaRouteAnchorResolverService` still labels Nominatim anchors with the
   `nominatim` namespace.
4. Galería Güemes and Defensa Street re-acquire 4 calls on every run: a
   fail-closed hint has nothing verified to remember (by design).
