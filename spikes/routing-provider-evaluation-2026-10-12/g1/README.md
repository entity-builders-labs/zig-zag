# G1 — Geoapify production-use verification (task 28.6) — 2026-10-14

OpenSpec change `gap-driven-destination-knowledge`, design C16 (P-D1), task 28.6. An engineering and
product go/no-go record for the planned use of Geoapify. **This is not legal advice.** Every source
below is first-party (Geoapify) or the OSM Foundation, which licenses the underlying data. All were
accessed on 2026-10-14. Statements are summarized; quotes are kept short.

## Final status — CLOSED 2026-10-15: GO_WITH_REQUIREMENTS

Geoapify has explicitly confirmed (relayed by the owner, recorded 2026-10-15) that its API results
may be cached, stored and redistributed without retention restrictions. The confirmation names
geocoding data, Places API results and static-map outputs as examples. This vendor confirmation is
the authoritative evidence that closes G1 / task 28.6. It resolves the open item below
("Vendor confirmation"), so Geoapify is the initial production provider and the Valhalla-first
fallback is not triggered.

Requirements that still apply (implementation and compliance, task 28.7; not gates):
- show all required OpenStreetMap / provider attribution;
- keep the provider's attribution metadata with stored results where applicable;
- size the production Geoapify plan appropriately;
- document the cache, storage and redistribution rights;
- do not expose internal matrices or the cache unless the product intentionally requires it.

The rest of this file is the 2026-10-14 desk review, kept unchanged as history. Its verdict was
superseded by the confirmation above.

## 2026-10-14 desk review (historical)

**Verdict at the time: NEEDS_VENDOR_CONFIRMATION** (superseded 2026-10-15). Nothing found blocks the planned architecture. Geoapify
states in its own words that results may be cached and stored. That statement, however, sits in
marketing/FAQ text, not in the Terms and Conditions, and the Routing, Route Matrix and Map Matching
pages say nothing about it. Persistence of those results is the material term of this gate, so it
stays open until Geoapify confirms it in writing. If the confirmation turns out narrower, the
fallback is unchanged: Valhalla behind the same provider-neutral contracts (design C16).

## Intended use (what had to be checked)

- Server-side calls from the backend to Routing (per-pair legs), Route Matrix (bulk optimizer pair
  costs) and Map Matching (constrained traversal validation), for WALK, DRIVE and BICYCLE.
- Persisting planner-relevant results:
  - Tour snapshot legs (mode, seconds, meters, provider, API);
  - `ExperienceComponent` traversal timing and validated geometry;
  - a cross-request pair-cost cache;
  - recorded test fixtures (`spikes/**/fixtures/*_matrix_*.json`, the G2 dataset).
- Retaining provenance (provider, API, mode, retrieval time) for reproducibility.
- Showing provider and data attribution in the app.

## Sources

| # | Source | URL | Relevant statement (summary) |
|---|---|---|---|
| S1 | Geoapify Terms and Conditions (Version 5, last updated 2024-02-02) | https://www.geoapify.com/terms-and-conditions/ | A non-exclusive, non-transferable, non-sublicensable licence to use the services. The Free plan may be used commercially, in development and "with some limitations" in production. Usage limits are per plan; exceeding them may lead to suspension or overage charges. Requests may not be spread across accounts to fit cheaper plans, and usage metering may not be bypassed. "You must always provide OpenStreetMap attribution." Geoapify attribution is mandatory on the Free plan. "Different APIs may require additional attribution." **No clause on caching, storage, derived data, redistribution, server-side use or geometry retention.** Cyprus law; liability capped at 12 months of fees. |
| S2 | Geoapify home page, FAQ section | https://www.geoapify.com/ | "Geoapify lets you cache, store, and redistribute results according to our terms." FAQ "Can I cache and store API results?" — "Yes. Geoapify provides business-friendly terms that allow caching and storing results." Attribution "is provided as part of the result object". Free plan: add a "follow" link crediting Geoapify. The Free plan may be used commercially in production within its limits and with attribution. |
| S3 | Geoapify Pricing | https://www.geoapify.com/pricing/ | Free: 3,000 credits/day, 5 requests/s. Paid tiers from API 10 (10,000/day, $59/month) to API 250, plus unmetered Custom plans. Limits are "soft", without throttling. Commercial production use is confirmed, with attribution. The page says nothing on caching or storage. |
| S4 | Route Matrix API docs | https://apidocs.geoapify.com/docs/route-matrix/ | Cost = max(sources, targets) × min(sources, targets, 10) credits, so a 31 × 31 matrix costs 310 credits. Batch requests get a 0.5 multiplier. Up to 1,000 matrix cells per call. `time`/`distance` are `null` where no route exists. The page says nothing on caching, storage or attribution. |
| S5 | Routing API docs | https://apidocs.geoapify.com/docs/routing/ | 1 credit per waypoint pair, plus extras for details or elevation and per 500 km. Modes include `bicycle` (city bike), `road_bike` and `mountain_bike`. Results carry MultiLineString geometry. The page says nothing on caching, storage or attribution. |
| S6 | Map Matching API docs | https://apidocs.geoapify.com/docs/map-matching/ | max(1, ceil(waypoints / 100)) credits per request. Modes `drive`, `walk`, `bicycle`. Up to 1,000 points. Results carry GeoJSON route geometry. The page says nothing on caching, storage or attribution. |
| S7 | Geoapify API docs, navigation summaries | https://apidocs.geoapify.com/docs/places/ , https://apidocs.geoapify.com/docs/batch/ | "Cache/store results with no limits" appears for Places and Batch only, not for Routing, Route Matrix or Map Matching. |
| S8 | OSMF Attribution Guidelines (adopted 2021-06-25) | https://osmfoundation.org/wiki/Licence/Attribution_Guidelines | Applications that incorporate a routing engine must credit OpenStreetMap. Credit goes near the map, or where users expect it, as a link or with a way to reach the licence. Internal uses need no attribution. |
| S9 | OSMF Licence and Legal FAQ | https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ | Under ODbL a Produced Work needs attribution; share-alike applies to a Derivative Database on Public Use, and internal use is not Public Use. The FAQ gives no specific guidance on routing or geocoding caches. |

