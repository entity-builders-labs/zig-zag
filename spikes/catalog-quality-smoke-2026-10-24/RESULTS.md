# Buenos Aires catalog supply and grounded-reputation smoke

**Verdict: `APPROACH_PARTIALLY_VALIDATED`. Do not unblock or start 40.2.**

## Run conditions

- Candidate code: `b1caad64d741f18a7ee0c8de8e77f804898b2818`.
- Disposable database: `zigzag_39_test`; smoke's database guards passed.
- Structured catalog runner: local Docker Overpass at `localhost:12345`,
  Argentina data, configured Wikidata. It made 16 local Overpass requests and
  17 `www.wikidata.org` requests; all 833 requested entity facts were known.
- Local Nominatim was independently checked at `localhost:8088`: status OK,
  Argentina search returned Buenos Aires, and `data_updated` was
  `2026-09-12T20:15:47Z`. Local Overpass reported
  `2026-10-23T20:19:51Z`; the snapshots are not byte-identical. The production
  structured catalog harness itself uses its fixed coordinate scope and does
  not consume Nominatim results.
- No public Overpass/Nominatim, web/LLM in the catalog runner, Google Places,
  Foursquare, Gemini Maps, or Gemini Maps grounding. The separate reputation
  pilot used only the Groq grounded-search adapter.
- Smoke scope: Buenos Aires, Argentina; center `-34.6161845,-58.4332979`,
  requested radius `13,420 m`, Overpass cap `8,000 m`.

## Supply and quality versus preserved 39.11/39.12 smoke

| Measure | 39.12 historical result | Final 39.15 | Change |
|---|---:|---:|---:|
| Raw structured candidates | 3,195 | 7,615 | +4,420 |
| Admitted GeoEntities | 335 | 339 | +4 |
| Composed Experiences | 335 | 339 | +4 |
| Gastronomy candidates | 59 | 4,479 | +4,420 |
| Gastronomy Experiences | 4 | 4 | 0 |
| Parks | 12 | 16 | +4 |
| Places of worship | 14 | 14 | 0 |
| Museums | 143 | 143 | 0 |
| Visitor attractions | 108 | 108 | 0 |
| Heritage-tagged places | 30 | 30 | 0 |
| Tombs | 1 | 1 | 0 |
| Memorials | 2 | 2 | 0 |
| Monuments | 5 | 5 | 0 |
| Artworks | 1 | 1 | 0 |

The 39.13 signal occurred on four admitted entities, two without a Wikidata
identity. The catalog currently contains 132 admitted Experiences without a
Wikidata identity and 207 with one; 54 admitted entities have Wikidata-derived
prominence facts. These are current composition counts, not counts of newly
admitted entities. Wikidata remains enrichment: 335/339 composed Experiences
have known prominence, and the other four remain valid Experiences with
prominence `UNKNOWN`.

Food discovery no longer requires a QID: the source funnel grew from 59 to
4,479 gastronomy candidates, of which only 39 carried a Wikidata key. Admission
did not materially recover: the four gastronomy Experiences are unchanged, and
the 4,474 other food candidates lack sufficient independent admission
evidence. The four current gastronomy Experiences happen to have Wikidata
identities; the no-QID restaurant integration regression separately proves
that a supported restaurant can be admitted and persist a typed gastronomy
observation without Wikidata. Among currently admitted no-QID Experiences,
persisted structured observations cover architecture (3), art (26), and
history (12); none is currently a gastronomy Experience.

Historic-object protection remains stable: no return of the prior 331 tomb /
253 memorial noise, and no new tomb, memorial, monument, or artwork count.
Top-30 diagnostic labels are 13 A, 13 B, 4 C, 0 D; no obvious garbage appears
in the top 30. The complete production-ranked evidence table is
[`TOP30.md`](TOP30.md). The Caminito/Puente de la Mujer split identity remains
unresolved (0/400 membership matches); the smoke provides no new strong
structural identity evidence, so no name heuristic was added.

## Preference profiles and landmarks

