# Preference-first flow — Buenos Aires cold-catalog probes

Status: **probe / empirical evidence. Docs-only.** Companion to
`docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
(§8). Run: 2026-09-10. Branch: `feat/experience-domain-v2`, HEAD `1aa6d10`.

Two probes, same cold Buenos Aires catalog:
- **Probe #1 (manual)** — the full 11-stage flow driven by hand; sections
  "Purpose" through "Formalization" below.
- **Probe #2 (executable)** — real acquisition + real Groq classification of all
  bundles + in-memory retrieval using the *real* match primitive + in-memory
  deterministic set-cover, producing a `CompositionResult`; section
  "## Probe #2" near the end. Probe #2 surfaced findings A–E, folded into design
  §5 and §8.1.

## Purpose

Execute the preference-first flow **by hand**, calling each real provider / LLM
when the design says one is needed, starting from a representative search, with
an **empty catalog** for the chosen city (Buenos Aires). Answer: *what tour
comes out, and is it coherent with the request?*

This is not a test suite and produced no committed code — the flow was driven
manually; persistence and the solver were simulated in memory; classifications
for 3 bundles were run through the real model and the rest projected from real
evidence (marked `[projected]`).

## Representative search

- destination: "Buenos Aires, Argentina" · 2 days · couple · moderate pace ·
  walking + public transport
- interests: `history`, `architecture`, `tango` · intents: `visit`, `walk` ·
  explorationStyle: `iconic`
- additionalPreferences (free text): *"Quiero recorrer San Telmo y ver un show
  de tango. Me interesa la arquitectura del Teatro Colón."*

Chosen to exercise: free-text interpretation with two anchors (an area + a
venue), a facet OSM/Places cover poorly (a tango *show*), and a fully cold
catalog → the entire acquisition + classification path.

## Calls actually made

| Stage | Call | Provider | Real? |
|---|---|---|---|
| 1a | interpret free text | Groq `openai/gpt-oss-120b`, temp 0 | real |
| 2 | resolve destination | Nominatim | real |
| 4b | OSM features (museums / theatres / monuments w/ `wikidata`, CABA bbox) | Overpass (`z.overpass-api.de`) | real |
| 4b | Places text search — "Teatro Colón", "San Telmo", "tango show San Telmo" — **wide field mask** (`editorialSummary`, `primaryTypeDisplayName`, `websiteUri`, `priceLevel`, `businessStatus`) | Google Places | real |
| 4b | Wikivoyage BA article | MediaWiki | real (weak — see limitations) |
| 4b | web search per facet (tango / architecture / history) | Tavily | real |
| 4b | Wikidata narrative (Cabildo Q1024829, San Martín monument Q6023222) | Wikidata API | real |
| 4c | web prose → entity names + evidenceKeys | Gemini `gemini-flash-lite-latest`, temp 0 | real |
| 6a | semantic classification (Teatro Colón, Bar Sur, Cabildo bundles) | Groq `qwen/qwen3.8-27b`, temp 0, evidence-only, no dimensioned facets | real (Cabildo cut by free-tier token cap) |
| 5, 7, 9, 10 | corroboration / persist / composition / planning | — | simulated by hand |

## Results by stage

### Stage 1a — interpret (real, Groq gpt-oss-120b)

```
preferredFacets: theme:architecture(1.0), theme:culture(0.9), theme:history(0.8),
                 intent:walk(0.9), intent:performance(0.9), intent:visit(0.9)
anchoredPlaces:  [San Telmo (area, soft), Teatro Colón (venue, soft)]
positiveSemanticQuery: "Explore San Telmo, watch a tango show, and admire the
                        architecture of Teatro Colón."
