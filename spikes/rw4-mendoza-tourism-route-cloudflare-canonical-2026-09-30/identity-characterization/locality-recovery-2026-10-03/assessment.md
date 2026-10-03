# RW4: source-grounded component locality recovery (2026-10-03)

Diagnostic dossier for amendment §19.1. No COLD #12 or WARM was run.
Every replay persisted 0 canonical rows (`*/db-after-probe.json`).

Starting HEAD `1f48c4626155cb6e7f4e89ec9e6c7cbfc31fc69d`. Inputs: the
captured COLD #11 SolSalute window
(`be/src/modules/tours/fixtures/rw4-solsalute-deep-source-window.json`,
unchanged) and the existing replay harness (`../contextual-identity-2026-10-03/run.sh`).

## 1. Where the locality was lost (characterized before the change)

Data path: source window → shared discovery prompt → provider response →
`extractExperienceCandidates` → source-support gate →
`verifyComponentSourceAssertions` → `GeoEntityHint` → locality grounder →
`IdentityVerifier`.

The SolSalute page is **one** evidence record (`ev-1`). The caption
"Wine and lunch at Ojo de Agua in Lujan de Cuyo" is a Markdown image
caption placed **after Uco item 4 and before the "Lujan de Cuyo
Itinerary" heading**. It is outside the Ojo de Agua itinerary entry.

| Failure mode | Observed? | Evidence |
| --- | --- | --- |
| 1. Extractor omitted an assertion it received | **Yes, the loss point** | `run-gemini-1` raw output (previous dossier): Ojo de Agua emitted with `supportSpan` = its itinerary entry and **no `localityAssertion` key**. Spike A0/A1 below: 0 assertions. |
| 2. Extractor proposed, gate rejected | No | No run proposed one. The gate accepts the caption when proposed (unit tests). |
| 3. Evidence attribution lost | No | The candidate and the hint cite `ev-1` (`DECLARED_KEY_VERIFIED`). |
| 4. Admitted but not grounded | No | `Lujan de Cuyo` → `osm:relation:2989830` (GROUNDED), every replay that reached it. |
| 5. Candidate not emitted at all | **Yes, a separate failure** | The Luján candidate is missing in 5 of 8 Gemini replays, and in all 3 Groq replays (below). |

Baseline replay with the COLD #11 extractor (Cloudflare
`@cf/qwen/qwen3.8-27b`) on unmodified code: **HTTP 429**, daily free
allocation (10,000 neurons) exhausted (`baseline-cloudflare-1/`, no output).

## 2. Prompt-only versus bounded recovery (`spike-prompt-vs-recovery/`)

Same window, real providers, run by `spike.ts`. **A0** is the current shared
prompt. **A1** is A0 plus an explicit instruction to scan the whole evidence,
including captions, and always return the assertion. **B** is the bounded
recovery prompt: one call over the statements that literally name each
extracted component.

| Variant | Provider | Runs | Luján candidate present | Ojo de Agua locality proposed |
| --- | --- | --- | --- | --- |
| A0 | gemini-3.5-flash-lite | 3 | 1 | **0** |
| A1 | gemini-3.5-flash-lite | 3 | 1 | **0** |
| A0 | groq qwen/qwen3.8-27b | 1 | 0 (0 candidates) | 0 |
| A1 | groq | 1 | — | HTTP 429 (tokens per minute) |
| B | gemini-3.5-flash-lite | 3 | n/a (fixed input) | **3/3** `Lujan de Cuyo` LOCATED_IN, from the caption |
| B | groq qwen/qwen3.8-27b | 3 | n/a | **3/3** |

Prompt-only fails twice over: the extractor drops the candidate, and when
it keeps it, it drops the optional nested fact. Adding instructions (A1) did
not change that. The bounded pass asks one narrow question about a few
short statements, and both providers answered it every time.

An earlier exploratory B run, on the first prompt draft, exposed two
defects that were then fixed. Its output file was overwritten by run 1 and
is not preserved; the console result is quoted here:
- Gemini answered with names instead of ids. The schema now enumerates the
  ids.