Ranking remains preference-responsive, without manual reordering. Gastronomy
only ranks the four gastronomy Experiences first; art-only puts art Experiences
in its top 10; history + architecture + gastronomy puts matching historic /
built places first and El Preferido de Palermo at rank 8. No interests ranks
Casa Rosada first. Full profile top-10 lists, landmark ranks, and production
reasons are in the smoke JSON and `TOP30.md`.

| Experience | No interests | History + architecture + gastronomy | Gastronomy | Art |
|---|---:|---:|---:|---:|
| Obelisco | 167 | 77 | 168 | 199 |
| Museo Nacional de Bellas Artes | 331 | 332 | 331 | 50 |
| MALBA | 139 | 193 | 140 | 17 |
| Caminito | 299 | 313 | 299 | 307 |
| Teatro Colón | 295 | 309 | 295 | 303 |
| Cementerio de la Recoleta | 59 | 46 | 61 | 109 |
| Catedral Metropolitana | 3 | 17 | 7 | 55 |
| Puente de la Mujer | 220 | 252 | 220 | 242 |
| Café Tortoni | not composed | not composed | not composed | not composed |

The major-landmark ordering has moved substantially from the historical 39.12
baseline (for example Obelisco 216→167 and MALBA 311→139 in no-interests,
while MNBA 250→331). Preference rankings remain responsive, but these rank
shifts plus minimal admission recovery prevent a full validation verdict.

## Grounded reputation experiment (39.16)

The repository's `GroqGroundedSearchService` uses model
`openai/gpt-oss-120b` and `browser_search`; this was verified in code and in a
successful response. The root runtime configuration selects `serpapi`, so the
pilot explicitly instantiated the existing Groq adapter as requested. It
queried nine *already composed* Experiences across top, middle, gastronomy and
low-prominence strata. `Café Tortoni` was absent from the measured Experience
roster and was correctly excluded.

| Measurement | Result |
|---|---:|
| Candidate queries | 9 |
| Provider `applied` responses | 1 |
| HTTP 429 / failed responses | 8 |
| Typed reputation `KNOWN` after source review | 1 (`OFFICIAL_TOURISM_MENTION`, Casa Rosada) |
| Reputation `UNKNOWN` | 8 |
| Candidate responses with citations and source URLs | 1/9 |
| Unique cited sources in the accepted result | 3 |
| Confirmed identity mismatches | 0; 8 failures could not be identity-checked |
| Successful response latency | 40.3 s |
| Failed-response latency | 0.2–0.4 s each |
| Successful-response usage | 147,111 tokens (145,218 prompt; 1,893 completion) |
| Provider-reported cost | unavailable |
| Existing canonical cache | none; 0 hits / 9 misses |

Returned source categories included official City of Buenos Aires tourism,
national government, travel-guide/editorial sources (Lonely Planet and
Frommer's), and aggregator/search results. Only the inspected official city
tourism citation was accepted as a typed fact; unverified model assertions
were not promoted. Coverage and successful-query rate are insufficient for a
reputation ranking dimension, so the pilot remains diagnostic and did not
change ranking. A 50–100 candidate sample was not feasible: eight of nine
requests hit the Groq token-rate limit and a successful response consumed
147,111 reported tokens. `UNKNOWN` remains neutral.

**Scope deviation, excluded from the pilot:** before checking the smoke's
admitted roster, two exploratory Groq calls were made for Café Tortoni. It was
not composed and neither response is used in the nine-candidate sample or any
ranking claim. One exploratory call succeeded (138,206 reported tokens); the
other returned HTTP 429. The reputation pilot script now filters its shortlist
through the measured composed-Experience order before querying.

## Gate

`APPROACH_PARTIALLY_VALIDATED`: historic-object cleanliness, independent
Wikidata-free admission paths, preference responsiveness and absence of
obvious top-30 garbage are stable. However, total supply rose only 4 versus
the 335 baseline, gastronomy Experiences did not recover, the new access
signal supported only four candidates, prominent landmark ranks changed, and
grounded reputation coverage was too limited for ranking integration. Keep
40.2 blocked. Do not start it in this workstream.
