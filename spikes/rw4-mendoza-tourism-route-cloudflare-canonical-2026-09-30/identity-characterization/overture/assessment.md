# Overture Places identity-coverage assessment (RW4, 2026-10-02)

Characterization only. No production code, identity behavior, geographic
authorization, provider selection or persistence changed. No COLD, no WARM,
no DB writes. Mendoza/Uco/wine strings appear only in this spike.

Question: can Overture give Zig-Zag a licensed, persistent, provider-native
identity source for real-world entities missing from its current canonical
sources?

## 1. Data and scope

- Release `2026-09-23.1` (STAC `latest`), schema `v2.0.0` (`categories`
  removed; `taxonomy` + `basic_category` used). `.1` patched GERS ids for
  `base`/`building_part` only; places are unaffected.
- One Parquet partition intersects the domain (STAC item `00004`); bbox
  covering-column pushdown reads 29 202 rows in ~20 s. No bulk download.
- Authorized domain = COLD #11 route-scale: destination-boundary centroid
  `-32.88309217907325, -68.86223810433484`, 80 km haversine
  (`destination-compatibility.policy.ts` route-scale rule).
  Route-scale bbox `[-69.7190, -33.6025, -68.0055, -32.1636]`.
  A labelled `WIDER_DIAGNOSTIC` margin of 0.3° was queried in the same pass;
  rows beyond 80 km are never counted as candidates.

## 2. Domain profile (28 122 in-domain rows)

| Fact | Rows | Share |
| --- | ---: | ---: |
| whole-record source = Meta (CDLA-P-2.0) | 27 000 | 96.0% |
| Microsoft (CDLA-P-2.0) | 425 | 1.5% |
| Foursquare (Apache-2.0) | 402 | 1.4% |
| AllThePlaces (CC0-1.0) | 295 | 1.0% |
| rows with >1 whole-record source | 0 | 0% |
| website present | 11 756 | 41.8% |
| phone present | 24 318 | 86.5% |
| freeform address present | 26 874 | 95.6% |
| `names.common` present | 0 | 0% |
| `names.rules` present (AllThePlaces chains only) | 295 | 1.0% |
| `operating_status` present | 0 | 0% |

The release notes report 18.4 M places marked `open` globally; none of them
are in this domain. Every row also carries a synthetic
`Overture/confidence_calculation` source entry for `/properties/confidence`.

## 3. Licensing / provenance (Step 2)

Overture publishes no single Places license; each row inherits the license of
its upstream source, carried in `sources[].license` (Meta/Microsoft/PinMeTo/
Krick/RenderSEO/DAC/BrightQuery: CDLA-Permissive-2.0; Foursquare: Apache-2.0
with NOTICE attribution; AllThePlaces: CC0-1.0). Every row inspected here
has an explicit license; `LICENSE_STATUS = UNRESOLVED` was not needed.

| Candidate | Overture ID | Upstream | Record ID | License |
| --- | --- | --- | --- | --- |
| Alfa Crux | 79eb9ee4-0591-49f3-a077-51a7926a3ada | meta | 113197860037852 | CDLA-P-2.0 |
| SuperUco | 753ed444-8e83-4178-8ad3-a05e9a28b7c5 | meta | 276131252581993 | CDLA-P-2.0 |
| Bodega La Azul | d97a65d2-7613-41eb-ab26-fc577699f26d | meta | 1893816807339177 | CDLA-P-2.0 |
| Bodega A16 | 8a73108f-cdd4-4b19-8a24-7cc78f14fbd2 | meta | 1396967760585038 | CDLA-P-2.0 |
| Bodega A16 | 7eaf553c-dfdb-4462-ab4e-1f3d6656f3f1 | Microsoft | 1407374888439853 | CDLA-P-2.0 |

