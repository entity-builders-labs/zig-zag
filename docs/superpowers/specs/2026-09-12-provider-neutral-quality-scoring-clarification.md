# Provider-Neutral Quality Scoring — Canonical Clarification

Status: **canonical clarification to §10.1 of `2026-09-10-preference-first-selection-and-agent-convergence-design.md`.**
Written: 2026-09-12.

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md` §10.1
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md` B3
- `be/src/modules/integrations/google-places/interfaces/places-api.interface.ts`
- `be/src/modules/integrations/google-places/services/geoapify-places-api.service.ts`

This clarification is normative for B3 and later quality-scoring work. It does not authorize implementation by itself and does not change the separation between deterministic scoring and later agentic/research acquisition.

## 1. Quality is provider-neutral

`Experience.qualityScore` is a deterministic aggregation of **available grounded quality evidence**. It MUST NOT assume that the active `PLACES_PROVIDER` is Google or that every Places implementation exposes rating/review data.

The provider-neutral `PlaceData` contract makes `rating` and `userRatingCount` optional. Current providers differ materially:

```text
Google Places  -> rating/review-count may be available
Geoapify       -> rating/review-count are unavailable
```

Therefore Places rating and review-count confidence are **optional quality signals**, not mandatory inputs.

Missing provider capability means **unknown / unavailable evidence**. It never means:
- rating `0`;
- review count `0` as a factual popularity assertion;
- a quality penalty;
- automatic failure of the quality floor;
- a synthetic default score.

The scorer MUST NOT branch into a hidden policy equivalent to `PLACES_PROVIDER === 'google' ? good : weak`.

## 2. Canonical signal semantics

B3 may derive quality from any grounded signals currently available, including:
- direct Places rating + review-count confidence, when the active provider actually supplied them;
- Wikivoyage listing evidence;
- Wikidata sitelink/notability evidence;
- grounded quality/notability signals from resolved components of a multi-component Experience;
- future normalized grounded quality evidence collected by the agentic/research layer.

No source is individually mandatory. Missing evidence from one source does not erase valid evidence from another.

Conceptually:

```text
available grounded evidence
  ├─ Places rating/review confidence (optional)
  ├─ Wikivoyage
  ├─ Wikidata/notability
  ├─ resolved component quality/notability
  └─ future normalized agentic/research evidence
                 ↓
       deterministic quality policy
                 ↓
        qualityScore: 0..5 | null
```

If no sufficient grounded quality signal exists after considering the available sources, the result is:

```ts
qualityScore = null
```

`null` means unknown/insufficient evidence. It is preferable to inventing a score.

## 3. Geoapify-specific acceptance

With `PLACES_PROVIDER=geoapify`, the absence of `rating` and `userRatingCount` is expected provider behavior. A Geoapify-originated Experience can still receive a non-null quality score when Wikivoyage, Wikidata or resolved-component evidence supports it.

A Geoapify-originated Experience with no other quality evidence remains `qualityScore=null`; it does not receive a low score merely because the provider does not expose reviews.

This rule applies equally to future providers with partial capability sets.

## 4. Composite Experiences

A route/walk/multi-component Experience MUST NOT become weak solely because the composite has no direct Places rating. Component evidence remains a first-class quality source.

The aggregation policy must be deterministic and named. It may use a robust component aggregation (for example a bounded mean/top-component blend), but MUST NOT assign a flat magic route score.

Missing direct rating and missing component rating are independent absences; other grounded notability sources may still support quality.

## 5. Agentic/research convergence

Later agentic research is expected to improve quality evidence coverage, especially where Places providers do not expose ratings or where the Experience is not naturally represented as a single POI.

The agentic/research layer may collect grounded claims/facts from reputable sources and normalize them into explicit quality evidence. It MUST NOT invent a fake “Google-equivalent rating” or make an LLM-authored scalar authoritative.

The boundary remains:

```text
research/discovery -> grounded evidence/provenance
deterministic B3-style policy -> qualityScore
```

Thus richer future research improves the evidence set without changing the deterministic authority of the quality scorer.

## 6. Required regression coverage

B3 acceptance MUST include at least:
- same rating, many reviews > same rating, two reviews;
- Google-like rating/count can contribute when present;
- absent rating/count does not become zero or a penalty;
- `PLACES_PROVIDER=geoapify`-shaped input can produce non-null quality from WV/WD evidence;
- Geoapify-shaped input with no other usable signals returns `null`;
- WV/WD can produce non-null quality without Places rating/reviews;
- a multi-component walk with no direct rating can clear the quality floor from grounded component signals;
- zero usable grounded signals -> `null`;
- identical provider-neutral evidence produces the same score regardless of which provider omitted unrelated optional fields.

These tests protect the architectural invariant: **missing capability is unknown, not negative evidence.**
