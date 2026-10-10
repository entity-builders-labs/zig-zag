# GURUWALK-STRUCTURED-TOUR-1 — GuruWalk as a source of explicitly defined tour Experiences

- Date: 2026-10-09
- Branch: `feat/preference-first-selection` (analysis only; no production code changed)
- Preflight: `scripts/agent-preflight --allow-dirty` → WRITE AUTHORIZED / INTEGRATION READY
  (only dirty state = untracked spike artifacts from another session, left untouched)

## Verdict

```text
GURUWALK_STRONG_STRUCTURED_PROVIDER   (scope: free_tour listings only)
```

| Question | Answer |
|---|---|
| CAN_REPLACE_GENERIC_WEB_FOR_EXPERIENCE_EXISTENCE | **YES** |
| CAN_REPLACE_GENERIC_WEB_FOR_COMPOSITION | **PARTIALLY** |
| LLM_REQUIRED_TO_DISCOVER_EXPERIENCE | **NO** |
| LLM_REQUIRED_TO_EXTRACT_MEMBERS | **NO** for free tours (43/46 BA have a usable member list). **YES** for paid `product` listings (prose only). |
| SAFE_TO_DESIGN_PRODUCTION_ADAPTER | **YES**, but only for a provider-owned adapter that displays, links and books. It is **not** safe to design one that copies itineraries into Zig-Zag's own catalog (rights unknown, §7). |

Why "strong" and not "textual": the official MCP returns `itinerary` as a
distinct, ordered, machine-readable array of member titles. Members are read
directly from it, not extracted from prose. Why the scope and the PARTIALLY:

1. Only `free_tour` has `itinerary`. Paid `product` listings (141 BA city
   tours) return prose, `highlights` and a meeting point, so they are
   DESCRIPTIVE_ONLY or TEXTUAL.
2. Members are bare strings. The MCP returns no per-stop coordinates, ids,
   descriptions or types, even though the platform stores them (§4).
3. Member quality is guide-authored. Area-level members ("San Telmo",
   "Montserrat") sit next to POIs, and stops can be street corners, addresses
   or annotated entries ("London City, Confitería. Ingreso opcional").
4. Only the guide's authoring language is trustworthy. Translated itineraries
   are lossy, with substitutions and duplicates (§3).
5. `position` order is authored order. It is a walking sequence in some tours
   (56186) and not in others (63551, 62981), so it must not automatically
   set `orderedByEvidence`.

## 1. Access surface

| Item | Finding |
|---|---|
| Interface used | Official public MCP `https://back.guruwalk.com/mcp`: Streamable HTTP, protocol `2025-06-18`, server `guruwalk 1.0.0`. Advertised in `llms.txt` and `/.well-known/ai-catalog.json`. |
| Auth | **None** for the public "walkers" server. A separate affiliate server (`/mcp/affiliates`) requires an API key and was not used. |
| Machine-readable | Yes. Every tool returns `structuredContent` and declares an `outputSchema` (`raw/mcp/tools-list.json`). |
| Tools | `search_tours_activities_by_destination`, `get_tours_activities_by_category`, `get_product_detail` (≤10 per batch), `get_product_availability` (≤20 per batch, ≤5-day window), `show_tours_activities` (UI widget), `get_support_guide` |
| Languages | Only `en`, `es`, `de`, `it`. Any other value falls back to `en`. |
| Limitations | (a) **Pagination is capped at page 3** (12 per page). BA free tours report `total_count: 59`, but pages ≥4 repeat page 3. Taking the union over 4 languages reached **46/59**. (b) Destination input is fuzzy and fails silently: `destination:"San Telmo"` returned **Saltillo, Mexico**, not `coverage:none`. Zig-Zag must pass a resolved city, never a neighbourhood. (c) `text` filtering narrows paid products only. (d) No rate limits were documented or hit (about 40 calls). |
| Attribution | Every URL carries `?ref=4919gdnlcf1ajvqq5mig&ref_campaign=<tool>`. The schema says: "never rewrite the domain or drop query parameters, they carry required attribution." This is GuruWalk's public-channel ref, not a Zig-Zag credential. |
| Web pages | Fetched only 4 public tour pages, to establish whether missing fields were absent from the platform or dropped by the interface (§4). Not proposed as an integration path. |