CDLA-Permissive-2.0 permits use, modification and sharing of the data and
places no restriction on results/derived analysis. That is materially
different from the Google terms (`../google/terms-gate.json`): storing names,
addresses and coordinates and doing point-in-polygon analysis on them are
not prohibited. Attribution duties are per upstream (the Overture attribution
page lists them per source; Apache-2.0 rows carry a NOTICE requirement). The
exact Overture-level credit text was not verified in this task. **Not legal
advice**. A product or legal owner must confirm before integration; the
evidence here supports "usable" for all five rows.

## 4. Per-fixture findings

Full worksheets: `alfa-crux.json`, `superuco.json`, `bodega-azul.json`,
`a16.json`.

| Fixture | Source-name exact match | Acquisition class (authorized domain) | Best record |
| --- | --- | --- | --- |
| Alfa Crux | 1 record | **OUTSIDE_AUTHORIZED_DOMAIN** (105.2 km) | 79eb9ee4, winery, El Cepillo, website = group homepage |
| SuperUco | 1 record | **OUTSIDE_AUTHORIZED_DOMAIN** (87.1 km) | 753ed444, restaurant, website superuco.com |
| Bodega Azul | 0 records | NO_CANDIDATE by source name; PROBE_QUERY "Bodega La Azul" → **MULTIPLE_PLAUSIBLE_CANDIDATES** (3 + "La Azul") | d97a65d2, 73.2 km, 23 m from OSM node/4851595199, website bodegalaazul.com |
| A16 | 0 records | NO_CANDIDATE by source name; discovery → **MULTIPLE_PLAUSIBLE_CANDIDATES** (5 objects, 4 facility kinds) | 8a73108f / 7eaf553c (same winery, 2 GERS ids) |

Separate question: does Overture expose strong facts that let the existing
identity model establish SAME entity?

- **Alfa Crux:** only if geography allowed it. Then EXACT_NAME is SINGLE, so
  verifier rule 1 would pass. No independent strong fact: the website is the
  group homepage (a host also used by a different winery), the address is
  locality-level ("El Cepillo"), and the phone is shared with the group
  restaurant. The linked page's street address ("Calle Los Indios s/n")
  appears on the group's restaurant and hotel records, not on this one. A
  different-name winery record, "Bodega O. Fournier", sits 5 m away, and
  Overture declares no relation between the two.
- **SuperUco:** only if geography allowed it. Then EXACT_NAME is SINGLE and
  would verify. This is the first case where both sides of official-domain
  correlation exist: the provider declares `superuco.com` and the source links
  `superuco.com`. That is not an existing evidence type.
- **Bodega Azul:** no. The source name is declared by no record, and no
  record declares aliases. Even with the hint "Bodega La Azul", EXACT_NAME
  would be MULTIPLE, so the result is AMBIGUOUS. The official domain narrows
  4 records to 2 (winery + Tunuyán store) and the phone is shared by 3, so
  both are brand facts, not facility facts. Overture provides no winery-vs-
  restaurant structure, so nothing justifies a collapse.
- **A16 (negative control):** exact-name acquisition returns nothing, so it
  fails closed, which is better than Geoapify's FC Belgrano. Containment
  discovery would return 5 objects. The source-hyperlink host `a16sa.com` is
  declared by the city deli, not the winery (`a16sa.com.ar`), so
  domain-equality would pick the wrong facility. Address and phone match the
  linked page on two unconflated winery records. A valid GERS id makes none
  of them "the" answer.

## 5. Acquisition matrix (no Google)