## Findings by question

| # | Question | Finding | Confidence |
|---|---|---|---|
| 1 | May API results be cached? | Yes per Geoapify's own FAQ and home page (S2). Not in the T&C (S1). | medium: first-party but non-contractual |
| 2 | May results be stored persistently? | Same as 1. "Store" is stated with no time limit (S2); "no limits" is stated per API only for Places/Batch (S7). | medium |
| 3 | Does storage differ by API? | No difference is stated for Routing, Route Matrix or Map Matching. The explicit "no limits" covers Places/Batch only. | low: silence, not permission |
| 4 | May derived data be stored? | Not addressed by Geoapify. The example of building your own address database from geocoding results (S2) suggests yes. ODbL governs OSM-derived databases (S9). | low |
| 5 | Limits on redistributing raw data? | Geoapify says results may be redistributed "according to our terms" (S2), but the T&C contain no redistribution clause. ODbL share-alike applies to a Derivative Database on Public Use (S9). We do not plan to publish raw matrices or the pair cache. | medium |
| 6 | Attribution required? | OpenStreetMap: always (S1, S8). Geoapify: mandatory on the Free plan, with a follow link on the website (S1, S2). Per-API extra attribution: "comply" (S1); it is provided in the result object (S2). | high |
| 7 | Where must attribution go? | Geoapify gives no exact placement beyond the follow link near the map (S2/S3 FAQ). OSMF: on or adjacent to the map, as a link or with a path to the licence; for routing without a map, an app-level credit (S8). | high for OSM; medium for Geoapify |
| 8 | Server-side use allowed? | Not stated explicitly anywhere. The services are HTTP APIs with key authentication, and nothing restricts the calling environment. | medium: not inferred as permission; part of the confirmation |
| 9 | Commercial use? | Allowed, including on the Free plan in production within its limits and with attribution (S1–S3). | high |
| 10 | Plan, key and rate considerations | Free plan: 3,000 credits/day at 5 req/s, so about nine 31-point matrices per day. Production needs a paid plan and/or the cache. Splitting requests across accounts is forbidden (S1). The matrix formula favours batching (S4). | high |
| 11 | Route Matrix terms differ from Routing? | Only in pricing (S4, S5). No storage or attribution difference is stated. | medium (silence) |
| 12 | Map Matching terms differ? | Only in pricing (S6). | medium (silence) |
| 13 | May route geometry be retained? | Covered only by the general "store results" statement (S2). Not stated per API. | medium |
| 14 | Must provider/source metadata be retained? | The attribution object comes with the results (S2). Our design already records provider, API, mode and retrieval time. The P11/G-P7-B recorders stored only time and distance, so the implementation must keep the attribution object. | medium |
| 15 | Conflict with catalog-first / planner snapshot? | None, provided 1–2 and 13 are confirmed. Snapshots shown to users are Produced Works under ODbL and need OSM attribution. A persistent pair cache used internally to plan is not Public Use (S9). | medium |

## Engineering implications (become tasks)

1. **Vendor confirmation (blocks group 41 wiring, not development).** Ask Geoapify for written
   confirmation that the FAQ caching/storage permission (S2) applies to Routing, Route Matrix and
   Map Matching under our plan, covering:
   - persistent storage, with no retention limit, of times, distances and geometry;
   - a cross-request pair-cost cache;
   - server-side use;
   - whether Tour snapshots shown to end users count as permitted redistribution.

   Record the answer and its date in design C16.
2. **Attribution (implementation task).**
   - Show "© OpenStreetMap" linking to openstreetmap.org/copyright wherever routes, legs or travel
     times computed by Geoapify are shown (Tour map and itinerary) and in an app "Data licences"
     entry.
   - Show Geoapify attribution (with a follow link on the web) while on the Free plan, and keep any
     per-API attribution returned in result objects.
   - Applies to web, iOS and Android.
3. **Provenance retention.** Persisted legs, pair-cache entries, traversal timings and recorded
   fixtures keep:
   - provider, API, mode and profile;
   - retrieval time;
   - the provider's attribution object, when present.
4. **Plan sizing.** Production uses a paid plan sized from measured credits per Tour, or relies on
   the pair cache. Matrices are batched where the 0.5 multiplier applies. No request splitting
   across accounts.
5. **No raw-data publication.** Do not publish matrices or the pair cache as datasets. If that ever
   changes, ODbL share-alike review comes first.

## Classification rationale

- GO is not possible: the material term (persistence of routing, matrix and map-matching results)
  rests on non-contractual FAQ text and silence in the API-specific pages.
- GO_WITH_REQUIREMENTS is the expected outcome once confirmation 1 arrives; requirements 2–5 apply
  in any case.
- BLOCKED is not warranted: no source prohibits the intended use, and commercial production use is
  explicitly allowed.

Development and spike recordings may continue under the FAQ statement. Production wiring (group 41)
waits for confirmation 1, or switches to Valhalla-first per design C16.