## 2. Buenos Aires coverage

- **Totals:** 607 BA listings across all categories. Free tours: 59 reported,
  46 reachable. "City Tours & Sightseeing" (paid): 141. 11 categories in all.
- **Target relevance (46 reachable free tours):** 31 match the target areas:
  15 historic centre, 11 Recoleta/Retiro, 5 San Telmo/Monserrat, 2 La Boca.
  29 distinct guides.
- **Duration:** median **135 min**, range 60–210 (free tours).
- **Composition:**
  - Usable source-language member list (≥3 distinct members, no prose-list
    member): **43/46** overall, **30/31** in the target set.
  - Description-only: **2** tours have an empty `itinerary` (46563, 52891).
  - Not usable: **1** (49463, whose itinerary is two entries, one a
    comma-joined prose sentence).
- **Full table:** `analysis/ba-coverage-table.md` (all 46 tours, with URLs).

Representative target tours:

| id | title | dur | stops (es) | coords? | resolver has enough hints? | LLM needed? |
|---|---|---|---|---|---|---|
| 56186 | Discover San Telmo: A Journey Through Time | 165 | 16 | meeting point only (MCP) | Mostly. Named POIs plus meeting-point locality. Weak: "MAFALDA", "Antigua Casona de fines del siglo XIX" (es) vs "Defensa 1344" (en) | No |
| 63551 | Buenos Aires Origins: San Telmo and Monserrat | 165 | 12 | meeting point only | Partly. "Montserrat" and "San Telmo" are AREA members; "Plaza Dorego" is a typo | No |
| 51609 | San Telmo essential free tour | 120 | 10 | meeting point only | Partly. "mafalda", "Feria Artesanos Calle defensa 150 San Telmo", HTML entity leak in `en` | No |
| 55661 | Welcome to Buenos Aires! Essential Tour | 150 | 8 | meeting point only | Yes in `es`. In `en`, Cabildo becomes "Buenos Aires City Council" (wrong referent) | No |
| 54972 | La Boca: Tango, Art, and Football | 150 | 8 | meeting point only | Yes in `es`. `en` lost two stops and duplicated two others | No |
| 53227 | Tour La Boca: Memories of a Working-Class… | 120 | 9 | meeting point only | Yes; "Caminito" is a street/area | No |
| 62981 | Powers and Loves in the Recoleta Cemetery | 105 | 9 | meeting point only | No for tombs. They are sub-venue members inside one cemetery; `en` drops Evita's vault | No |
| 45349 | Retiro and Recoleta: Aristocratic Buenos Aires | 150 | 11 | meeting point only | Yes | No |

## 3. Data contract (`get_product_detail`, `free_tour` unless noted)