- It reported "The Vines" (an estate) as SuperUco's locality. The prompt now
  excludes properties and venues. The backend cannot tell an estate from a
  town either, and an estate does not ground to an administrative boundary
  in any case.

## 3. Implementation selected

Bounded recovery (B), because the characterization shows prompt-only does
not produce the fact (§2). The mechanism is described in amendment §19.1,
and in the code in `be/src/modules/tours/utils/component-locality-recovery.util.ts`.

- **One producer.** `localityAssertion` was removed from the main extraction
  prompt and schema, and `extractExperienceCandidates` no longer reads it.
  Recovery is the only producer of a locality. The physical-kind assertion
  is unchanged.
- **Provider neutrality.** `LocalityRecoveringDiscoveryExtractor` wraps the
  configured extractor (`EXPERIENCE_DISCOVERY_PROVIDER`). Each provider adds
  only `completeStructured`, which is transport.
- **Groq defect found by the replay.** The shared LangChain transport formats
  the user prompt as an f-string template, so a literal `{` failed
  (`Single '}' in template`). This affected the recovery prompt's JSON
  example and any source text with braces. The Groq adapter now escapes
  braces. Its test runs the real `PromptTemplate` round-trip.

## 4. Real evidence-to-verdict trace (replays on the new code)

Harness: the application's extractor, so recovery runs on the same provider.
The real resolver, the real OSM grounder (local Nominatim and Overpass),
Geoapify, Wikidata, Overture AOI `rw4-uco-aoi-20261003`, stub catalog.

| Replay | Candidates | Recovery | Ojo de Agua |
| --- | --- | --- | --- |
| cloudflare-1 | — | — | **HTTP 429**: daily allocation exhausted. Not a result. |
| gemini-1 | Uco only | COMPLETED, no admitted locality | not extracted |
| gemini-2 | Uco only | COMPLETED, no reports | not extracted |
| gemini-3 | Uco only | COMPLETED, no reports | not extracted |
| gemini-4 | Uco only | COMPLETED, no admitted locality | not extracted |
| **gemini-5** | Uco + Luján | COMPLETED | **VERIFIED** `osm:node:4797394430` |
| **gemini-6** | Uco + Luján | COMPLETED | **VERIFIED** `osm:node:4797394430` |
| **gemini-7** | Uco + Luján | COMPLETED | **VERIFIED** `osm:node:4797394430` |
| gemini-8 | Uco only | COMPLETED; SuperUco REJECTED `LOCATION_QUALIFIED` | not extracted |
| groq-1..3 | Uco only | COMPLETED, no reports (after the brace fix) | not extracted |

Trace for gemini-5 (gemini-6 and gemini-7 are identical up to the relation
the model gave to "Melipal": OTHER or NEAR):

```text
Provider response   (extraction) Ojo de Agua hint, no locality
Recovery reports    ojo-de-agua s8 "Lujan de Cuyo" LOCATED_IN
                    ojo-de-agua s9 "Melipal" OTHER       (not admitted, not blocking)
Admission           ACCEPTED  locality "Lujan de Cuyo", ev-1,
                    supportSpan "Wine and lunch at Ojo de Agua in Lujan de Cuyo"
Grounding           GROUNDED  osm:relation:2989830 (Departamento Luján de Cuyo)
Selected candidate  NOMINATIM osm:node:4797394430 (Agrelo restaurant)
Decision            VERIFIED  (Córdoba hamlet osm:node:198407364 not selected)
```

When the Luján candidate exists, recovery produced the assertion 3 of 3
times. The candidate itself exists in 3 of 8 Gemini replays and in 0 of 3
Groq replays. That is failure mode 5, and it is not addressed here (§7).

Run gemini-8 shows the fail-closed path: Gemini reported two wineries as
`ALTERNATIVE` places for SuperUco, so SuperUco got no locality (it never had
one).

## 5. Internationalization

Each step was assessed separately. Unicode fixtures are synthetic.

