# RW4-ID-FALSE-VERIFY-2: competitors at the candidate's name grade (2026-10-07)

The canonical C3 run `../c3-idretry2-cold/` VERIFIED two hints by
`GROUNDED_CONVERGENCE`:
- "Club Atlético" as `osm:way:23634484`, Club Atlético San Lorenzo de
  Almagro - Sede Boedo;
- "National Bank" as `osm:relation:9254658`, Edificio First National Bank
  of Boston.

Rule: spec amendment §19.5. C3 was not run for this work.

A first fix (`b3a13e33`, reverted in `89fcc6de`) required independent
evidence origins for convergence. It regressed RW1 El Zanjón and Farmacia
la Estrella, so it was withdrawn.

## Discriminating evidence

At verifier level, the four convergence cases carry the same facts: an
OVERLAP name, one OSM record read by two adapters, `NO_MATERIAL_COMPETITOR`
and a bounded scope. What differs is the pools (`hint-grade-pools.txt`).
These are records that answer to the hint at the grade the candidate
answers to it, OVERLAP:

| Hint | Other records at the candidate's grade |
| --- | --- |
| Club Atlético | 3 in the Buenos Aires pool: Club Atlético Atlanta, Espacio para la memoria "Club Atlético", Museo Club Atlético San Lorenzo de Almagro |
| El Zanjón de Granados | 0 |
| Farmacia la Estrella | 0 |
| National Bank | 0 |

Competitor examination counted only exact names. For an OVERLAP candidate
that measures the candidate's own name, not the hint's referent.

## Impact matrix (real resolver, local Overpass + Nominatim, live Wikidata, recorded Places)

`impact-matrix-replay.forensic.spec.ts.txt` runs
`ExperienceProposalResolverService.resolve` for 30 hints. The Buenos Aires
pool is `osm:relation:1224652`, 2712 POIs. Places replays the records
C3/RW1 Geoapify returned, with their declared OSM ids.

| Hint | Baseline `89fcc6de` | After |
| --- | --- | --- |
| Club Atlético | VERIFIED `GROUNDED_CONVERGENCE` (false) | **AMBIGUOUS `MATERIAL_COMPETITOR_KNOWN`** |
| National Bank | VERIFIED `GROUNDED_CONVERGENCE` (false) | unchanged: **BLOCKED** (see below) |
| Basílica del Pilar | INSUFFICIENT_EVIDENCE, unresolved | AMBIGUOUS, unresolved (two distinct OVERLAP records; not persisted before or after) |
| 27 other hints | — | identical (decision, rule, candidate) |

The 27 identical hints:
- El Zanjón, Farmacia la Estrella and Museo Nacional del Cabildo still
  VERIFY by `GROUNDED_CONVERGENCE`.
- Cabildo, Quinquela Martín, MALBA and Mercado San Telmo still VERIFY by
  `GROUNDED_UNIQUE_ALIAS`.
- San Telmo Market, Museo Moderno and Riachuelo still VERIFY by
  `QID_LINK`.
- Catedral Metropolitana, Plaza Dorrego, Obelisco, Casa Mínima, Bar Sur,
  Parque Lezama and Cementerio de la Recoleta still VERIFY by
  `GROUNDED_UNIQUE_EXACT_NAME`.
- Don Carlos, Catedral, Bar El Federal, Casa Rosada, Plaza de Mayo,
  Congreso, Basílica de San Francisco and Plaza San Martín stay
  AMBIGUOUS.
- Museo del Cabildo and La Librería del Avila stay INSUFFICIENT_EVIDENCE.

Suites with no existing test line changed or removed: unit 2824/2824,
integration 115/115, e2e 41/41.

## National Bank: BLOCKED_BY_MISSING_DISCRIMINATING_EVIDENCE

Its facts match Farmacia la Estrella's in every examined source:
- local pool: no other record at its grade;
- Nominatim (country): one result;
- Places: one result;
- Wikidata: the candidate's own item Q5818109 is labeled "ICBC Argentina
  headquarters", and its aliases ("Edificio First National Bank of Boston")
  OVERLAP the hint. Farmacia has no item, so this is not a fact Farmacia
  lacks in a comparable form.

The fact that tells them apart is in the source: "the headquarters of the
National Bank", among the buildings "surrounding" Plaza de Mayo. It is lost
at atom labelling (`LabelledEntity` has no assertion slot). It is
anaphoric ("This historic place"), so §19's same-statement rule rejects
it. Unblocking needs an owner decision on source grounding
(RW4-ID-SOURCE-GROUNDING-1). A rule built from the facts available today
would reject Farmacia too.

The correct records exist in OSM but no current path retrieves them:
- `node 3158482730` "Club Atlético" (Q5821445);
- `relation 3527701` "Banco Nación", Bartolomé Mitre 326.
See `local-provider-probe.txt`.

## Files

| File | Content |
| --- | --- |
| `impact-matrix-baseline-89fcc6de.json`, `impact-matrix-after.json` | Final attempt per hint, before and after. |
| `impact-matrix-replay.forensic.spec.ts.txt` | The replay. Copy under `be/src/` as `*.spec.ts`; set `HINTS` and `OUT`. |
| `hint-grade-pools.txt` | Records per hint at each name grade, in the local pool and Nominatim. |
| `source-to-identity-forensic.json` | Atoms, segment member, source-support audit and identity attempts of both C3 hints. |
| `local-provider-probe.txt` | Local Nominatim/Overpass: wrong and correct records. |
| `mutation-results.txt` | M1: rule disabled, the new tests fail. M2: rule applied to every candidate grade, historical tests fail. |