| Fixture | OSM | Nominatim | Geoapify | Wikidata | Overture |
| --- | --- | --- | --- | --- | --- |
| Alfa Crux | NO_CANDIDATE | NO_CANDIDATE | NO_CANDIDATE | NO_CANDIDATE | OUTSIDE_AUTHORIZED_DOMAIN (79eb9ee4, 105.2 km) |
| SuperUco | NO_CANDIDATE | NO_CANDIDATE | NO_CANDIDATE | NO_CANDIDATE | OUTSIDE_AUTHORIZED_DOMAIN (753ed444, 87.1 km) |
| Bodega Azul | ONE_PLAUSIBLE (node/4851595199 "Bodega La Azul", via other name) | ONLY_STRUCTURALLY_WRONG | ONE_PLAUSIBLE (same OSM node; REJECTED) | NO_CANDIDATE | NO_CANDIDATE by source name; MULTIPLE (d97a65d2 best) by PROBE_QUERY |
| A16 | NO_CANDIDATE | NO_CANDIDATE | ONLY_STRUCTURALLY_WRONG (FC Belgrano) | NO_CANDIDATE | NO_CANDIDATE by source name; MULTIPLE (8a73108f/7eaf553c) by discovery |

## 6. Identity-authority classification (Step 17 / J)

