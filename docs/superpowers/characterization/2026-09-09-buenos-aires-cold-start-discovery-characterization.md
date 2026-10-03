# Buenos Aires cold-start discovery characterization

Date: 2026-09-09  
Destination: Buenos Aires, Argentina (resolved area boundary `osm:relation:1224652`)  
Catalog: isolated PostgreSQL database `zigzag_characterization_20260909`  
Harness: `be/test/live/cold-start-experience-acquisition.live-spec.ts`  
Raw artifact: `/tmp/zigzag-buenos-aires-cold-start-characterization.json`

## Scope and method

This is a measurement-only run. Each scenario/provider run reset the isolated
catalog, normalized the same request with the existing preference vocabulary,
ran coverage analysis and acquisition planning, executed the existing structured
and grounded acquisition path, resolved and geographically validated candidates,
persisted the catalog, and re-queried it. No production discovery, ranking, or
schema was changed. Embeddings were intentionally unavailable so they could not
confound this retrieval characterization.

The bounded scenarios were: traditional bodegones, tango classes, milongas,
tango show, historical walks, architecture walks, craft beer, specialty coffee,
street art, and historic bookshops. Historical walks, milongas, and bodegones
were repeated once per provider.

The common downstream extractor was `GeminiDiscoveryProvider`; grounded retrieval
was varied between Tavily, Groq browser search, and Gemini grounded search. This
is a fairer comparison of retrieval than changing extraction for each provider,
but it means the extractor transport/model was Gemini (`GEMINI_DISCOVERY_MODEL`)
for all runs.

## Provider availability

| Provider | Runs | Observed state |
| --- | ---: | --- |
| Tavily | 13 | Available for all requested runs; evidence was returned in most runs. |
| Groq browser search | 13 | First two bodegones runs returned evidence; subsequent calls hit the Groq `openai/gpt-oss-120b` daily token limit (TPD 200000). Those runs are recorded as rate-limited, not as retrieval failures. |
| Gemini grounded | 13 | All grounded calls hit Gemini `429 RESOURCE_EXHAUSTED` quota. Gemini is therefore **NOT RUN / quota unavailable** for comparative retrieval purposes. |

Google Places also reached its configured daily SearchText quota during the run.
The existing provider logged this and the characterization continued. A Places
request with `place_of_worship` was rejected as an unsupported type. Neither event
was changed or hidden by the harness.

## Observed run summary

Counts below separate grounded web candidates from the much larger structured
acquisition/resolution pool; they are not quality scores.

| Scenario | Tavily evidence / web candidates / persisted | Groq evidence / web candidates / persisted | Gemini evidence / web candidates / persisted |
| --- | --- | --- | --- |
| traditional bodegones (2 runs) | 18–19 / 4–7 / 311–314 | 6–7 / 4–5 / 308 | 0 / 0 / 12, 308 |
| tango classes | 20 / 3 / 315 | 0 / 0 / 312 | 0 / 0 / 311 |
| milongas (2 runs) | 0–18 / 0–4 / 3–7 | 0 / 0 / 1 | 0 / 0 / 0 |
| tango show | 19 / 5 / 8 | 0 / 0 / 1 | 0 / 0 / 0 |
| historical walks (2 runs) | 18 / 5–6 / 399 | 0 / 0 / 396 | 0 / 0 / 395 |
| architecture walks | 1 / 0 / 307 | 0 / 0 / 307 | 0 / 0 / 307 |
| craft beer | 18 / 2 / 4 | 0 / 0 / 1 | 0 / 0 / 0 |
| specialty coffee | 19 / 3 / 4 | 0 / 0 / 1 | 0 / 0 / 3 |
| street art | 18 / 1 / 207 | 0 / 0 / 207 | 0 / 0 / 0 |
| historic bookshops | 18 / 3 / 337 | 0 / 0 / 337 | 0 / 0 / 336 |

The persisted counts include structured-provider results and therefore should not
be interpreted as grounded retrieval recall. In particular, very large counts
for historical walks, bookshops, street art, and architecture walks came from
structured acquisition/resolution rather than the web candidate count.

## Retrieval and source observations

Tavily returned useful-looking local or editorial evidence for bodegones (View
Buenos Aires), tango classes (La Morocha Tango), milongas (Adrián Luna and
Truly Tango), tango shows, historical walks, and street art (BBC Travel). It also
returned repeated SEO/tour aggregators such as Viator, GetYourGuide, TripAdvisor,
and generic “things to do” pages. Specialty coffee and craft beer queries often
returned food-tour pages rather than clearly venue-specific sources.