| Field | Availability | Example |
|---|---|---|
| tour id | STRUCTURED | `id: 56186` |
| title | STRUCTURED, per language. Can be machine-translated badly ("WITHDRAWAL" for *Retiro*) | `name` |
| canonical / booking URL | STRUCTURED (`url`, `attribution`; `booking_url` on availability) | `https://www.guruwalk.com/walks/56186-…?ref=…` |
| city / destination | STRUCTURED | `place: {id: 421, name: "Buenos Aires", country: "Argentina"}` |
| guide / provider | STRUCTURED (name only, no id) | `guide.name: "Buenos Aires Horizon Tours "` |
| tour type | STRUCTURED | `type: free_tour \| product` |
| categories / themes | STRUCTURED at category level (`categories[]`, vertical ids). No per-tour theme tags | `67114 City Tours & Sightseeing` |
| language | STRUCTURED | `available_languages: ["en","es","pt"]` |
| duration | STRUCTURED. Format differs: free tours return `"2:30"`, products return `duration_minutes` | `"2:45"` |
| meeting point | STRUCTURED plus TEXT (`how_to_find_me`; products: `meeting_point_html`) | "front of the Pirámide de Mayo, yellow umbrella" |
| meeting-point coordinates | STRUCTURED (free: `meeting_point_latitude/longitude`; product: `where.latitude/longitude`) | `-34.60847, -58.3722367` |
| end point | NOT_AVAILABLE (sometimes stated in prose) | — |
| availability / schedule | STRUCTURED (`get_product_availability`: date, start_time, language, seats) | — |
| description | TEXT_ONLY (`description_html`) | — |
| itinerary / route | **STRUCTURED** for free tours (`itinerary: string[]`). NOT_AVAILABLE for products | see §4 |
| ordered stops | STRUCTURED array order = authored `position` (web shows gaps such as 1 and 9 missing). Walking-sequence meaning is not asserted | — |
| stop names | STRUCTURED (title strings) | "Mercado de San Telmo" |
| stop descriptions | NOT_AVAILABLE in MCP. The docs say "no descriptions", yet the platform has them (web `pois[].description`) | — |
| stop coordinates | NOT_AVAILABLE in MCP (present in web `pois[].latitude/longitude`) | — |
| stop duration | NOT_AVAILABLE | — |
| optional stops | NOT_AVAILABLE as a field. Only as free text inside a title (1 case, 65736 "Ingreso opcional") | — |
| alternative / substitute stops | NOT_AVAILABLE | — |
| free-text route description | TEXT_ONLY (15/46 descriptions contain route/highlight wording) | 55661 "Route Highlights" `<ul>` |
| reviews | STRUCTURED aggregate (`reviews.count`, `reviews.rating`). Review texts may be included; not used | `592, "4.92"` |
| rating | STRUCTURED (string on free tours, number on products) | `"4.92"` |
| images | STRUCTURED (URL list) | `media.guruwalk.com/…` |
| commercial / affiliate metadata | STRUCTURED (`ref`/`ref_campaign` in URLs, `source: "GuruWalk"`, products have `pricing_from`) | — |

### Language-projection defect (applies to all cities)

For the same `product_id`, `itinerary` arrays always have the same length
across languages, but content can diverge by position:

- 54972 La Boca: `en` replaces "Mural Maqueta…" and "Casa Amarilla" with
  duplicates of later stops.
- 62981 Recoleta: `en` drops "Bóveda de Eva Duarte de Perón" and "Mausoleo de
  la familia Leloir", and duplicates neighbouring entries. The public `en` web
  page shows the same defect.
- 64119: `en` drops "Centro Cultural Mercedes Sosa" and "Humberto Primo 355".
- Madrid 33767: `en` swaps "Puerta de Toledo" for a different place and turns
  "Plaza de la Villa" into "Town Square".
- 55661: Cabildo becomes "Buenos Aires City Council", a wrong referent.

**Rule for any adapter:** read members only in the guide's authoring
language. Never use a translated itinerary as identity evidence.

## 4. Composition evidence (representative; lossless fixtures in `normalized/`)

The fixtures merge MCP `en`, MCP `es` and the web `pois` for comparison.

| Tour | Classification (MCP) | Members / ordering | Coordinates | LLM? |
|---|---|---|---|---|
| **56186** San Telmo | STRUCTURED_COMPOSITION | 16 ordered titles. The authored order is a walking route: path 1,931 m vs greedy nearest-neighbour 1,841 m (×1.05), running south to north from Parque Lezama to Mafalda. | MCP: meeting point only. Web: per-stop. | No |
| **63551** San Telmo + Monserrat | STRUCTURED_COMPOSITION, with AREA members mixed in | 12 titles. Order ×1.94 vs greedy, distorted by area centroids ("Montserrat", "San Telmo") and Basílica Santa Rosa de Lima 2 km west. Not a usable sequence. | as above | No |
| **62981** Recoleta Cemetery | STRUCTURED_COMPOSITION of sub-venue members | 9 tomb titles. In the platform model, **four distinct tombs share one `poiId` (34737) and identical coordinates**, so `poiId` is not identity. "Dr. Francisco J. Muñiz" is pinned about **31.8 km** from the meeting point (wrong pin). | as above (pins unreliable) | No |
| Paid 162994 San Telmo Food Tour | TEXTUAL_BUT_EXPLICIT_COMPOSITION ("4 iconic stops … Begin at the legendary Mercado San Telmo …") | prose only | `where` (start) only | Yes, bounded extraction |
| Paid 84836 Highlights | DESCRIPTIVE_ONLY (neighbourhoods; transport included) | prose | start only | Yes, and weak |