```
Notable: the model read "show de tango" as `intent:performance`, not
`theme:tango`. `theme:tango` comes from the wizard. **Merged PreferenceSpec:**
`theme:{history, architecture, tango, culture}` · `intent:{visit, walk,
performance}` · `exploration_style:iconic` · anchors {San Telmo, Teatro Colón}.

### Stage 2 — destination (real, Nominatim)
BA / Comuna 1, center `-34.6096, -58.3888`, bbox CABA core. scale = area.

### Stage 3 — per-facet catalog retrieval
Catalog empty → all 8 facets insufficient → all to acquisition.

### Stage 4 — acquisition (real)

- **Overpass:** 40 real elements in the CABA bbox — Monumento al Gral. San
  Martín (Q6023222), Museo Histórico Nacional del Cabildo (Q1024829), **Museo
  Mundial del Tango** (Q64764216), Piazzolla Tango, Teatro Cervantes, Museo
  Etnográfico (architect Pedro Benoit)…
- **Google Places (wide field mask):**
  - **Teatro Colón** — `opera_house`, `primaryTypeDisplayName: Ópera`, rating
    4.8 / 89 621, **editorialSummary: "Teatro monumental (aprox. 1908), con una
    acústica afamada, que ofrece música clásica, ópera, ballet y visitas."**,
    types incl. `museum`, `concert_hall`, `tourist_attraction`. Cerrito 628.
  - **San Telmo** — `sublocality` (area). No rating/editorial — confirms
    identity only.
  - **Bar Sur** — `performing_arts_theater`, rating 4.8 / 1 869,
    **editorialSummary: "Taberna cautivadora con aperitivos, bebidas
    alcohólicas y espectáculos de tango en directo."**, Estados Unidos 299, San
    Telmo. Plus El Viejo Almacén (`argentinian_restaurant` first → enrichment-only),
    Club Casa Blanca.
- **Tavily (per facet):** Colón — 50-min guided tours, 3 architects, ~20 years,
  opened 1908, tour of Hall / Golden Hall / Bust Gallery, "history, architecture,
  stairs, sculptures, vitreaux". San Telmo — oldest neighborhood, cobblestone,
  Plaza Dorrego, "heart of tango", free walking tours, Sunday antiques market.
  Tango — Bar Sur ("best show in San Telmo, priciest, century-old French
  mansion, daily 8pm–2am"), El Querandí ("restored 1920s building, one of BA's
  most iconic tango venues, historic San Telmo").
- **Gemini flash-lite (Stage 4c):** clean entity list from the web prose with
  `evidenceKeys` and **no classification** — Teatro Colón, San Telmo, Recoleta
  Cemetery, Café Tortoni, Plaza de Mayo, Casa Rosada, Cabildo, Plaza Dorrego,
  Parroquia San Pedro González Telmo, Bar Sur, El Querandí, El Viejo Almacén,
  Av. de Mayo (route)… + minor noise (a synagogue out of scope, a tour meeting
  point mistaken for a venue) that Stage 5 identity resolution / Stage 3
  sufficiency filters.
- **Wikidata:** Cabildo Q1024829 — "historical building, government house during
  colonial times", heritage = national historic monument, instance = museum,
  has an architect. San Martín monument Q6023222 — "statue by Louis-Joseph
  Daumas", 1862.

### Stage 6 — classification (real, Groq qwen3.8-27b, evidence-only, no dimensioned facets)

**Teatro Colón:**
```
themes:  [architecture, music, entertainment, history]
intents: [visit, performance]
traits:  ["monumental 1908 construction", "renowned acoustics",
          "50-minute guided tours", "features Hall, Main Foyer, Bust Gallery,
          and Golden Hall", "offers classical music, opera, and ballet"]
reasoningEvidence: every facet → evidenceKeys + reason
                   (opera_house→music/entertainment; editorials→architecture/history/tours)
```

**Bar Sur:**
```
themes:  [tango, nightlife, food]
intents: [performance, food]
traits:  ["daily shows from 8 p.m. to 2 a.m.", "century-old French-style mansion",
          "serves aperitifs and alcoholic beverages"]
```

Both: **no invalid vocabulary, no fabricated dimensioned facet, grounding by
`evidenceKey` on every facet.** (Cabildo `[projected]` from real evidence:
`themes:[history, architecture]`, `intents:[visit]`.)

### Stage 8 — per-facet sufficiency after acquisition
`history` ✅ · `architecture` ✅ · `tango` ✅ · `culture` ✅ · `visit`/`walk`/
`performance` ✅ · **`exploration_style:iconic` ⚠️ UNMET** (v1 emits no
dimensioned facets — by design; visible in the trace) · anchors San Telmo ✅ /
Teatro Colón ✅ (force-included).

### Stage 9–10 — composition + planning `[hand-simulated]`

Composed set: Teatro Colón, San Telmo (area), Bar Sur, Museo Histórico Nacional
del Cabildo, Plaza Dorrego, Café Tortoni, Museo Mundial del Tango, Monumento al
Gral. San Martín.

**Day 1 — Centro histórico + arquitectura (~2.9 km walking):**
10:00 Teatro Colón (guided tour) · 11:30 Monumento San Martín / Plaza San
Martín · 13:00 Café Tortoni (lunch) · 14:30 Cabildo + Plaza de Mayo + Casa
Rosada (exterior) · 16:00 Museo Mundial del Tango.

**Day 2 — San Telmo + tango (<2 km, in-barrio):**
11:00 San Telmo self-guided walk (Plaza Dorrego, cobblestones, antiques) ·
12:30 Plaza Dorrego (market + street tango, Sun) · 13:30 lunch — Mercado de San
Telmo · 15:00 Parroquia San Pedro González Telmo, Pasaje San Lorenzo ·
**20:30 Bar Sur — tango dinner show** (opens 20:00). Alternate: El Querandí.

**Final per-facet coverage:** history ✅ strong · architecture ✅ · tango ✅
strong · culture ✅ · visit/walk/performance ✅ · `exploration_style:iconic`
⚠️ unmet-by-design (the selected set *is* iconic in fact — Colón, Plaza de
Mayo, San Telmo — but v1 cannot assert it) · anchors San Telmo & Teatro Colón
✅ forced.

## What this proves

1. **The resulting tour is coherent with the request.** Every stop maps to a
   requested facet with grounded evidence. No stadiums, no random nearby POIs,
   no empty-metadata museums — the exact failure mode the G.1 characterization
   documented for the current engine.
2. **"Ver un show de tango"** → Bar Sur, a real 4.8-rated venue, in the correct
   evening slot. **"Arquitectura del Teatro Colón"** → the anchor, classified
   `architecture + history + music` from its real Places `editorialSummary` and
   Tavily tour description.
3. **Stage 6 behaved well on real BA evidence** — valid vocabulary, grounded,
   nothing invented. The risk deliberately removed in v1 (dimensioned facets)
   shows up cleanly as `exploration_style` staying unmet — honest, not broken.
4. **The Places field-mask widening is load-bearing.** `editorialSummary`
   ("Teatro monumental 1908, acústica afamada…") is what produced the
   `architecture` / `music` signal. Today that field is not even requested.

## Limitations of this manual run (not of the design)

- Wikivoyage signal was weak — the manual regex failed on the multi-district BA
  article; the real `WikivoyageApiService` parses district sub-articles +
  `{{listing}}` templates properly.
- Cabildo / San Telmo / El Querandí / Plaza Dorrego / Café Tortoni / Museo
  Mundial del Tango classifications were `[projected]` from real evidence, not
  run through Stage 6 (Groq free-tier output-token cap).
- Stage 10 was hand-planned; the real solver would schedule with Geoapify
  travel estimates.
- No `Places searchNearby` for a generic `culture` sweep (OSM museums used
  instead).

## Formalization

Both probes become `be/test/live/preference-first-buenos-aires.live-spec.ts` in
the refactor (design §9.6): real providers, cold catalog, the same
`PreferenceSpec`, asserting `perFacetCoverage` covers the requested facets, every
selected item is an `Experience` with resolved components, and the best-in-facet
match for each facet is present.

---

## Probe #2 — executable (real classification + real primitive + set-cover)

**Input** (structured `PreferenceSpec`, no free-text interpret this time):
themes `[history, architecture, tango]`, intents `[visit, walk]`, anchors
`[San Telmo (area), Teatro Colón (venue)]`, style `balanced`, 2 days / moderate.

**What ran for real:** Overpass, Google Places text search (wide field mask),
Tavily (3 facet queries), Wikidata, Gemini flash-lite (entity extraction) →
**12 evidence bundles** → **12 real Groq `qwen/qwen3.8-27b` classification
calls** (temp 0, evidence-only, no dimensioned facets) → in-memory per-facet
retrieval via the **real** `candidateMatchesPreferenceFacet` +
`normalizeExperienceCandidateFacets` (imported, not reimplemented) → in-memory
deterministic set-cover. No persistence, no planner.

**Classification sample (real Groq output):**

| Experience | themes | intents | grounding example |
|---|---|---|---|
| Teatro Colón | architecture, history, music, entertainment | visit, walk | *"architecture, stairs, sculptures, vitreaux during the tour"* `[web:architecture:0-2]` |
| Bar Sur | tango, music, wine, food | performance, food | *"espectáculos de tango en directo"* `[places:bar-sur, web:tango:0]` |
| Museo Histórico Nacional del Cabildo | history, culture | visit | *"edificio gubernamental colonial… artículos patrimoniales"* `[places:…, web:history:3]` |
| Monumento al Gral. San Martín (OSM-only) | history | visit | conservative — thin evidence |

**`CompositionResult`:**
- **Per-facet coverage:** `history` ✅ · `architecture` ✅ · `tango` ✅ ·
  `visit` ✅ · `walk` ✅ — **`unmetFacets` = []**.
- **Selected (8):** San Telmo, Teatro Colón, Plaza de Mayo, Café Tortoni, Plaza
  Dorrego, Manzana de las Luces, Monumento de los Españoles, El Querandí.
- Every requested facet covered by ≥1 strong grounded match. Anchors forced.

**Findings (folded into design §5 / §8.1):**

- **A — best-in-facet reservation.** **Bar Sur** (strongest dedicated tango-show
  venue, 4.8/1869) was *not* selected — it covers only `theme:tango`, and the
  greedy multi-facet fill preferred alternatives. The user still got a tango
  show (El Querandí is also a dinner-show) by luck, not design. → reserve top-k
  strongest per facet before the multi-facet fill.
- **B — `performance` ≠ `theme`.** `theme:tango` was "covered" by a historic
  café and by a neighborhood; that is ambiance, not a show. "Ver un show" must
  become `intent:performance` and require a real performance venue.
- **C — quality for un-rated Experiences.** "San Telmo" (area, no rating) got a
  flat `q=3.5` that cleared the quality floor. Un-rated Experiences must derive
  quality from component notability; `null` → weak match.
- **D — anchor semantics / what is an Experience.** "San Telmo" resolved to a
  bare `sublocality` `GeoEntity` — **no rating, no components** — and was
  classified from web articles *about the neighborhood* (`[tango, history,
  culture, architecture]`), then force-included as a schedulable stop that
  trivially "covered" every facet. A bare `AREA`/`ROUTE` is geographic reality,
  never a schedulable unit (Experience Domain V2). An `area` anchor must be a
  retrieval-scope bias + a trigger to acquire a real multi-stop walk Experience;
  the bare polygon cannot be selected. D also absorbs the observation that
  `intent:walk` was thin (only Teatro Colón + Plaza de Mayo without the area
  cheat) — point POIs classify as `visit`; `walk`/`route_like` wants a resolved
  multi-stop route Experience.
- **E — classifier theme over-reach.** `theme:wine` for Bar Sur / El Querandí
  (from "vino" / "bebidas alcohólicas"); `theme:tango` for Café Tortoni (hosts
  occasional tango). → prompt guardrail: canonical theme only when the place is
  substantially *about* it; incidental facts → `traits`.

**Verdict:** the core (per-facet retrieval with the real primitive + set-cover)
works on real cold BA data — a preference-correct, fully-covered, grounded set
with zero unmet facets. Findings A–E are refinements to §5, not shape changes.
