# Identity ambiguity policy: characterization before the fix (2026-10-03)

Starting HEAD: `c708b9a9`. This file records the evidence analysis done
before any code change. It covers three defects in how `IdentityVerifier`
and the resolver treat competing same-name records.

## Vocabulary

- **Admission scope.** The set of locations where an acquired record may
  become this component. It is decided by the canonical
  `admitComponentLocation` policy. For a destination-bounded Experience it
  is the destination (or the work-unit anchor, or the candidate-owned
  area). For a source-defined regional Experience that may extend beyond
  the destination (§P2-18, `admitsCountryBoundedBeyondDestination`), it is
  the destination country.
- **Material competitor.** A record that meets all of these conditions:
  - It answers to the hint's name, or to the candidate's own name, or
    declares an alias matching the hint.
  - It lies inside the admission scope.
  - No component-specific source fact excludes it. Those facts are a
    grounded locality it lies outside, or a stated kind its structure
    contradicts.
  - It is a different physical identity from the candidate.

  The destination is not a component-specific fact. It excludes nothing
  beyond what admission already excludes.
- **Complete pool.** A pool whose search extent covers the whole admission
  scope and whose answer was not cut off. Three kinds qualify:
  - An untruncated Nominatim search bounded to the country.
  - An Overture snapshot marked `COMPLETE_COUNTRY`.
  - An untruncated local OSM pool or Places circle, when the Experience is
    destination-bounded. This is the accepted single-destination contract
    (P0.2, Galería Güemes G1).

  A pool bounded to the destination is **partial** for a regional
  Experience. So are a saturated window and a partial snapshot.

## Facts by role

| Role | Facts |
| --- | --- |
| Positive correspondence (discriminating) | Grounded locality or kind that singles out one member (`CONTEXTUAL_CORRESPONDENCE: DISTINGUISHED`). A source-declared QID equal to the candidate's QID. A source address matched by the candidate (`ADDRESS_MATCH`). A recorded prior verification (`CATALOG_VERIFIED_HINT_MATCH`). A single structural route cluster. |
| Positive correspondence (record-level, not discriminating) | `EXACT_NAME`, `DECLARED_ALIAS_MATCH`, `IDENTITY_CONVERGENCE` (two lookups for the hint land on one strong identity), Wikidata `OWN_QID` or `NEARBY` corroboration |
| Uncertainty (NOT_CORROBORATED) | Multiplicity `UNKNOWN`, a partial pool, a saturated window, an undetermined upstream, a provider failure, an ungrounded locality, Wikidata unavailable, and any `NEARBY` result other than one item naming both the hint and the candidate (RW4-ID-NEARBY-1) |
| Contradiction (REJECTED) | A source QID that differs from the candidate's QID. A record outside a grounded component locality. A structure that contradicts a stated kind. |

A record-level fact says that a record matches the hint text. It says
nothing about **which** homonym the source meant. It can decide identity
only when the competitor set has been examined and holds no material
competitor.

## Decision table

| Evidence | What it establishes | Decision |
| --- | --- | --- |
| Shared-upstream convergence, complete pool holds only the candidate | The record matches the hint, and no other admissible record answers to the name | VERIFIED |
| Shared-upstream convergence, coverage unknown, no competitor observed | One record found twice. Nothing established about competitors. | Not decisive. Needs a complete pool, a discriminating fact, or a provider-local `SINGLE` under the destination contract. |
| Shared-upstream convergence, known homonyms | Which homonym the source meant is undecided | AMBIGUOUS, unless locality or kind, a source QID or an address distinguishes the candidate |
| Independent-upstream convergence, known competing identity | The record exists in two datasets. Source intent is undecided. | AMBIGUOUS. Independence corroborates existence, not intent (Defect C). |
| Independent-upstream convergence, no competitor known, coverage partial | Same as above, with nothing established about competitors | Not decisive (INSUFFICIENT_EVIDENCE if nothing else) |
| Explicit source locality, one compatible member, complete pool | Discriminating correspondence | VERIFIED (no country-wide uniqueness needed) |
| Explicit source locality, two compatible members | Two equally consistent members | AMBIGUOUS |
| Exact name `SINGLE` from a destination-bounded local or Places pool | Uniqueness inside the destination | VERIFIED only for a destination-bounded Experience (the accepted contract). For a regional Experience the pool is partial, so `UNKNOWN`. |
| Exact name `SINGLE` from one provider, `MULTIPLE` (material) from another | A competitor is known for the hint | AMBIGUOUS. The hint-level `COMPETITOR_EXAMINATION` carries it to every later decision (Defect B). |
| Verified canonical catalog identity (hint memory) | A recorded prior verification of this exact hint key, in scope | VERIFIED when no locality contradicts it. A contradicting stated locality makes it REJECTED and acquisition continues. |
| Explicit source/candidate QID conflict | Two identifiers, so two entities | REJECTED |

## Defect characterization at `c708b9a9`

### Defect A: absence of a known collision treated as proof that none exists

`collisionKnown` was built only from the two converging acquisitions' own
pools. When it was false, the code verified. That happened in five
situations:

1. `CONVERGENCE_PROVENANCE` absent. Any caller that omits it verifies on
   convergence alone (verifier unit test "verifies immediately on
   IDENTITY_CONVERGENCE, with no other evidence needed").
2. Both pools partial. Concrete false positive: a regional Experience
   (`ownedAuthorization('route_like')`, Ciudad de Mendoza). The local OSM
   pool holds one in-destination "Ojo de Agua". It verifies on the spot
   through a provider-local `EXACT_NAME/SINGLE`. If that fails, Places
   (circle) converges on the same node over the shared OSM upstream with
   `nameCollision: false` and still verifies. The source meant the Luján de
   Cuyo restaurant, 29 km outside the destination. Neither pool covers the
   admission scope (the country).
3. A saturated Nominatim window: the exact count is `UNKNOWN`, which is
   not a collision.
4. A Nominatim failure. Nothing examined the country.
5. A collision seen by a third strategy whose selected member was a
   different identity. That knowledge was keyed per identity, not per
   hint, so it never reached the convergence check.

### Defect B: provider-local SINGLE ignores ambiguity found elsewhere

`EXACT_NAME.identityMultiplicity` is computed inside each pool. A Places
circle with one exact member reports `SINGLE`, even after Nominatim
returned two admissible homonyms. The verifier saw only the Places pool,
so the decision depended on which provider ran last.

### Defect C: independent upstreams outrank known ambiguity

`provenance.upstream === 'INDEPENDENT_UPSTREAMS'` returned VERIFIED before
the contextual or name-collision checks. The verifier unit test
"independent upstreams agreeing on one identity decide even a collision"
asserted this directly.

## Why RW1 survives without new evidence

| Case | Original evidence | Fact that decides |
| --- | --- | --- |
| El Zanjón de Granados | Local pool `[osm:node:9953027884]`. Nominatim country-bounded response holds exactly that node (1 result, window not reached). NEARBY item labeled with the hint only. | NOMINATIM converges with LOCAL_OSM_POOL. Nominatim's untruncated country pool holds only the candidate, so there is no material competitor. |
| Farmacia la Estrella | Nominatim country-bounded response holds exactly osm:node:3348573778, "Farmacia de la Estrella" (1 result). The Geoapify circle holds 1 result whose Place Details declare the same node. | Places converges with Nominatim. The complete Nominatim pool holds only the candidate (named exactly as the candidate), so there is no material competitor. |

Both cases already carried a complete examination: the country-bounded
Nominatim response was untruncated and held only the candidate. The new
policy reads that fact explicitly. It injects nothing.

## NEARBY non-corroboration (RW4-ID-NEARBY-1, after `272d50ef`)

`WIKIDATA_IDENTITY_MATCH` with `source: NEARBY` records text matches of
labels found within 200 m of the candidate's own point. The collector sets
`hintMatched`/`candidateMatched` from `requireAllTokens` name overlap.
`NEARBY(true, false)` means a nearby label names the hint text but no
single label names both. In El Zanjón, the candidate's descriptive
"(historic ruins)" suffix alone defeats the candidate-side match.

Neither partial combination identifies an incompatible entity. Until
`272d50ef` the verifier returned REJECTED for `NEARBY(true, false)` and
`NEARBY(false, true)` whenever nothing decided earlier. That collapsed
NOT_CORROBORATED into CONTRADICTED, against amendment §6.

The corrected rule is that every `NEARBY` combination except `true/true`
is NOT_CORROBORATED, so the decision falls through to the remaining
evidence and the multiplicity fallback. Rules 1 to 6 are unchanged and
still run first: contradictions, discriminating facts,
`COMPETITOR_EXAMINATION` and convergence over an examined set.
`NEARBY(true, true)` keeps its accepted meaning: it confirms only a
candidate with no known name collision and never decides one.

| NEARBY | Other evidence | Before (`272d50ef`) | After |
| --- | --- | --- | --- |
| (true, false) | none | REJECTED | INSUFFICIENT_EVIDENCE |
| (false, true) | none | REJECTED | INSUFFICIENT_EVIDENCE |
| (false, false) | none | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |
| (true, false) | convergence, no competitor examination (Test B) | REJECTED | INSUFFICIENT_EVIDENCE |
| any | `MATERIAL_COMPETITOR_KNOWN` | AMBIGUOUS | AMBIGUOUS |
| (true, false) | convergence + `NO_MATERIAL_COMPETITOR` | VERIFIED | VERIFIED |
| (true, false) / (false, true) | `EXACT_NAME` MULTIPLE | AMBIGUOUS | AMBIGUOUS |
| (true, false) | `EXACT_NAME` SINGLE | VERIFIED | VERIFIED |
| (true, true) | no collision, nothing else | VERIFIED | VERIFIED |
| (true, true) | `EXACT_NAME` / alias MULTIPLE | AMBIGUOUS | AMBIGUOUS |
| any | `IDENTITY_CONTRADICTION` (QID, locality, kind) | REJECTED | REJECTED |
| (true, false) | `SOURCE_DECLARED_IDENTITY_MATCH` | VERIFIED | VERIFIED |
| — (Wikidata unavailable) | `EXACT_NAME` SINGLE, or convergence + `NO_MATERIAL_COMPETITOR` | VERIFIED | VERIFIED |

The "Before" column was produced by running the new tests against
`272d50ef`'s verifier. Exactly the rows marked as changed differed.

`OWN_QID` and `OBSERVATION_QID` are untouched. The collector always sets
`candidateMatched: true` for `OWN_QID`, so its only failing production
shape is `(false, true)`: the candidate's own item does not name the hint.
`OBSERVATION_QID (true, false)` means the source's item does not name the
candidate. Both stay REJECTED. They compare labels on an item structurally
linked to one side; they are not a typed QID contradiction. That concern
is recorded separately as RW4-ID-QID-LABEL-1 and is not changed here.
