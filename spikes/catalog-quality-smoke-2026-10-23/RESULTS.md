# Buenos Aires structured catalog smoke — tasks 39.3–39.7

Reproducible harness: `run-catalog-smoke.ts` (+ `smoke-extensions.ts`).
It drives the production STRUCTURED_POI path: the planner and router, the
executor, OSM discovery plus dependent Wikidata entity facts, identity
reconciliation, the visit-unit policy, admission, GeoEntity knowledge
persistence, single-place composition and `PreferenceUtilityService` ordering.

Run conditions:

- Database: `zigzag_39_test`, guarded by URL, `current_database()` and the
  repository disposable guard. It is reset before each run.
- Local Overpass: `localhost:12345` (Argentina Geofabrik).
- Wikidata: `wbgetentities`, the existing structured provider, 17 requests.
- No LLM, web search, web fetch, public Overpass or Nominatim. This was
  enforced by stubs that throw, plus an outbound host ledger.
- Scope: lat -34.6161845, lon -58.4332979, requested r = 13 420 m.
  Overpass caps it at 8 000 m.
- Scenario interests: history, architecture, gastronomy, local character
  (traditional) and iconic. All are fixed typed assertions, with no language
  interpretation.

Runs:

| label | code | notes |
|---|---|---|
| BEFORE | `5f6d4066` (pre-39.2) | measured baseline from the task brief |
| HEAD-39.2 | `5839b77b` | `summary-head-39-2.json` (this harness) |
| AFTER | `9502220c` | `summary-after-39-6.json` (this harness) |

## Before → after

| metric | BEFORE | HEAD-39.2 | AFTER |
|---|---|---|---|
| candidates discovered | 3 152 | 3 159 | 3 193 |
| canonical GeoEntities | 3 140 | 3 147 | 3 181 |
| identity conflicts | 0 | 0 | 0 |
| possible duplicate pairs | 3 520 | 3 520 | 3 520 |
| admitted | 975 | 314 | 682 |
| rejected | 2 177 | 2 833 | 2 499 |
| Experiences composed | 967 | 314 | 516 |
| tombs (composed) | 331 | 1 | 1 (166 admitted, 165 are cemetery sub-features) |
| memorials (composed) | 253 | 2 | 19 |
| monuments (composed) | 38 | 3 | 11 |
| artworks (composed) | 30 | 0 | 17 |
| museums (composed) | 144 | 143 | 143 |
| visitor attractions (composed) | 108 | 108 | 108 |
| heritage-tagged (composed) | — | 30 | 30 |
| parks (composed) | — | 5 | 94 |
| places of worship (composed) | — | 6 | 36 |
| persisted parent/child relations | 0 | 0 | 347 |
| gastronomy candidates | 25 | 25 | 59 |
| gastronomy admitted / Experiences | 3 | 2 | 37 |
| prominence KNOWN (composed, any kind) | none | 0 | 516 |
| prominence UNKNOWN (composed, all kinds) | all | 314 | 0 |
| sitelink count KNOWN / UNKNOWN (composed) | — | — | 296 / 220 |
| heritage designation KNOWN (composed) | — | — | 95 |
| explicit visitor class KNOWN (composed) | — | — | 294 |
| duration known | 0 | 0 | 0 |
| opening hours KNOWN | 0 | — | 0 (172 UNKNOWN rows) |

Why the numbers moved:

- **Admission 975 → 314 (39.2).** Historic object classes stopped being
  decisive.
- **Admission 314 → 682 (39.3).** The planner now takes the dependent
  STRUCTURED_ENTITY_FACTS strategy, so canonical C6 notability exists:
  - 833 QIDs were resolved, and 296 composed places have language-Wikipedia
    articles.
  - A descriptive class plus a Wikipedia article admits, which accounts for
    94 parks, 36 places of worship, 19 memorials, 17 artworks and 11
    monuments.
  - New Wikidata P1435 heritage facts are decisive.
- **Composition 682 → 516 (39.5).** 166 admitted tombs fall inside Recoleta's
  area and become CHILD_REQUIRES_PARENT_VISIT sub-features. They stay
  admitted but are not offered.
- **Gastronomy (39.6).** The gastronomy gap now routes FOOD_AND_DRINK
  coverage, which brings in 39 identity-linked food venues.

## Parent/child edges (39.5)

- **Membership edges.** 400 provider membership edges led to 0 matches:
  - 391 members were not discovered candidates (multipolygon ways, transit
    stops).
  - 9 members had no child class.
