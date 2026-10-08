# RW4-ID-FALSE-VERIFY-2: identity convergence forensic (2026-10-07)

The canonical C3 run `../c3-idretry2-cold/` (HEAD `11776382`) persisted two
false VERIFIED identities by `GROUNDED_CONVERGENCE`:
- "Club Atlético" as `osm:way:23634484`, Club Atlético San Lorenzo de
  Almagro - Sede Boedo;
- "National Bank" as `osm:relation:9254658`, Edificio First National Bank
  of Boston.

The rules are in spec amendment §19.5. C3 was not run for this work.

## Files

| File | Content |
| --- | --- |
| `source-to-identity-forensic.json` | Both cases from the trace: atoms with their source text, the segment member, the source-support audit and every identity attempt with its decision. |
| `local-provider-probe.txt` | Local Nominatim and local Overpass only: the wrong records, the correct records and their tags. |
| `mutation-results.txt` | Failing tests under each mutation. |

## Source → identity

| Transition | Club Atlético | National Bank |
| --- | --- | --- |
| Source | "Walk up to Avenida Paseo Colon and take a right turn. Under the bridge, you see you a memory of “Club Atlético. It was a clandestine center of detention, torture and extermination ..." | "Plaza de Mayo. This historic place is surrounded by **Casa Rosada** ..., **Museo del Cabildo**, and the headquarters of the **National Bank**." |
| Atoms | `a-066` ROUTE_LEG (Paseo Colon), `a-067` ITINERARY_STOP (entity 4586–4599), `a-068`/`a-069` NON_ITINERARY | `a-003` (Plaza de Mayo), `a-004` ITINERARY_STOP with four entities (National Bank 320–333) |
| Segment member | `m-16`, PLACE, provenance `a-067` only; Paseo Colon only in `routeLegs` | `m-5`, PLACE, provenance `a-004` |
| Hint | name, role, expectedKind, evidenceKeys, supportSpan "Club Atlético" | name, role, expectedKind, evidenceKeys, supportSpan "National Bank" |
| Identity context | none (no locality, kind or address assertion) | none |
| LOCAL_OSM_POOL | Club Atlético Atlanta, INSUFFICIENT | no candidate |
| NOMINATIM | San Lorenzo `osm:way:23634484`, INSUFFICIENT | First National Bank of Boston `osm:relation:9254658`, INSUFFICIENT |
| PLACES (Geoapify) | same OSM way via Place Details, VERIFIED `GROUNDED_CONVERGENCE` | same OSM relation, VERIFIED `GROUNDED_CONVERGENCE` |
| Decisive evidence | convergence (prior NOMINATIM), NO_MATERIAL_COMPETITOR (0), BOUNDED_ADMISSION_SCOPE | same |
| Name correspondence | OVERLAP | OVERLAP |

Context is lost at two boundaries:
1. Atom labelling: `LabelledEntity` has no slot for an identity assertion.
2. Atomized mapping: `buildAtomizedRawCandidates` writes no component
   assertion.

Under the canonical §19 rule (one statement names both the component and
the fact), none of the context is a component assertion: Paseo Colón is in
another sentence, Plaza de Mayo is an anaphor, the bridge is unnamed, and
the description is in later NON_ITINERARY atoms that start with "It". On
this data no threshold-free consumer could use them either. That change
needs an owner decision (RW4-ID-SOURCE-GROUNDING-1).

## Correct candidates

- Club Atlético: `node 3158482730` "Club Atlético",
  `abandoned:amenity=prison_camp`, `wikidata=Q5821445`. Not in the local
  POI pool (no kept tag) and not returned by the local Nominatim.
- National Bank: `relation 3527701` "Banco Nación", Bartolomé Mitre 326,
  `wikidata=Q5718167`. Its name corresponds NONE to "National Bank".

Neither can verify. Not VERIFIED is the correct outcome.

## El Zanjón and Farmacia la Estrella