What the platform holds but the MCP drops (web `pois[]`): `poiId` (shared
catalog POI), `type` (`outside_visit` / `free_ticket` / `ticket_not_included`),
`position`, `title`, `description`, `latitude`/`longitude`. Even that model
only gives guide-picked pins, not verified identities: shared `poiId`s across
distinct members and wrong pins were both observed.

## 5. Zig-Zag mapping (tour 56186; no code changed)

| GuruWalk | Zig-Zag concept | Current type sufficient? |
|---|---|---|
| Tour `id`, `url`, `ref`, `source` | provider provenance | **Partly.** `ExperienceEvidence {source, url, title, snippet}` can hold a URL. There is no typed external-provider identity on `Experience` (`metadata Json?` must not carry it, per AGENTS.md typed-contract rule). **New:** a typed `ProviderListingRef {provider, externalId, url, attributionParams}` at the adapter boundary. |
| Tour existence | source-defined Experience | **No typed home.** `ExperienceCandidate` has no "provider-asserted existence" fact. Its existence today is LLM/grounding-derived (`evidenceKeys`, `shortReason`). **New:** an existence-provenance fact, e.g. `PROVIDER_LISTING` vs `WEB_EXTRACTED`. |
| `itinerary[i]` (es) | `GeoEntityHint {key, name, sourceName, role, expectedKind, evidenceKeys}` → `ExperienceComponent {sourcePosition: i, sourceName}` | **Mostly yes.** `sourcePosition` and `sourceName` already model source-declared members, including unresolved ones (`UNRESOLVED` + reason). `role`/`expectedKind` cannot be read from GuruWalk because no type is exposed, so they must stay unknown rather than defaulted. That conflicts with `GeoEntityHint` requiring both. **Gap:** `role`/`expectedKind` need an explicit unknown, or the adapter must not author them. |
| `itinerary` order | `orderedByEvidence` / `ExperienceComponent.order` | **Yes, with policy.** Store `sourcePosition` always. Set `order` only if a policy accepts provider-authored itinerary order as sequence evidence. 63551 shows it is not always a route, so the safe default is `order: null`. |
| `duration "2:45"` | `ExperienceCandidate.suggestedDurationMinutes` / `Experience.durationMinutes` | **Yes**, after deterministic parsing at the adapter (`h:mm` → minutes). |
| meeting point lat/lon + `how_to_find_me` | logistics metadata | **No.** `Experience.latitude/longitude` would be misread as the Experience location. **New:** a typed `MeetingPoint {lat, lon, instructions}` and, if needed, an end point. It can serve as a locality anchor hint for resolution, never as component coordinates. |
| `reviews.count/rating` | `QualityEvidence` (`RatingEvidence {value, reviewCount}`) | **Yes** (the 0..5 scale matches), populated at the adapter. |
| guide name | provider/operator | **No** typed field. Needed only for display/attribution. |
| availability, booking URL | product (non-catalog) data | **No, and should not be catalog data.** Fetch live; never persist as Experience truth. |
| `SourceObservation` | — | **Not sufficient.** It is single-subject, with no member list. A composite provider listing needs its own typed observation, e.g. `ProviderTourListing {members: ProviderTourMember[]}`. |

## 6. Failure-mode comparison vs generic web acquisition

