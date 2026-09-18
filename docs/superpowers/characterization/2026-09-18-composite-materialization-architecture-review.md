# Composite Materialization Architecture Review (2026-09-18)

Adversarial review of a user-proposed 10-change/8-milestone architecture
plan for improving composite Experience materialization, requested
explicitly against the real code on `feat/preference-first-selection`
(verified: local HEAD `b3155e4` == `fork/feat/preference-first-selection`,
no drift). No code changed as part of this review — analysis only, per the
request ("No implementes nada todavía").

Full proposed plan (Changes 1-10, Milestones P0-P8, 18 numbered questions)
lives in the conversation this document summarizes; not reproduced
verbatim here. This file captures the verified findings, the corrected
assumptions, and the resulting recommendation.

## Two corrected assumptions (both verified against real code/behavior)

1. **"Discovery LLM está apagado actualmente" — false.** `DISCOVERY_EXTRACTOR_PROVIDER=groq`
   in the standing `.env`, model `qwen/qwen3.8-27b`
   (`ai.config.ts` line ~214). Confirmed live this same session: the
   composite candidates observed in the Task A9 live runs ("Premium Buenos
   Aires City Tour", the `role: "area"` misclassification on "Plaza de
   Mayo") are this LLM's own output. Any plan assuming it is off (e.g.
   reasoning about `compositionEvidence` as if there's no active
   generator to constrain) needs to account for the LLM being live, not
   design around its absence.
2. **"Geoapify Places es un no-op" — false as of commit `1c19d85`**
   (`feat(places): implement real Geoapify named-venue text search (was a
   no-op stub)`, 2026-09-17). The 2026-09-15 adversarial review this
   branch's earlier work cites, and this reviewer's own first answer in
   this same conversation, both repeated the now-stale claim. Geoapify's
   `searchText` makes a real autocomplete call today when `locationBias` is
   present (always true in `resolveViaPlaces`).

## Verified findings, by question

**Is OSM-heavy resolution a material factor in false negatives?** Yes, but
not the dominant one measured this session — `role` misclassification
(discovery-side) and Places-rank-0-blind-trust (resolver-side) accounted
for more of the measured loss than "OSM lacks the place" did. See the
companion live-remeasure doc.

**Is `GeoEntityHint` provenance loss from `SourceObservation` real?**
Yes, confirmed at the exact line: `structured-experience-candidate-synthesizer.service.ts`
lines 14-49 build every `GeoEntityHint` from `obs.title`/`obs.evidenceType`
only, never `obs.externalId`/`obs.geo`/`obs.canonicalIdentity.wikidataQid` —
despite the same function explicitly forwarding `obs.qualityEvidence`
(line 65), proving the omission is not an oversight of what's possible, just
what was wired. `StructuredCandidateProposal`'s own doc comment says the
richer envelope "disappears before downstream resolution";
`ExperienceResolutionRequest.candidates: ExperienceCandidate[]` confirms the
resolver never receives `observations` as shipped at review time.

**What already exists, partially or fully?**
- The composition/entity/geographic-truth 3-layer separation the plan
  asks for is **already the real architecture** — Entity Resolution and
  `CompositeGeographicValidationService` are already distinct
  stages/services.
- `CanonicalIdentity.wikidataQid` already exists on `SourceObservation`,
  already read by `StructuredCandidateCorroborationService` for its own
  dedupe — just never forwarded to the resolver (see above).
- Direct-QID Wikidata confirmation existed, as of this session, only for
  the OSM-tag path (`confirmViaOwnWikidataTag`, built earlier the same
  session) — later generalized (see "What was actually built" below).
- Places top-N reconciliation did not exist (`resolveViaPlaces` took
  `result.data[0]` unconditionally).
- Provider-swappable grounded search already exists (`GroundedSearchProvider`,
  implemented identically by SerpAPI/Tavily/Groq/Gemini).
- Some structural evidence tagging already exists
  (`ExperienceGroundingEvidenceKind`: `list_item`/`narrative_paragraph`/
  `reference`/`organic_result`) but evidence stays snippet-only even where
  Tavily could extract full source content.

**What conflicts with existing invariants?** Making OSM non-mandatory for
PLACE does not conflict with the architecture doc's own invariant #4
("Google Places and OSM supply authoritative identity") — Places is
already named as co-authoritative. The real risk is elsewhere: if a new
identity-provenance field is added to the same `GeoEntityHint` type the
LLM's own JSON schema also populates, it must be actively fenced off from
that path (a test asserting the LLM path never sets it), not merely assumed
safe by convention.

