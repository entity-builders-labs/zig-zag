# Offline R1 / R1+R2 simulation (2026-10-07)

No production change. The harness (`harness/`) installs R1 / R2 as jest
spies on the resolver prototype and on `examineCompetitors`. Retrieval is
unchanged.

- **R1 (record equivalence):** records of one pool that declare the same
  located Wikidata item (P625) and the same exact normalized address
  (street + housenumber) are one identity. In competitor examination they
  share an identity key; name multiplicity counts identities, not records.
- **R2:** a candidate in such a group also declares the names of its group's
  records (`name`, `short_name`, `alt_name`, `official_name`, aliases).

## Groups

| Pool | Shared-QID groups | R1 groups | Verdict |
| --- | --- | --- | --- |
| Buenos Aires, production `lookupPoisWithin` (2712 POIs) | 12 | 1 | Cabildo: correct |
| Ciudad de Mendoza, production (176 POIs) | 0 | 0 | — |
| Buenos Aires, broad stress query (1663 records with a QID) | 31 | 2 | Cabildo: correct; FADU + Exactas: wrong |
| Mendoza, broad stress query | 2 | 0 | — |

The faculties (`amenity=university`) are not in the production POI pool.
Nominatim results carry no tags, so R1 cannot apply to them.

## Decisions (`sim-buenos-aires-*.json`)

- The real C3 candidates and single hints were run in the C3 scopes:
  - `CANDIDATE_ROUTE` Defensa;
  - `CANDIDATE_AREA` San Telmo, reproduced by seeding the catalog with the
    San Telmo AREA that C3 reused;
  - `DESTINATION_AREA`.
- 55 components; 6 change, all Cabildo hints.
- R1 alone verifies only "Cabildo de Buenos Aires". For "Cabildo", the
  local attempt becomes NO_DECISIVE_EVIDENCE, and the NOMINATIM attempt
  then stays AMBIGUOUS on the café "Cabildo de Buenos Aires"
  (`cabildo-decisions-R1.json`).
- R1+R2 verifies Cabildo in all four contexts via `GROUNDED_UNIQUE_ALIAS`:
  the way's `short_name=Cabildo` becomes EQUIVALENT and SINGLE.
- Unchanged in every mode: Don Carlos (AMBIGUOUS), El Zanjón
  (`GROUNDED_CONVERGENCE`), Farmacia la Estrella and every other component.

## Fixtures (`fixture-suites.txt`)

- R1 formed no group in any unit or integration fixture, so the fixtures
  carry no evidence for or against R1.
- The one integration failure also fails in the BASELINE-with-harness
  control, and passes without the harness.

## FADU / Exactas (`fadu-exactas-*.json`)

- Node 11254256165 (`name=Facultad de Ciencias Exactas y Naturales`,
  `short_name=FCEN`, `wikipedia=es:Facultad de Ciencias Exactas y
  Naturales (UBA)`) carries `wikidata=Q5854525`. That is FADU's item;
  Exactas is Q5428851. The record contradicts itself.
- Both nodes carry the campus address, Intendente Güiraldes 2160, and lie
  160 m apart with no containment. They are distinct facilities.
- Their names correspond NONE in both directions.
- With a correct per-identity count, no tested decision changes. R2 still
  copies "FADU" and "Facultad de Arquitectura, Diseño y Urbanismo" onto the
  Exactas candidate. That is a latent false-VERIFIED path through rule 6b
  if any retrieval ever selects that record for a FADU hint.
- A first simulation turned Exactas REJECTED under R1. That was a harness
  artifact (the collapse dropped the member whose own name matched); it
  was fixed before the reported runs.

## Discriminating condition

Condition (a): a record joins R1 only if one of its own declared names is
EQUIVALENT to the item's label or an alias.
- Cabildo node and way: EQUIVALENT, so they stay merged.
- Exactas node against FADU's item: NONE, so the wrong group dissolves.
