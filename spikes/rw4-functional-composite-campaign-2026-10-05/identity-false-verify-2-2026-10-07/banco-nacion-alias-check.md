# Banco Nación: structured multilingual alias check (2026-10-07)

Question: does the correct candidate for the hint "National Bank"
(`osm:relation:3527701`) already carry a structured name or alias
EQUIVALENT to "National Bank", so retrieval could reach it without a
generated TRANSLATION?

Sources: local Overpass (tags), live read-only Wikidata, local Nominatim,
the real Buenos Aires POI pool (`lookupPoisWithin`, 2712 POIs). Places
was not called (quota). Grades use the production `nameCorrespondence`
and retrieval `hasSpecificNameOverlap`. Raw output:
`banco-nacion-name-correspondence.txt`.

## OSM `relation 3527701` names

| Tag | Value | vs "National Bank" |
| --- | --- | --- |
| name, name:es, brand, brand:es | Banco Nación | NONE |
| name:en, brand:en | Nation Bank | NONE |
| name:uk | Національний банк Аргентини | NONE |
| official_name, official_name:es | Banco de la Nación Argentina | NONE |
| official_name:en | Bank of the Argentine Nation | NONE |
| short_name | BNA | NONE |
| branch | Casa Central | NONE |
| alt_name, old_name, operator, wikipedia | absent | — |
| wikidata | Q5718167 (brand:wikidata Q2883376) | — |

## Wikidata

| Item | Field | Value | vs "National Bank" |
| --- | --- | --- | --- |
| Q5718167 (building) | label es | Banco de la Nación Argentina Casa Central | NONE |
| | alias es | Casa Central del Banco de la Nación | NONE |
| | **label en** | **National Bank of Argentina Headquarters Building** | **OVERLAP** |
| | aliases en | none | — |
| | enwiki | Headquarters of the Bank of the Argentine Nation | NONE |
| Q2883376 (bank) | label es / en | Banco de la Nación Argentina / Bank of the Argentine Nation | NONE |
| | aliases en | Banco de la Nacion Argentina, BNA | NONE |

Q5718167 has no official-name (P1448), native-label (P1705) or short-name
(P1813) claim.

## What each adapter sees today

| Adapter | Sees relation 3527701? | Why |
| --- | --- | --- |
| LOCAL_OSM_POOL | no | not in the 2712-POI tourism pool (`amenity=bank` is not kept). `matchOsmCandidateByName("National Bank")` finds nothing. |
| Nominatim | no | "National Bank" returns only the First National Bank of Boston. Even "Nation Bank", "Bank of the Argentine Nation" or "Banco Nación" return 50 other Banco Nación branches each, without this relation. |
| Places | not checked | quota; the query is the hint text "National Bank". |
| Wikidata evidence collector | no | it reads only the QID of an already acquired candidate, or items NEARBY one. Q5718167 is never reached. |

## Conclusion: NO_STRUCTURED_MULTILINGUAL_ALIAS_FOUND

No OSM tag and no Wikidata label or alias corresponds EQUIVALENTLY to
"National Bank". OSM's English name is "Nation Bank".

The only structured name that relates is Q5718167's English label, and
only at OVERLAP grade. OVERLAP is retrieval-only (§19.3): it can never
verify the record, and the same grade already links the hint to the
First National Bank of Boston.

Facts for the TRANSLATION evaluation:
- "Banco Nación" is a chain. Nominatim returns 50+ same-name branches in
  Argentina, and the city has many. A translated hint matching "Banco
  Nación" EQUIVALENTLY would meet MATERIAL_COMPETITOR_KNOWN unless
  something discriminates the head office (`branch=Casa Central`, the
  source's "headquarters"). Translation alone would retrieve the right
  family, not verify the right record.
- Even with that wording, the head office is not in Nominatim's top 50 for
  any of the four names. Retrieval would also need a query or window that
  reaches it.
