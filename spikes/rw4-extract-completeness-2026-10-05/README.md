# RW4-EXTRACT-COMPLETENESS-1 — forensic evidence and replays (2026-10-05)

Input: the C3 editorial composites from
`../rw4-functional-composite-campaign-2026-10-05/` (COLD `c3-cold`, WARM
`c3-warm`).

- `oracle.json`: the source-defined stop sequence of both sources, with
  roles (MANDATORY / ACCEPTABLE / ALTERNATIVE) and segment boundaries at the
  source's own motorized transfers. It was frozen and committed **before**
  any production change and any live run.
- `sources/`: Tavily `advanced`/`markdown` extracts of both pages. They
  reproduce the C3 planner-capacity retrieval byte for byte (17027 / 33440
  characters), apart from the trace's `apikey` redaction.
- `forensic.cjs` → `forensic.out.json`: for every oracle stop, where it was
  lost (retrieved content → each extractor input window → extractor output →
  persisted components), computed only from recorded traces and DB
  snapshots.
- `replay-extract.cjs`: calls the real extractor provider from `be/dist` on
  fixed inputs, N times, and scores the output against the oracle. Output is
  in `replays/<label>-<provider>/`. Every run is kept, including provider
  errors (Cloudflare daily allocation 429, Groq 1000-token/minute output
  cap).

## Forensic loss table (MANDATORY stops)

| Source | Stop | Lost at |
|---|---|---|
| secretsofbuenosaires | Plaza de Mayo, Casa Rosada, Cabildo, Catedral, Mercado de San Telmo, Plaza Dorrego, Parque Lezama | emitted, verified, persisted |
| secretsofbuenosaires | Museo Histórico Nacional, Caminito, La Bombonera | **retrieved but excluded by window**: the "Day 1" section (8453 chars) was split into runs 2098–7593 and 6163–12076; the scan stopped at the first run (`STOP_REQUIREMENT_SATISFIED`) |
| agusyornet | Teatro Colón, Obelisco, Plaza de Mayo, Farmacia La Estrella, Librería de Ávila, El Patio de los Ezeiza, Caminito, Puente de la Mujer | **in extractor input, not emitted** (COLD window 1 had holes; WARM window 1 was a different set of holes: unstable input) |
| agusyornet | Monumento de Mafalda | emitted (WARM), not persisted (`CANDIDATE_REJECTED`) |
| agusyornet | Casa Mínima, Mercado de San Telmo | emitted, verified, persisted |

## Root causes found

1. Windowing cut heading sections into budget-sized runs and relevance
   excerpts with holes, and the scan accepted the first window whose
   candidate closed the gap, so a prefix became the composition.
2. The parser silently kept only the first 8 `componentHints`
   (`MAX_HINTS`): a 14-stop extraction became 8.
3. The prompt had no positive contract that a source-defined itinerary is an
   exhaustive ordered sequence, it offered "only the single best-supported
   variant to keep extraction small", and it listed "a morning vs an
   afternoon itinerary" as a variant. Baseline replays at temperature 0
   returned 0 candidates, a subset, or the full set on identical input.
4. The source-support gate turned markdown emphasis into spaces inside
   quotation marks (`"**Name"**` became `" name" `), so faithful quotes of
   bold, quoted stop names failed and rejected whole candidates.
