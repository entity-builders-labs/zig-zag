# Tasks

## 1. Track governance and canonical contract

- [ ] 1.1 Replace the planned change id `synthetic-experience-generation` with `gap-driven-destination-knowledge` in the track progress document (checkpoint, next authorized action) and `docs/superpowers/README.md`; verify `scripts/agent-track context` shows the new change and `bash scripts/agent-preflight` stays WRITE AUTHORIZED
- [ ] 1.2 Add the "Destination knowledge catalog and gap-driven research" section to `docs/architecture/activity-discovery-and-tour-generation.md` per design D11 (layers, write authorities, epistemic invariants, gap types, research/grounding boundary, stable identity rule, reusable vs Tour composition, status TARGET CONTRACT — spike-gated); verify every requirement heading in this change's specs maps to a statement in the section
- [ ] 1.3 Mark the superseded sections listed in design D11 as `SUPERSEDED (pending cutover)` with a pointer to the new section, and reword the proximity rule to "proximity never proves relevance"; verify by grep that each listed section carries the marker and no other section is altered

## 2. Spike scaffold, recording and typed stores

- [ ] 2.1 Create `spikes/gap-driven-destination-knowledge-<date>/` with README skeleton (question, contract pointer, run instructions), a run entry point using the backend toolchain and this worktree's imports only; verify an empty run executes and prints its trace header
- [ ] 2.2 Implement the recording/replay layer for search, fetch, LLM and geographic provider calls plus a spike in-memory replacement for `AiCacheService`; verify with a unit test that a replayed call makes no network request and that the trace counts live vs replayed calls per provider
- [ ] 2.3 Implement the typed contracts from design D4 and canonical key builders for assertions, gaps and reusable Experiences; verify unit tests show keys exclude user/score/day/neighbour/policy-version inputs and are stable across field ordering
- [ ] 2.4 Implement L1–L4 in-memory stores with JSON persistence and authority-typed write methods; verify unit tests that a store rejects a write without its authority token and that assertion upsert merges evidence for an equivalent claim

## 3. Readiness evaluation

- [ ] 3.1 Implement the versioned `ReadinessPolicy` and facet canonicalization (design D5, D6) over the existing preference interpretation output contract; verify unit tests for synonym wording mapping to one facet key and unmapped themes being dropped
- [ ] 3.2 Implement readiness evaluation for AREA_RELEVANCE, NOTABLE_PLACES and WALKING_CORRIDOR with ledger-aware suppression; verify unit tests for determinism, empty-catalog gaps, satisfied-knowledge suppression, INSUFFICIENT_EVIDENCE/BUDGET_EXHAUSTED suppression vs FAILED re-emission, recursive NOTABLE_PLACES emission after an area is known, WALKING_CORRIDOR scoped to the destination, and no WALKING_CORRIDOR when walking is only a permitted transport mode
- [ ] 3.3 Implement SCHEDULE_CAPACITY via a provisional plan with the real `GreedyDailyPlanningSolver` and `ApproximateTravelEstimateProvider`; verify a unit test where facet gaps are satisfied but residual capacity is meaningful emits the gap and discards the provisional plan

## 4. Bounded research agent

- [ ] 4.1 Implement search, fetch and catalog-read tools over existing provider services (Serper/Tavily search, web content fetch; never SerpApi) with evidence capture construction (prose span or structured field, fingerprint); verify unit tests on recorded fixtures produce well-formed captures
- [ ] 4.2 Implement the `ResearchAgent` tool loop with the existing LLM abstraction, epistemic-rules prompt without any site list, structured claim output and loop-enforced budgets; verify unit tests with fake tools for: no store write access, claims without captures discarded, claims of types not permitted for the gap discarded (including SCHEDULE_CAPACITY proposing only areas not already known), BUDGET_EXHAUSTED outcome
- [ ] 4.3 Report the research outcome (CLAIMS_PROPOSED, BUDGET_EXHAUSTED, NO_EVIDENCE_FOUND, TOOL_FAILURE) with gap key, budget used and snapshot epoch as input to gap-outcome recording; verify a unit test that the outcome is returned and the ledger is unchanged after research

## 5. Grounding