- **Parent areas.** 837 parent-site areas were requested and 835 resolved.
- **Containment.** 349 containment matches have a declared class, and 315 are
  contained without a declared class (diagnostic only).
- **Relations.** 349 upserts were attempted and all succeeded, producing 347
  relation rows: 342 CHILD_REQUIRES_PARENT_VISIT and 5
  CHILD_INDEPENDENTLY_VISITABLE.

## Gastronomy source coverage (39.6)

Local OSM inventory inside the 8 km window, as named / with a Wikidata link:

| class | named | with Wikidata link |
|---|---|---|
| café | 1 548 | 16 |
| restaurant | 2 323 | 21 |
| food court | 5 | 0 |
| marketplace | 21 | 2 |
| bakery | 630 | 0 |

Supply is bounded by structured identity linkage: roughly 1 % of named food
venues carry the encyclopedic link that admission needs. This is recorded as
a source-capability limitation, not compensated.

The 37 composed food Experiences are: Café Tortoni, Café La Biela, Club
Español, Banchero, El Cuartito, Mar Azul, Las Cuartetas, La Americana,
La Poesía, Las Violetas, Bar Británico, El Hipopótamo, Barbaro, Café de
García, Bar Seddon, Los 36 Billares, Café de los Angelitos, Casal de
Catalunya, Petit Colón, Don Julio, London City, El Gato Negro, Café Palacio,
La Giralda, Güerrín, El Preferido de Palermo, Pippo, La Puerto Rico,
Miramar, Mercado de San Telmo, El Tokio, La Esquina de Aníbal Troilo,
Mercado San Cristóbal, Esquina Homero Manzi, Confitería Ideal, Pulpería
Quilapán and Le Caravelle.

## Top 30 (actual production order, `preference-utility-v2`)

**How the order is decided.** Every candidate ties on preference relevance.
No stated facet strongly matches, because structured Experiences have no
quality score. Prominence (`structured-prominence-order-v1`) therefore
decides, in this order:

1. Heritage presence.
2. Explicit visitor classification.
3. Language-Wikipedia sitelink count.
4. Identity, as the tie-break.

Each item's `orderDecision` in `summary-after-39-6.json` names the level that
placed it after its predecessor.

**Labels.** A = obvious high-value Experience, B = valid secondary or niche,
C = questionable as a standalone Experience, D = garbage. The labels are a
diagnostic only and never feed production.

**Column key.**

- Evidence: H = heritage designation, V = explicit visitor classification,
  S = Wikipedia article count.
