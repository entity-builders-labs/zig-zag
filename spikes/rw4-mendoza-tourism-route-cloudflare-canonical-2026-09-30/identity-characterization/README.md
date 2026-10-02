# RW4 identity characterization — Uco / Luján winery components (2026-10-02)

Diagnostic only. No production identity behavior changed, no COLD/WARM run,
no new provider, nothing persisted. Question answered: why the currently
enabled identity pipeline cannot establish canonical identity for the
components of the route_like-owned COLD #11 composites.

## Method

- `run-probe.sh` → `be/test/live/rw4-identity-characterization.live-spec.ts`:
  replays the two COLD #11 composites through the **real**
  `ExperienceProposalResolverService.resolve` with the **real** configured
  providers (local Nominatim/Overpass, Geoapify, Wikidata; same env as
  `run.sh`, `AI_CACHE_MODE=off`) and a **stub catalog** (no canonical reads,
  no writes), under the COLD #11 ROUTE_LIKE policy and under DEFAULT for
  contrast. Then runs bounded, source-justified query variants against
  Geoapify (with Place Details) and Nominatim. Fresh disposable DB; proof of
  no persistence: `db-after-probe.json` (all counts 0).
  Outputs: `resolver-replay.json` (full untruncated forensic audit incl.
  `identityEvidence`), `provider-probes.json`.
- `osm-wikidata-site-probe.cjs`: local Overpass name search in Mendoza
  province (tags), Wikidata `wbsearchentities` (es/en), and one GET of each
  official website the SOURCE hyperlinked (final URL, title, declared
  facts); one curl retry for failed fetches. Output:
  `osm-wikidata-site-probe.json`.
- Worksheets: `alfa-crux.json`, `superuco.json`, `bodega-la-azul.json`,
  `a16.json` (A16 added: the Luján composite resolved 1 of 2).

The replay reproduces COLD #11 exactly (same rejection reasons, ROUTE_SCALE
80 km Places scope on every attempt).

## Summary

| Component | Acquisition candidate? | Best candidate | Strong corroboration? | Current failure class | Likely missing capability |
| --- | --- | --- | --- | --- | --- |
| Alfa Crux | NO (all 5 strategies; source-justified variants too) | — | — | A coverage gap (+F: official page declares "Calle Los Indios s/n, El Cepillo, Valle de Uco") | an identity source that knows the entity; absent from OSM, Nominatim, Geoapify, Wikidata |
| SuperUco | NO | — | — | A coverage gap; H official site unreadable (403 bot challenge) | same; plus no accessible public facts |
| Bodega Azul | YES (Geoapify, only under ROUTE_SCALE) | Bodega La Azul, osm:node:4851595199, 73.2 km | NO | E verifier lacks corroboration; F source link to official domain not captured; H winery + "La Azul" restaurant at the same site | a strong identity fact connecting hint and candidate (provider exposes no website/alias/QID) |
| A16 (extra) | YES but wrong object | FC Belgrano (osm:way:48965326) | — (correctly REJECTED) | A coverage gap; B short alphanumeric query hits unrelated objects; F official site declares exact address | entity absent from providers |

Acquisition vs verification:

- Alfa Crux / SuperUco: **acquisition** fails (no candidate anywhere);
  verification never runs.
- Bodega Azul: **acquisition** succeeds (Geoapify returns "Bodega La Azul",
  viable only because the ROUTE_LIKE policy extends the search to 80 km;
  under DEFAULT it is OUTSIDE_DESTINATION_BOUNDARY). **Verification**:
  evidence present = only `WIKIDATA_IDENTITY_MATCH {source: NEARBY,
  hintMatched: false, candidateMatched: false}`; absent = EXACT_NAME,
  DECLARED_ALIAS_MATCH, ADDRESS_MATCH, IDENTITY_CONVERGENCE, Wikidata QID.
  Verdict REJECTED by IdentityVerifier rule 4. Nominatim "Bodega Azul" found
  a different object (Azul, Buenos Aires, ~929 km).
- A16: acquisition returns a wrong object; verification REJECTED it (correct).

## Bodega Azul vs Bodega La Azul

- Source: `[Bodega Azul](https://bodegalaazul.com/)` "for lunch".
- Official site: title "Bodega La azul", "Nos encontramos en Tupungato".
- OSM `node/4851595199` "Bodega La Azul" (craft/shop=winery, tourism=
  attraction): **no website, no alias, no wikidata, no address tags**.
  `node/5792963498` "La Azul" (restaurant) ~20 m away.