- [ ] 5.1 Implement provenance verification (REPRODUCIBLE, PUBLISHER_ESTABLISHED, publisher independence; fingerprint drift reporting) and the constrained support verifier (EXPLICIT/IMPLICIT/NONE) stored on the capture, per design D8; verify unit tests for EVIDENCE_NOT_REPRODUCIBLE, EVIDENCE_DOES_NOT_SUPPORT_CLAIM, and a verified publisher with a passing mention not supporting the claim
- [ ] 5.2 Implement subject identity resolution through existing geographic resolvers (Nominatim/Overpass areas, OSM/Places places, `TargetedRouteResolverService` for routes, `IdentityVerifier` policy) with L1 writes only through `GeographyResolution` results; verify unit tests for IDENTITY_AMBIGUOUS, RESOLUTION_UNAVAILABLE and new-entity recording through the resolution authority
- [ ] 5.3 Implement geometric consistency and corridor bounds (STATED_ANCHORS and AREA_CLIP, no invented endpoints); verify unit tests for GEOMETRY_INCONSISTENT, a stated-anchors Defensa fixture and an area-clip fixture
- [ ] 5.4 Implement claim-type authorization predicates and the spike sufficiency rule per design D8, ignoring `proposedAuthorityClass`, with no domain allowlist or government-domain special case; verify unit tests: single capture with established publisher and EXPLICIT support → authorized; agent-labelled "official" capture with unestablished publisher → requires an independent corroborating capture; government-hosted capture without explicit support → not authorized; RELEVANT_FOR citing only OSM data → rejected
- [ ] 5.5 Record the gap outcome once after grounding and readiness re-evaluation (SATISFIED, INSUFFICIENT_EVIDENCE, BUDGET_EXHAUSTED, FAILED) through `GapOutcomeRecording`; verify unit tests: all claims rejected → INSUFFICIENT_EVIDENCE and suppressed within the freshness window; resolver or tool failure → FAILED and not suppressed; gap no longer emitted → SATISFIED

## 6. Reusable Experience composition

- [ ] 6.1 Implement PLACE_VISIT and CORRIDOR_WALK derivation (keys, admission, clipped segment geometry, stops ordered by projection, policy durations, unknown opening hours) per design D9; verify unit tests that repeated composition is identical and that keys match the stable identity rule
- [ ] 6.2 Implement upsert-by-key, content revisions and archival; verify unit tests for new stop → same key with new revision, policy version bump → no duplicates, corridor assertion retraction → archived
- [ ] 6.3 Implement projection to `PlanningExperienceCandidate` (POINT vs LINE footprints, start/end footprints, component footprints); verify a unit test that the real solver plans a CORRIDOR_WALK routed along its stops

## 7. Tour composition boundary

- [ ] 7.1 Implement Tour composition over the final snapshot producing Tour-snapshot-shaped output with optional stop trimming and travel legs; verify unit tests that an unoffered identity is rejected, trimming appears only in the snapshot, and the L4 store is unchanged after composing a Tour

## 8. End-to-end runs and evidence

- [ ] 8.1 Run A live ("Buenos Aires, 4 days, history, food, walking") from empty L2/L3/L4 with recording; verify the trace shows recursive gaps (destination → San Telmo or other discovered areas), grounded assertions with captures, at least one CORRIDOR_WALK, and a plan containing it as a LINE
- [ ] 8.2 Run B ("Buenos Aires, 2 days, history") and Run C ("Buenos Aires, 3 days, food") against Run A's stores; verify zero research for every gap key Run A recorded as SATISFIED, that any other research is listed by gap key with evidence that Run A never evaluated that key, no new L4 keys beyond what new L2 writes justify, and different Tours reusing the same Experience ids
- [ ] 8.3 Run the mutation checks (add a grounded place along the corridor; retract the corridor assertion; bump composition policy version); verify same key/new revision, archival, and no duplicates respectively
- [ ] 8.4 Hand-label a sample of grounded and rejected claims and report false accept/reject rates, research cost per gap, ledger outcomes, and corridor geometry as GeoJSON; verify the numbers and files are in the spike directory
- [ ] 8.5 Write the spike README verdict (PROCEED / PROCEED_WITH_CONDITIONS / REVISE_CONTRACT) with policy values and rationale, observations on food/meal slots and AREA_WALK stability, and the production cutover prerequisites; verify `git diff --stat` against the base shows no changes under `be/` or `fe/`

## 9. Track closeout for this change

- [ ] 9.1 Update the track progress document (verdict, checkpoint, next authorized action = production cutover change proposal or contract revision, open findings) and record the spike pointer in the canonical section status; verify `scripts/agent-track context` surfaces the new state and preflight passes

## Workflow follow-up

- Do not archive this change (syncing its specs into `openspec/specs/`) on spike completion alone: the specs would then claim production behavior. Archive together with, or after, the production cutover change.
- Open the production cutover change (schema for L2/L3/L4 and segment bounds, generation wiring, deletion of the superseded pipeline and catalog contents) only if the spike verdict allows it.
