# RW4-ID-SOURCE-GROUNDING-1: can "associated with Plaza de Mayo" be verified? (2026-10-07)

Owner authorized source grounding (adjacent atom / anaphora, typed and with
provenance). Before implementing, this checks whether identity could verify
the canonical assertion `National Bank -> associated with Plaza de Mayo`
against structured candidate facts, with no new distance threshold.
Sources: local Overpass, local Nominatim, live read-only Wikidata.

## Target

- "Plaza de Mayo" has about 30 same-name OSM records in one block: the park
  (`relation 17076039`, `leisure=park`, Q1126357), the subway station
  (`node 3449235015`, Q3232735), and stop positions, platforms and stop
  areas.
- C3 left it AMBIGUOUS in all three oracle composites.

## Candidates against the park polygon (data only, not a rule)

| Building | Min vertex distance | Shares nodes |
| --- | --- | --- |
| Catedral Metropolitana `way 265344159` | 15 m | no |
| Banco Nación `relation 3527701` (correct) | 22 m | no |
| Cabildo `way 293947112` | 24 m | no |
| Casa Rosada `way 185738988` | 29 m | no |
| Edificio First National Bank of Boston `relation 9254658` (C3 false VERIFIED) | 159 m | no |

## Threshold-free relations examined

- Canonical area relation (`classifyComponentAreaRelation`): every
  building is OUTSIDE the park. The distance is recorded as data; there is
  no NEAR or ADJACENT tolerance in the codebase.
- OSM topology: no building shares a node with the park; a street lies
  between them.
- Street frontage: First National Bank of Boston resolves to Avenida
  Presidente Roque Sáenz Peña (Diagonal Norte), which starts at the
  square. A "fronts a street touching the target" rule would SUPPORT the
  false candidate.
- Administrative containment (Wikidata P276):
  - Banco Nación and First National Bank of Boston: both San Nicolás.
  - Catedral and Cabildo: Monserrat.
  It does not separate the correct candidate from the false one.
- Wikidata: no P276/P669/P706/P361/P47 claim links any of these buildings
  to Plaza de Mayo. Q5718167 is `P361` Banco de la Nación Argentina;
  Q5818109 is labeled "ICBC Argentina headquarters".
- The existing Wikidata confirmation radius (200 m) does not separate them
  either (159 m < 200 m), and reusing it would be a threshold borrowed for
  a new meaning.

## Conclusion

The fact that separates Banco Nación (22 m) from First National Bank of
Boston (159 m) relative to the square is a distance. Any cut between about
30 m and 159 m works, and every such cut is a new threshold.

**BLOCKED_BY_MISSING_DISCRIMINATING_EVIDENCE.** A typed assertion would
reach identity as UNVERIFIABLE and change no decision. Treating an
unverifiable assertion as negative contradicts §19 ("an ungrounded
locality is missing evidence, not a contradiction") and would degrade
accepted resolutions whose sources carry unverifiable context.

A threshold-free primitive that could separate them, not built (needs
owner authorization as a new geographic relation): city-block adjacency.
Polygonize the street network; a building is "on" a square when its block
shares a street with the square's block. It also needs the target resolved
to the park among its homonyms.

## Correct candidate retrieval

`relation 3527701` "Banco Nación" corresponds NONE to "National Bank". No
current path acquires it:
- local pool fuzzy retrieval;
- Nominatim, Places (query is the hint text);
- the atomized path has no TRANSLATION normalization.
This is a retrieval deficiency, separate from identity.