- Every row is ADMITTED.
- None of the 30 is a child of another place; Recoleta (#3) is the parent of
  327 sub-features.

| # | Experience | structured class | prominence evidence | label |
|---|---|---|---|---|
| 1 | Teatro Colón | attraction | H, V, S=37 | A |
| 2 | Palacio Barolo | attraction | H, V, S=28 | A |
| 3 | Cementerio de la Recoleta | attraction, heritage | H, V, S=24 | A |
| 4 | Jardín Botánico Carlos Thays | attraction, heritage | H, V, S=18 | A |
| 5 | Edificio Kavanagh | attraction | H, V, S=16 | A |
| 6 | Cabildo de Buenos Aires | heritage, museum (Wikidata) | H, V, S=16 | A |
| 7 | Buque Museo Corbeta Uruguay | museum, heritage | H, V, S=10 | B |
| 8 | Hotel de Inmigrantes | historic, museum (Wikidata) | H, V, S=9 | B |
| 9 | Puente Transbordador Nicolás Avellaneda | attraction, heritage | H, V, S=9 | B |
| 10 | Buque Museo Fragata Presidente Sarmiento | museum | H, V, S=8 | A |
| 11 | Plaza Dorrego | attraction, park | H, V, S=6 | A |
| 12 | Confitería El Molino | attraction | H, V, S=6 | A |
| 13 | Basílica de San Francisco | attraction, worship | H, V, S=6 | B |
| 14 | Museo Mitre | museum, heritage | H, V, S=5 | B |
| 15 | Manzana de las Luces | museum, heritage | H, V, S=5 | A |
| 16 | Ecoparque | zoo, park | H, V, S=4 | B |
| 17 | Museo Casa Carlos Gardel | museum, heritage | H, V, S=3 | A |
| 18 | Instituto Sanmartiniano | museum | H, V, S=3 | B |
| 19 | Museo del Banco Central | museum | H, V, S=2 | B |
| 20 | Museo Histórico y Numismático del Banco Nación | museum | H, V, S=2 | B |
| 21 | Antigua Sede del Congreso Nacional | attraction, heritage | H, V, S=1 | B |
| 22 | La Librería de Ávila | attraction | H, V, S=1 | B |
| 23 | Museo del antiguo recinto del Congreso Nacional | museum | H, V, S=1 | C |
| 24 | Club Español | attraction, food | H, V, S=1 | B |
| 25 | Biblioteca Nacional Mariano Moreno | attraction | H, V, S=1 | B |
| 26 | Museo Fotográfico Simik | museum | H, V, S=1 | B |
| 27 | Museo Casa Rosada | museum | H, V, S=1 | A |
| 28 | El Hipopótamo | attraction, food | H, V | B |
| 29 | Museo Criollo de los Corrales | museum | H, V | B |
| 30 | Casa Museo Bernardo Houssay | museum | H, V | B |

The tally is 12 A, 17 B, 1 C and 0 D.

**Why #23 (C) survived.** The museum and the old Congress building (#21) are
separate OSM records with different QIDs, so reconciliation correctly refuses
to merge them without strong evidence. Containment does not apply either: a
museum is a parent class, not a child class. The result is two Experiences
that a visitor would treat as one visit.

**Where the diagnostic landmarks rank.** Obelisco #97, Catedral Metropolitana
#98, Museo Nacional de Bellas Artes #99, MALBA #104, Caminito #245, Puente de
la Mujer #262 and Floralis Genérica #390. La Bombonera is absent. Each of
them has strong sitelink evidence but no recorded heritage designation, and
policy v1 puts heritage presence first.

## Quality questions

1. **Did tomb/memorial/object noise decrease substantially?** Yes, from 331
   tombs, 253 memorials, 38 monuments and 30 artworks to 1, 19, 11 and 17
   composed. The remaining memorials and artworks each carry a
   language-Wikipedia article.
2. **Are major attractions concentrated toward the top?** Partly. The top 30
   holds 12 A and no D, led by Teatro Colón, Barolo, Recoleta and Cabildo.
   Several major landmarks without a heritage designation (Obelisco, MNBA,
   MALBA, Caminito) sit at ranks 97–245.
3. **Can the engine explain why major candidates outrank low-prominence
   ones?** Yes. Each assessment carries a typed per-level profile with
   evidence references and the deciding level; no score is involved.
4. **Did parent/child handling improve measurably?** Yes. Relations went from
   0 to 347, and 166 admitted tombs are now cemetery sub-features. Provider
   membership edges remain unusable in this source.
5. **Did gastronomy supply materially improve?** Yes in output, from 3 to 37
   food Experiences, mostly historic cafés, bars and notable restaurants. The
   supply stays bounded by Wikidata linkage, about 1 % of the inventory.
6. **Is there obvious garbage in the top 30?** No. There is one C, a
   near-duplicate visit unit.
7. **Are there still too many valid but low-value Experiences?** Yes. Many of
   the 516 are parks, plazas, parishes and small museums admitted with a
   single Wikipedia article (94 parks, 36 places of worship). They rank low,
   but they stay composed.
8. **Is prominence mostly KNOWN or UNKNOWN?** At least one kind is KNOWN for
   every composed Experience. The discriminating sitelink count is KNOWN for
   296 and UNKNOWN for 220.
9. **What are the top 3 remaining catalog-quality problems?**
   1. Prominence precedence: heritage presence comes before encyclopedic
      notability, and designations are dense and heterogeneous (P1435 local
      protection values, OSM `heritage=*`). As a result 95 designated places
      outrank un-designated icons.
   2. Preference relevance is inert for structured Experiences. They have no
      typed themes and no quality score, so no strong facet match is
      possible, and the stated interests do not steer the order.
   3. There is a long tail of low-value Experiences admitted on one
      Wikipedia article, plus near-duplicate visit units and missing icons
      (La Bombonera). Duration and opening hours are still unknown for
      everything.
10. **Does the evidence support proceeding to 40.2?** No. 40.2 still has no
    evidence-backed duration sample: duration is known for 0 places and task
    27.3 has not run. The catalog precedence problem in point 9.1 is a
    material blocker for selection quality.

## Verdict

**APPROACH_PARTIALLY_VALIDATED**

The architecture moves the catalog in the intended direction, measured on
real data:

- noise reduction;
- explainable prominence ordering with an A-heavy top 30;
- parent/child relations established;
- broader gastronomy supply.

Policy v1's precedence still misplaces un-designated landmarks, and
preference relevance does not yet act on structured Experiences.