| | El Zanjón de Granados | Farmacia la Estrella |
| --- | --- | --- |
| Strategies | LOCAL_OSM_POOL + NOMINATIM | NOMINATIM + PLACES (Geoapify Place Details) |
| Identity | `osm:node:9953027884` | `osm:node:3348573778` |
| Evidence origins | openstreetmap / osm:node:9953027884, twice | openstreetmap / osm:node:3348573778, twice |
| Independence | SHARED_ORIGIN (2 adapters, 1 origin) | SHARED_ORIGIN (2 adapters, 1 origin) |
| Name | OVERLAP ("... (historic ruins)") | OVERLAP ("Farmacia de la Estrella") |
| Geography | BOUNDED_ADMISSION_SCOPE | BOUNDED_ADMISSION_SCOPE |
| Competitors | NO_MATERIAL_COMPETITOR | NO_MATERIAL_COMPETITOR |
| Decisive before | the convergence | the convergence |
| After | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |

These are the same facts as National Bank. Keeping them VERIFIED would need
a lexical exception, which §19.3 forbids.

## VERIFIED rules (after)

| Rule | Decisive evidence | OVERLAP can participate? | Competitor requirement | Source grounding | Independence | Regression tests |
| --- | --- | --- | --- | --- | --- | --- |
| STRUCTURED_ROUTE | one destination-compatible cluster of OSM ways | no (Overpass exact `name=`) | MULTIPLE_CLUSTERS → AMBIGUOUS | none | n/a | verifier spec, route specs |
| CATALOG_ROUTE_VARIANT | catalog route variant, SINGLE | no | MULTIPLE → AMBIGUOUS | none | n/a | verifier spec |
| CATALOG_VERIFIED_HINT | exact hint key remembered after an earlier VERIFIED, SINGLE | no; inherits the earlier decision | MULTIPLE → AMBIGUOUS; locality contradiction first | locality contradiction | n/a | place-cutover hint memory |
| CONTEXTUAL_CORRESPONDENCE | grounded locality singles out one member of an exact-name/alias pool | no (exact-name pools) | an equally consistent member → AMBIGUOUS | locality, kind | n/a | contextual identity suites |
| SOURCE_DECLARED_IDENTITY | candidate carries the source's QID | no name involved | none (discriminating) | source QID | n/a | trust 3, verifier spec |
| ADDRESS_MATCH | source addressHint street + housenumber equal to the candidate's tags | candidate retrieval may be fuzzy; the address decides | none (discriminating) | source address | n/a | trust 5 |
| QID_LINK | OWN/OBSERVATION QID, other side EQUIVALENT | no (OVERLAP → RETRIEVAL_ONLY) | after rule 4 (no known competitor) | optional (OBSERVATION_QID) | n/a | trust 1, 2, 10 |
| GROUNDED_CONVERGENCE | IDENTITY_CONVERGENCE with INDEPENDENT_ORIGINS | yes, only with independent origins | NO_MATERIAL_COMPETITOR from a complete pool | grounded geography | required (new) | trust 4, 11; verifier convergence suites; place-cutover C3 cases |
| GROUNDED_UNIQUE_EXACT_NAME | EXACT_NAME, SINGLE | no | after rule 4 | grounded geography | n/a | verifier spec, Catedral |
| GROUNDED_UNIQUE_ALIAS | EQUIVALENT alias, SINGLE | no | after rule 4 | grounded geography | n/a | Cabildo (§19.4) |
| WIKIDATA_CORROBORATION | Wikidata item naming both sides EQUIVALENTLY; NEARBY never over a name collision | no | after rule 4 | grounded geography | n/a | trust 7, NEARBY suites |

Findings, not fixed here:
- RW4-ID-COMPETITOR-GRADE-1: competitor examination for an OVERLAP
  candidate counts only EXACT names, so it measures the candidate's own
  name. Only GROUNDED_CONVERGENCE pairs an OVERLAP candidate with it, now
  only with independent origins, which no current adapter produces.
  Latent.
- CATALOG_VERIFIED_HINT replays a remembered identity. The C3 database
  holds both false identities as hint memory: reset it before any WARM run
  on it.