The two Tavily bodegones repetitions had only partial source overlap and web
candidate counts of 7 and 4. Milongas varied from no grounded evidence to 18
evidence items and four web candidates. This is an observable stability concern,
not a production stability score.

Groq's first grounded response exposed native browser-search provenance keys
(`groq-browser-search:*`) and produced 4–5 web candidates for bodegones. The
remaining Groq observations cannot support a provider comparison because the
account hit its daily token ceiling.

Gemini cannot support a provider comparison in this run because quota was
unavailable from the first grounded request onward.

## Resolution, geography, and factual risk

The resolver and geographic validation path ran against the Buenos Aires boundary
and real persistence. No exact famous-venue assertion was used. The large
structured pools show that resolution can accept many geographically resolvable
entities even when grounded web retrieval is sparse; this makes downstream
candidate provenance and relevance review important. The artifact retains each
candidate's resolution outcome, rejection reason, geographic result, canonical
name, components, evidence, and persisted identifiers for manual inspection.

This initial run did not perform a verified human fact-check of every candidate,
so hallucination/factual labels remain `UNREVIEWED`. The most suspicious signals
to inspect manually are generic tour/article candidates, thin component hints,
and runs where evidence was empty but structured persistence remained high.

## Human review worksheet

These labels are characterization-only and are not Experience status, `qualityScore`,
`curationStatus`, or a production quality subsystem.

| Scenario | Provider | Human label | Notes |
| --- | --- | --- | --- |
| Each scenario above | Tavily / Groq / Gemini | UNREVIEWED | Review evidence, candidate identity, geography, and usefulness against the raw JSON artifact. |

Allowed labels: `EXCELLENT`, `GOOD`, `MEDIOCRE`, `BAD`, `NOT_REAL`,
`UNREVIEWED`.

## Diagnosis and possible next experiments

### Retrieval recall problem

Likely present for long-tail concepts. Milongas was unstable (zero evidence on
one Tavily run), architecture walks returned only one source and no web
candidates, and craft beer/specialty coffee returned very few venue-specific
candidates. Manual review should determine whether obvious useful local options
are absent from both evidence and candidates.

### Retrieval precision problem

Likely present. Several queries were dominated by generic attractions, tour
marketplaces, SEO aggregators, or food-tour pages. This is especially visible for
specialty coffee and historical walks.

### Extraction problem

Not isolated cleanly yet. The common Gemini extractor had no grounded evidence
for Groq/Gemini after quota exhaustion, while structured candidates dominated the
pool. A follow-up should inspect evidence-to-candidate support on a smaller,
quota-available sample.

### Factual / hallucination problem

Not classified automatically. Empty-evidence runs with persisted structured
entities must be reviewed before attributing facts to grounded discovery.

### Resolution / geo problem

The real resolver and geographic validation completed, but the Google Places
quota and unsupported-type error reduced auxiliary coverage. This is an
observability/provider-health issue, not evidence that valid candidates were
incorrectly rejected.

### Quality / ranking signal problem

Not measurable conclusively here. Persisted counts are high in several runs, but
this characterization did not add a quality subsystem or impose a ranking
threshold. If manual review finds good and weak candidates coexisting in VERIFIED
catalogs, the next experiment could inspect the existing `Experience.qualityScore`
seam after verification.

### Source diversity / currency problem

Present as a hypothesis: Tavily frequently repeated marketplace and SEO sources,
with fewer clearly local/editorial or primary sources than desired. Source-domain
overlap and publication freshness should be reviewed from the raw artifact.

### Possible next experiments

1. Repeat a small representative set after quota reset (bodegones, milongas,
   historical walks) with Tavily and Groq available, measuring evidence/source
   and accepted-candidate overlap.
2. Test query/source-mix variants for specialty coffee, craft beer, architecture
   walks, and milongas without changing production architecture.
3. Manually label a bounded sample from the artifact, then determine whether the
   dominant issue is retrieval, extraction, factuality, or quality signal.
4. Only after that review, test the existing quality-score seam on VERIFIED
   candidates if discovery is demonstrably adequate.

No architecture is proposed or implemented by this document.

## Phase boundaries

- Post-F micro-hardening: complete (`cd33395`).
- Cold-start discovery characterization: complete for the executed run; Groq and
  Gemini comparisons are partial because of provider quota limits.
- Engine Quality Gate G: **NOT STARTED**.
- Argentina Live Smoke H: **NOT STARTED**.
- No `QualityAssessment` subsystem, curation schema, production discovery redesign,
  or OSRM integration was added.