| Failure mode | Generic web | GuruWalk free tour |
|---|---|---|
| False Experience detection | LLM decides | **Disappears.** The provider asserts the tour. |
| Source relevance ambiguity | Arbitrary page selection | **Disappears.** One listing = one Experience; destination is structured. Caveat: city-level only, and fuzzy destination input can silently mis-resolve (Saltillo). |
| Generic noun atomization | LLM splits prose into "members" | **Mostly disappears.** Members are pre-split by the guide. Remains: area-level members ("San Telmo"), generic labels ("mafalda", "Chile & Defensa"), addresses. |
| Member ordering ambiguity | Inferred | **Reduced.** Explicit `position`, but not guaranteed to be a walking sequence. |
| Alternative-variant merging | LLM merges or splits variants | **Reduced but present.** Each listing is a distinct variant. Same-named free and paid variants exist (free 56186 vs paid 162513 "Discover San Telmo: A Journey Through Time"), and many near-duplicate "historic centre" tours exist from different guides. Do not dedupe across listings by title. |
| Identity ambiguity | High | **Remains.** Titles are guide-chosen labels, typos ("Plaza Dorego") and translations are unreliable, and the MCP gives no stop coordinates or ids. Platform `poiId` is not identity-safe. Full GeoEntity resolution is still required. |
| Provider ownership / rights | Unclear, usually ignored | **Becomes explicit:** GuruWalk/guide-owned, attribution and `ref` required (§7). |

## 7. Usage-rights assessment

The primary sources are GuruWalk's terms (`raw/docs/terms_policy-en.txt`,
whose Spanish version governs), the MCP docs and the affiliate README.

- **Technical accessibility:** public, unauthenticated, read-only MCP,
  advertised for AI agents. No MCP-specific terms of use were found.
- **Content ownership:** "GuruWalk will not own any content that you post as
  a guide". Guides grant GuruWalk a free, worldwide licence to publish,
  modify, compile and exploit it. **Nothing found grants that licence onward
  to third parties.**
- **Affiliate terms:** "The Affiliate shall use the promotional material
  solely and exclusively to direct its visitors and/or customers to the
  GuruWalk Website."
- **MCP output:** requires keeping `ref` intact, and every result carries
  `attribution: "Book on GuruWalk: <url>"`.
- **Classification:** **BOOK_VIA_PROVIDER** (with ATTRIBUTION_REQUIRED) for
  display, link and book. **UNKNOWN_REQUIRES_PERMISSION** for copying an
  itinerary into a provider-independent Zig-Zag Experience.
- No legal conclusion is drawn beyond this. The terms are silent on
  third-party reuse of guide content obtained via the MCP.

## 8. Recommended integration model

**Provider-owned Experience adapter** (a COMMERCIAL_PROVIDER_OWNED Experience,
not OWN_CATALOG):

- Zig-Zag recommends, displays, links and books via GuruWalk with the `ref`
  preserved. It does not copy the itinerary into a provider-independent
  Composite Experience.
- Resolving members to existing GeoEntities is still valuable, for
  planner feasibility and to show "this tour covers X, Y, Z". The provider
  listing stays the authority for the tour's existence and composition.
- Never use a translated itinerary as identity evidence.
- Becoming a source-defined Composite Experience adapter for Zig-Zag's own
  catalog requires written permission from GuruWalk. It would also benefit
  from asking GuruWalk to expose `pois[]` (coordinates, type, description) in
  the MCP; the alternative is scraping, which this spike does not recommend.

## Out of scope / untouched

The GuruWalk provider is not implemented and production behaviour is
unchanged. PF-FINAL-ID-GENERIC-NOUN-1, RW4-EXTRACT-STABILITY-1 and
verifiedHint provenance are untouched. The OpenSpec track was not activated.

## Reproduce

```bash
cd spikes/guruwalk-structured-tour-2026-10-09
python3 analysis/analyze.py        # metrics over raw/mcp/ba-detail-free-*.json
python3 analysis/normalize.py      # normalized/tour-*.json + analysis/ba-coverage-table.md
python3 analysis/order_check.py    # route-order check (analysis/order-check.txt)
python3 analysis/extract_web_pois.py raw/web/walk-56186-es.html
# re-capture any call with the bundled stdlib-only MCP client:
OUT=x.json python3 analysis/mcp_client.py tools/call \
  '{"name":"get_product_detail","arguments":{"items":[{"product_id":56186,"type":"free_tour","language":"es"}]}}'
```

The raw MCP JSON-RPC responses are in `raw/mcp/`; the tool schemas are in
`tools-list.json`. Re-capture with any MCP client against
`https://back.guruwalk.com/mcp` (no auth).

- `raw/docs/`: llms.txt, ai-catalog, MCP docs, terms, affiliate README.
- `raw/web/`: 4 public tour pages (characterization only).