| Step | Result |
| --- | --- |
| 1. Literal span verification | Works for any script (unchanged gate: lowercase and whitespace normalization). |
| 2. Component name inside its statement | **Fixed.** `literal-source-text.util.ts` folds compatibility forms, removes diacritics from Latin letters only, and uses ICU word boundaries. Japanese and Cyrillic match. A partial word, another script or a transliteration never matches. The previous `[^a-z0-9]` folding made every non-Latin name an empty string (fail closed). It also collapsed mixed-script names to their Latin part: "Café 青山" matched "Café 渋谷", and a source link could attach to the wrong venue. |
| 3. Explicit locality claim | Model-proposed. Its literalness and attribution are checked by the same Unicode-aware matcher. Japanese statements split on `。`. |
| 4. Grounding to a boundary | **Limitation, fails closed.** `OsmComponentLocalityGrounder` folds the locality with `normalizeGeoName`, which turns a non-Latin name into an empty string, so it returns `NO_BOUNDARY` with no provider call (pinned by a test). The local Nominatim covers Argentina only, so grounding outside Argentina was not exercised live. |
| 5. Candidate inside the boundary | Point-in-polygon, script-independent. |

Known limitations:
- A locality written with a suffix that the segmenter keeps in the same word
  (a Korean particle such as "강남구에") is not found. It fails closed.
- Hierarchical localities in one statement ("in Shinjuku, Tokyo") are refused
  as `SEVERAL_PLACES_IN_STATEMENT`. That fails closed and loses recall.
- **`normalizeGeoName` (64 callers, identity matching) collides
  across non-Latin names** (`normalize-geo-name-probe.txt`). "青山カフェ" and
  "銀座カフェ" both fold to `""`, so `buildIdentityEvidence` would emit
  `EXACT_NAME` for two different Japanese names. Changing it changes
  identity matching for every caller, which is outside this task's scope.
  It is recorded as RW4-I18N-NAME-1. Worldwide identity is **not** claimed.

## 6. Negative cases

Unit tests in `component-locality-recovery.util.spec.ts`. Adversarial
readers misclassify on purpose, to show that the deterministic backstops
hold.

- Heading, title, destination: never in the prompt. A place the statement
  does not write is discarded.
- Cross-variant (real window): a reader that claims Luján de Cuyo for every
  component gives it to Ojo de Agua only. The caption sits in the Uco
  section, yet no Uco component inherits it.
- A to B: a statement that also names another component attributes to
  neither (`STATEMENT_NAMES_ANOTHER_COMPONENT`).
- Another source record: statements are taken from the component's own
  cited evidence only.
- Same-name branches in two compositions sharing evidence: neither is
  examined (`SAME_NAME_IN_SEVERAL_COMPOSITIONS`), and no request is made for
  them.
- Negation and proximity: never admitted. Alternatives and same-name
  branches: `LOCATION_QUALIFIED`. Alternatives or a branch misread as
  containment: `SEVERAL_PLACES_IN_STATEMENT`. Disagreeing statements, a
  containment denied elsewhere, or a denial whose place the reader did not
  quote literally: `CONFLICTING_LOCALITIES`. The last rule was added after
  the replays. No replay produced a `NOT_IN` report, so no recorded outcome
  changes.
- Transliteration ("Shibuya" for "渋谷区") and a romanized component name:
  refused.
- Provider failure, unparseable answer, names instead of ids: nothing is
  admitted, and the extraction is unchanged.
- Ungroundable locality and ambiguous boundary: existing resolver and
  grounder tests (missing evidence, never a contradiction).

**Residual risk (accepted, documented):** the backend cannot detect, in a
language-neutral way, a reader that labels a single negated statement
("X is not in Tokyo") as `LOCATED_IN`. The relation is the model's semantic
judgement. Literalness, attribution and unanimity are deterministic, the
locality must still ground to a real boundary, and the verifier still
applies its contradiction rules. The previous path was weaker: it trusted
a co-occurrence check alone.

## 7. Not addressed (separate failures)

- The discovery extractor omits the Luján candidate in 5 of 8 Gemini and 3
  of 3 Groq replays. No candidate was fabricated.
- The Cloudflare replay is blocked by the daily allocation, so the COLD #11
  extractor is **not** shown fixed.
- Alfa Crux, SuperUco and Bodega Azul still have no discriminating fact (the
  source states no locality for them). A16 has no candidate.