| Overture field | Class | Rationale |
| --- | --- | --- |
| `id` (GERS) | IDENTITY | provider-native, registry-backed; `GeoEntityIdentity(provider='overture', externalId=<GERS UUID>)` |
| `names.primary` | CANONICAL_FACT (name) + identity evidence input (EXACT_NAME) | provider-declared; multiplicity must be computed over the bounded Overture pool |
| `names.common` / `names.rules[].value` | CORROBORATION_ONLY (DECLARED_ALIAS_MATCH input) | provider-declared; empty for independent POIs in this domain |
| `geometry` Point | CANONICAL_FACT (coordinates), subject to destination compatibility | records can be city-fallback misplaced (e.g. 33e0b236, 62f80ec2), so they are never identity |
| `addresses[]` | CORROBORATION_ONLY | often locality-level; would feed ADDRESS_MATCH only when the hint carries an address |
| `websites[]` | CORROBORATION_ONLY | shared by brand branches and group sites; never identity alone |
| `phones[]` | CORROBORATION_ONLY | shared across branches (3 records share Bodega La Azul's phone) |
| `emails[]`, `socials[]` | PROVENANCE_ONLY (not stored canonically) | contact/PII-adjacent; social URL is the upstream page, not facility identity |
| `taxonomy`, `basic_category` | CANONICAL_FACT (structural classification input) | not identity; must not override Zig-Zag classification policy |
| `confidence` | PROVENANCE_ONLY (existence signal) | not a quality score and not identity |
| `operating_status` | CANONICAL_FACT when present (closure) | absent here; unknown stays unknown |
| `brand` | CORROBORATION_ONLY | chain-level, not facility |
| `sources[]` (dataset, record_id, license, update_time, version) | PROVENANCE_ONLY | needed for attribution; not convergence |

## 7. Conflation findings (Step 10 / K)

- In this domain, 0 of 28 122 rows have more than one whole-record source.
  The second `sources[]` entry on every row is Overture's own
  `/properties/confidence` calculation, not an independent observation.
- Overture did not conflate the Meta and Microsoft records of the A16
  winery (same phone and street, 919 m apart, two GERS ids). It also keeps a
  co-located different-name record at the Alfa Crux site (5 m).
- What conflation proves: Overture's matcher judged certain upstream records
  to be one feature, recorded per-property in `sources[]`.
- What it does NOT prove for Zig-Zag: independent identity convergence.
  `IDENTITY_CONVERGENCE` requires two structurally independent acquisition
  strategies to reach the same strong identity. Overture's internal merge is
  one pipeline's opinion, and its upstreams are not shown to be independent
  of each other (several are aggregators). Multiple Overture sources must
  not be translated into `IDENTITY_CONVERGENCE`.
- Cross-provider convergence with OSM/Geoapify is also unavailable here:
  Overture Places rows carry no OSM id, so d97a65d2 being 23 m from
  osm:node:4851595199 is proximity, not shared identity.

## 8. GERS / ID stability (Steps 11–12 / L)

- `id` is a GERS ID: a random UUID whose presence in the registry
  (`s3://overturemaps-us-west-2/registry/`) makes it GERS. All 12 inspected
  ids are live. `first_seen` ranges from 2025-06-25.0 to 2026-07-22.0, so
  several ids have been stable for about 15 months (`gers-registry.json`).
- It can be a provider-native `GeoEntityIdentity` with
  `externalId = <GERS UUID>`. Store the release in which it was observed.
- Stability limits (Overture "GERS ID Stability"):
  - a rebrand with no other continuity, or a move beyond the matcher's
    compare distance, gets a new id;
  - on a split or merge, at most one piece keeps the id;
  - Overture publishes no old→new mapping. The changelog shows `removed` +
    `added`, unlinked.
  - The Alfa Crux / "O. Fournier" pair shows that rebrand-shaped duplicates
    already exist.
- Reconciliation a future integration needs:
  1. Per release, join held ids to the registry (`path IS NOT NULL` = live)
     and to `changelog/<release>/theme=places/type=place/change_type=*`
     (`added`/`removed`/`data_changed` + `columns_changed`).
  2. Treat `removed` as "identity lapsed, unknown why". Never auto-relink by
     name. Re-acquire through the normal verified path; a new id is a new
     candidate.
  3. Use `operating_status = permanently_closed` (confidence 0) as an
     explicit closure fact when present. Absence means unknown, not open.
  4. Use bridge files (`bridgefiles/<release>/provider=…`) to map upstream
     `record_id` to GERS id and to refresh attribution.
  5. Note: `version` incremented and `data_changed[categories]` appeared on
     every row this release purely because of the schema change. Change
     detection must use `columns_changed`, not `version`.
- Freshness: public releases are retained ≤ 60 days (two monthly releases).
  Changelogs and bridge files are retained for all releases. "Download once
  and treat as canonical forever" is therefore unsafe. A future integration
  needs:
  - an initial bounded import (or on-demand bounded lookup);
  - a monthly refresh within the 60-day window;
  - changed-entity reconciliation from the changelog;
  - deleted/closed handling via `removed` and `operating_status`;
  - attribution refresh from `sources[]` and bridge files.

## 9. Attribution metadata that must survive (Step 18)

Per persisted Overture-derived fact, keep: Overture release, GERS id,
upstream `dataset`/`provider`, upstream `record_id`, `license`, upstream
`update_time`, and the `sources[].property` scope (whole record vs one
property). Do not flatten to a single "source=overture" label: the license
and attribution duty are per upstream, and Apache-2.0 rows need the NOTICE.

## 10. Global portability (M)

The mechanism is entity-generic: bbox-pruned lookup, provider-declared
names, exact-name multiplicity, and per-row license. Limitations by
dimension:

- **Coverage / source density:** in markets where Meta dominates (here 96%),
  coverage tracks a business's social presence. Small hospitality and food
  POIs are well covered. Public-sector, natural and heritage objects with no
  business page are weakly covered (OSM/Wikidata remain better for them).
  BrightQuery/Foursquare density differs by country (BrightQuery now covers
  US, DE, IT, DK, CA).
- **Language / diacritics:** a single `names.primary` in the page owner's
  spelling. There are no `common` names for independent POIs, so
  multilingual or transliterated hints will miss exact match. Diacritics
  normalize fine; tokenization variants ("SuperUco" vs "Super Uco") do not.
- **Category:** `taxonomy` reflects how the page owner self-labels (SuperUco
  = restaurant). It is not a facility-type truth.
- **Country:** licensing is row-level and uniform. Address structure varies
  (`region` often null).
- **Negative-control classes:**
  - chain or group sharing one domain: Alfa Crux group host, Bodega La Azul
    winery + store;
  - municipal or aggregator portals: the website field would point at the
    portal;
  - booking/social aggregators: `socials` is always a Facebook page;
  - short names colliding with routes: A16 is safe under exact-name,
    unsafe under containment;
  - map-service URLs as "official": not observed, but the website field is
    unvalidated.
- **Business lifecycle:** rebranding (new id, possible residual duplicate),
  multiple branches (separate records sharing domain and phone), co-located
  businesses (separate or missing records), closed businesses
  (`operating_status` unknown here), brand vs facility (`brand` is
  chain-level only).

## 11. Verdict

```text
OVERTURE IDENTITY COVERAGE VERDICT = PARTIAL_VALUE
```

- **Value:** Overture has records for all four physical entities. Two of
  them (Alfa Crux, SuperUco) are in none of OSM, Nominatim, Geoapify or
  Wikidata, and A16's winery is also in none of them. Licensing is explicit
  and permissive per row. GERS ids are registry-backed and observed stable
  for many months. Websites and phones appear where the other sources had
  none.
- **Why not STRONG_CANDIDATE:**
  1. Neither currently uncovered Uco component is inside the authorized
     domain, so the observed RW4 acquisition gap is not closed.
  2. Independent POIs declare no alternate names.
  3. Single-source rows with no conflation give no independent convergence.
  4. Unconflated duplicates and city-fallback coordinates create MULTIPLE
     and misplacement cases.
  5. The strongest new fact (declared website) is not an existing evidence
     type and is unsafe as a sole key.

## 12. Current Uco effect (O)

```text
Would hypothetical OVERTURE_IDENTITY now allow the currently observed Uco
multi-component Experience to resolve all mandatory components?   NO
```

- Alfa Crux: NO. The record exists, but at 105.2 km it is outside the 80 km
  route-scale domain, so it is not a candidate.
- SuperUco: NO. The record exists, but at 87.1 km it is outside the domain.
- Bodega Azul: NO. No record declares the source name; the "Bodega La Azul"
  probe is MULTIPLE, so AMBIGUOUS.
- (Other Uco components were not re-characterized here.)

Overture is useful generically, but it does not unblock this composite. More
importantly, this probe shows that 2 of the Uco composite's components lie
87–105 km from the destination centroid. Even a perfect identity source
cannot place them inside the current route-scale domain. The prior framing,
"no candidate even within the route-scale Places domain", was true for the
existing providers, but it hid a geographic-domain mismatch: an identity
source that does cover them puts them outside it.

## 13. One next task (P)

The next task is a read-only geographic-domain characterization/decision for
regional multi-component Experiences: should a source-declared regional
itinerary whose components lie beyond the destination-centered route-scale
radius be (a) out of scope for the destination, or (b) authorized through a
generic, Experience-anchored scope? Today's 80 km is centered on the
destination boundary centroid and is not derived from the Experience's own
declared region.

This decides whether any identity source can unblock the Uco composite.
`OVERTURE_IDENTITY` (explicit, bounded, candidate-only, traced,
license-aware, fail-closed, never a fallback) is worth designing after that.
Its smallest generic scope:

1. exact provider-declared-name lookup in the candidate's authorized
   geography;
2. multiplicity computed over the bounded Overture pool;
3. existing `buildLocalIdentityEvidence` + `IdentityVerifier` unchanged;
4. GERS id as a `GeoEntityIdentity`, with release and per-upstream
   attribution.

Official-domain corroboration stays a separate, later decision under the
safeguards in `../README.md`.

## 14. Behavior preservation (Q)

- No production identity change.
- No DB writes.
- No COLD and no WARM.
- No fallback.
- No hard-coded production fixture.
- `git diff -- be/src fe` is empty.

## 15. RW4 status (R)

```text
RW4 EXIT CRITERIA

[x] stable deep-source examination
[ ] real multi-component Experience persisted
[ ] WARM reuses it
[ ] RW4 CLOSED
```

next blocker = geographic domain of the route_like Uco composite: 2
mandatory components (Alfa Crux 105.2 km, SuperUco 87.1 km) lie outside the
80 km destination-centered route-scale domain, so no identity source,
Overture included, can supply them as candidates. Underneath that, the
existing providers still have a coverage gap.