**False-positive risks of dropping OSM-required-for-PLACE:** chain/franchise
ambiguity (many real branches of one real business, all genuinely
name-matching), and coordinate-only confirmation being insufficient on its
own (the same OSM duplicate-name-node risk found live this session for
"Plaza de Mayo" — several real nodes sharing the literal name, one of them
a transit stop, applies just as much to any provider).

## What was actually built and live-verified this session (not just proposed)

Five targeted, TDD'd fixes, each independently tested and typechecked
(1539/1539 backend tests green, `yarn typecheck`/`yarn lint:check` clean):

1. `selectBestPlaceCandidate` (`experience-proposal-resolver.service.ts`) —
   Places top-N reconciliation: exact-name match wins over rank; multiple
   exact matches (a real chain) tie-broken by distance to the destination;
   falls back to rank-0 only when nothing matches by name at all.
2. `confirmMatch`'s known-QID check generalized: `entity.wikidataQid ??
   findObservationQid(hint, observations)` — a `SourceObservation.canonicalIdentity.wikidataQid`
   now also counts, threaded through as a new `observations?: SourceObservation[]`
   field **sibling to** `candidates` on `ExperienceResolutionRequest`
   (never merged into `GeoEntityHint` itself, precisely to keep the LLM's
   own JSON contract untouched — this directly answers the plan's own
   provenance-boundary question).
3. `role: "area" → venue` fallback in `resolveCandidate`: an AREA-role hint
   that fails both the boundary match and the Nominatim administrative-area
   path retries once against the local POI pool, using a corrected hint
   copy (`role: "venue"`, `expectedKind: "PLACE"`) so the persisted
   `GeoEntity.kind` reflects what actually resolved. Live-verified fix for
   "Plaza de Mayo"/"Retiro"-type hints.
4. `matchOsmCandidateByName`'s fuzzy branch (`nominatim-match.util.ts`) now
   picks the pool's **best** fuzzy match (most matched significant tokens,
   then own-`wikidata`-tag presence as tiebreak) instead of the first one
   `.find()` happened to return — same discipline the exact-match branch
   already had. Live-verified: this is what actually fixed the "Galería
   Güemes" collision at its root (see the companion live-remeasure doc) —
   the confirmation gate was only ever catching this as a symptom, never
   the cause.
5. `confirmMatch` now also checks the matched candidate's own `name:xx` /
   `official_name` / `alt_name` / `short_name` / `loc_name` tags and the
   title inside `wikipedia=xx:Title`, before any network call — a direct
   declaration by the same real record, not an independent cross-reference.

Measured impact (same harness, same 6-theme methodology, before/after):
composite persistence rate **8.3% → 33.3%**, ~4x, with the Güemes
collision fixed at its root and no evidence of any collision reopening
(Recoleta Cemetery did not appear as a hint in either run this session —
not re-verified, not assumed safe).

## Recommendation: what's next, ranked

1. **Re-verify "Recoleta Cemetery" live** the next time it naturally
   appears in a run — the non-negotiable requirement's two founding
   collision cases both need standing live evidence, not one stale
   confirmation from weeks ago.
2. **`role` misclassification in the other direction** (a genuine
   neighborhood tagged `role: "waypoint"`/`"venue"` instead of `"area"`) —
   real, measured this session (e.g. "Puerto Madero" inconsistently
   resolving depending on which role the same LLM run assigned it), not
   covered by Fix 3, needs its own design (a mirrored fallback, or a
   determinstic post-hoc reclassification).
3. **Discovery-extraction paraphrase drift** ("City Museum" for "Museo de
   la Ciudad") is a prompt/extraction-quality problem, not an
   entity-resolution one — no safe resolver-side fix exists for a name
   that shares no real tokens with the actual place.
4. Everything else in the original 10-change plan (provider-neutral
   gather/reconcile/verify refactor, `compositionEvidenceKeys` as a
   required field, full source-content extraction) remains **not
   started, deliberately** — no live evidence yet that these are the
   actual next-highest-leverage levers versus the three items above, and
   at least one of them (mandatory `compositionEvidenceKeys`) risks
   breaking today's one working composite path without a single observed
   case of the fabricated-composition failure mode it targets.
