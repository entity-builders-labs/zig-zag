# RW4 — real "Valle de Uco" canonical AREA probe (2026-10-02)

Evidence for spec `2026-10-02-geographic-validation-authorization-review.md`
§P2-17 (S2 real Uco check). Not execution authority.

Question: can the existing canonical providers resolve a polygon for the
area the COLD #11 SolSalute source names ("If I were to plan a wine tasting
in Valle de Uco Itinerary for a friend")?

Queries (one request each, `countrycodes=ar`, `format=jsonv2`):

| File | Provider | Query | Result |
| --- | --- | --- | --- |
| `nominatim-valle-de-uco.json` | public Nominatim | `Valle de Uco` | 2 results, both `highway/residential` ways (Rivadavia, Mendoza; Rawson, San Juan), `place_rank` 26 |
| `nominatim-uco-valley.json` | public Nominatim | `Uco Valley` | 0 results |
| `local-nominatim-valle-de-uco.json` | local Argentina Nominatim (`localhost:8088`) | `Valle de Uco` | same 2 residential ways |
| `local-nominatim-uco-valley.json` | local Argentina Nominatim | `Uco Valley` | 0 results |

Verdict:

- Source-backed AREA hint: supported by the real source text; not emitted by
  the live COLD #11 extractor.
- Canonical polygon: NOT resolvable. No boundary/place area exists; even an
  OSM `place=region` would fall outside the existing area-scale rank band
  (13–25) used by destination, anchor and AREA-hint resolution.
