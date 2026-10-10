# Preference-First closeout decision — 2026-10-10

Status: **ACCEPTED AS FOUNDATION / GENERIC WEB ACQUISITION RETIRED AS PRIMARY AUTHORITY**

## Decision

The Preference-First branch is being closed as a research/architecture foundation.

This is not a claim that arbitrary web-search materialization is solved.

The accepted product/architecture decision is:

```text
generic web search + arbitrary prose
→ no longer the primary authority for canonical Experience creation

structured / provider-owned / open / official sources
→ preferred Experience acquisition authorities
```

The generic-web path remains useful as supporting evidence, enrichment or
experimental fallback, but future work must not assume that repeated fixes can
make arbitrary semantic search/extraction a reliable primary Experience factory.

## Why this track closes now

The track produced durable reusable foundations:

- canonical GeoEntity resolution and fail-closed identity;
- source-member persistence and partial composites;
- structural dedupe/reconciliation;
- Gather → Reconcile → Freeze → Plan;
- PostGIS final catalog snapshots;
- catalog/WARM reuse;
- walking/planning validation;
- Generation Trace / Bitácora evidence.

The final fresh-catalog COLD/WARM acceptance exercised both previously confirmed
merge blockers successfully:

- PF-REV-SNAPSHOT-WINDOW-1 remained CLOSED;
- RW4-ID-FALSE-VERIFY-2 remained CLOSED;
- Farmacia la Estrella and El Zanjón de Granados exercised the corrected
  retrieval-only convergence live;
- zero OVERLAP/NONE convergence decisions were incorrectly promoted.

However, WARM exposed a different latent defect:

```text
source prose: "...savor authentic empanadas"
→ atomizer emitted "empanadas" as a venue member
→ Nominatim returned a shop literally named "Empanadas"
→ GROUNDED_UNIQUE_EXACT_NAME VERIFIED
→ GeoEntity persisted
→ verifiedHintNames = {empanadas}
```

The false composite was not selected into the final Tour, but the incorrect
identity knowledge became durable and reusable.

Finding:

```text
PF-FINAL-ID-GENERIC-NOUN-1
```

This finding is retained as evidence of the limitation of arbitrary web
semantic materialization. It is **not** authorization for another lexical
heuristic, common-noun dictionary, threshold or case-specific identity patch.

## Final live evidence

Fresh DB:
`zigzag_spike_pf_final_20261009`

Request:
`requests/c3-buenos-aires-san-telmo-self-guided.json`

COLD:
- Tour `e7862054...`
- catalog 0 → 18 Experiences
- final snapshot epoch 3 = last acquisition epoch 3
- final Tour persisted and validator passed
- walking day total 8,164m / 10,000m
- longest continuous walk 2,724m / 3,000m
- no catalog duration invented; planner used the typed 90-minute fallback

WARM:
- Tour `529324be...`
- initial snapshot reused all 18 COLD Experiences
- final Tour Experiences/order/walking/durations identical to COLD
- non-routing provider calls 435 → 108
- one capacity refill added 2 NEW catalog Experiences

Local raw dossier (not committed by this document):
`spikes/pf-final-cold-warm-acceptance-2026-10-09/`

## GuruWalk direction

A separate characterization showed GuruWalk's public MCP as a strong structured
provider for free tours:

- provider itself asserts that the Experience exists;
- free-tour stop names arrive as an ordered array;
- no LLM is needed to discover the Experience;
- no LLM is needed to split free-tour members;
- stop identity still requires Zig-Zag resolution;
- provider terms do not establish permission to republish the itinerary as
  provider-independent Zig-Zag content.

Therefore the recommended model is provider-owned Experience integration,
with link/book provenance preserved.

Local raw dossier:
`spikes/guruwalk-structured-tour-2026-10-09/`

## Sequencing after merge

```text
merge Preference-First foundation to main
→ create new branch FROM accepted main
→ activate OpenSpec migration track
→ design next acquisition model cleanly
→ structured/provider-owned/open/official sources first
```

No additional generic-web identity/extraction patch is required to close this
track.