- Geoapify Place Details: `websiteUri` absent, phone absent; only the OSM
  identity is declared.
- SAME identity is plausible but **not strongly establishable** with the
  facts any enabled source exposes. Even with official-domain correlation,
  the provider side has no domain for this node.

## Secondary findings (not blockers)

1. **Absence of Wikidata corroboration is encoded as REJECTED.** When the
   nearby Wikidata search completes and no item matches (no Wikidata item
   exists for these wineries), the collector emits
   `WIKIDATA_IDENTITY_MATCH(false, false)` and the verifier rejects. This
   conflicts with "unknown is first-class" and the 2026-09-22 amendment
   ("a missing/non-matching Wikidata corroboration is not by itself positive
   evidence that the candidate is wrong"). Without it the verdict would be
   INSUFFICIENT_EVIDENCE — still unverified, so it is a diagnosis defect,
   not the blocker.
2. **Source hyperlink targets are dropped at extraction.** `GeoEntityHint`
   has no URL/official-site field; only the verified text span survives,
   which contains the markdown link.
3. Geoapify text search with a generic prefix ("Bodega X") returns the
   nearest generic "Bodega …" objects, so prefix variants do not help.

## Official-domain equality as future IdentityEvidence: CONDITIONAL

Viable in principle (it is an entity-declared fact, not a string
similarity), but **not usable today** (neither side is captured: hints drop
link targets; the provider exposes no website for this node). Observed
counterexample: Alfa Crux's source link is a page on the **group** host
`agostinowinegroup.com`, which is also the OSM website of a *different*
winery (Finca Agostino, Maipú). Host equality would mis-identify. Required
safeguards before it could ever count:

1. Link target is captured as a typed fact at extraction, anchored to the
   component (link text == the component's own source name), never the
   article's own domain.
2. Redirects resolved; compare final registrable domain; reject tracking/
   shortener, social, booking/aggregator, marketplace and hosting-platform
   hosts.
3. Domain must identify exactly one candidate within the search scope (a
   group/chain domain shared by several provider objects is not identity);
   path-scoped pages on a shared host (`/alfa-crux-wines`) never match a
   homepage-level website.
4. Provider website must be provider-declared for that same object (not
   inferred), and multiplicity semantics mirror EXACT_NAME (SINGLE →
   verifiable, MULTIPLE → AMBIGUOUS).
5. Combined with destination compatibility under the candidate's policy;
   never overrides a contradicting strong identity.

## First causal identity blocker

first causal identity blocker = identity acquisition coverage: Alfa Crux and
SuperUco have no candidate in any enabled identity source (local OSM,
Nominatim, Geoapify, Wikidata), so the Uco composite cannot complete
regardless of verifier corroboration.

## Recommended next task (one)

Identity-source coverage check with the **existing** Google Places adapter
(`PLACES_PROVIDER=google`, already implemented and keyed, not the canonical
production selection): rerun this same harness with that one setting changed,
for these same components, within the small Google searchText quota. If
Google covers Alfa Crux / SuperUco / A16 with declared websites, the next
fix is an identity-source selection decision (product/config) and,
separately, official-domain corroboration under the safeguards above. If it
does not, RW4 cannot close on this Uco composite with available map data,
and the RW4 target composite should be reconsidered (product decision).

## Follow-up: Google gates (2026-10-02)

See `google/assessment.md`. Google Places failed the **legal gate** for a
canonical identity source (names/addresses may not be saved, coordinates
max 30 days and never input to point-in-polygon analysis, no use with
non-Google maps; only the Place ID may be stored). Zero live Google calls.
The recommended Google coverage probe above is therefore superseded by a
coverage check of an openly licensed POI dataset (Overture Maps Places).

## Follow-up: Overture Places coverage (2026-10-02)

See `overture/assessment.md`. Release 2026-09-23.1, read-only DuckDB probe
over the COLD #11 route-scale domain. Overture has records for Alfa Crux and
SuperUco, but they lie at 105.2 km and 87.1 km, outside the 80 km domain.
"Bodega Azul" is declared by no record ("Bodega La Azul" is MULTIPLE), and
"A16" has no exact match (fails closed). Verdict PARTIAL_VALUE. Overture
alone does not unblock the Uco composite; the next blocker is the composite's
geographic domain.
