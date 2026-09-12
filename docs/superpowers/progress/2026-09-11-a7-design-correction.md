# A7 Design Correction — Exploration Signals Replace Iconicity

Status: **A6/A6.1 APPROVED; A7 redefined before implementation**
Branch: `feat/preference-first-selection`
Written: 2026-09-11

Approved A6/A6.1 branch HEAD before this docs correction:
`088ca4fea32cd91cf256e6c57bf09ce6b1a86dce`

Canonical A7 spec addendum:
`docs/superpowers/specs/2026-09-11-exploration-signals-design.md`

Canonical A7 implementation plan:
`docs/superpowers/plans/2026-09-11-a7-evidence-backed-exploration-signals.md`

---

## Review decision

The old main-plan A7 wording:

```text
A7 — Iconicity util
computeIconicity(): 0..1
```

is superseded before any A7 code was written.

`explorationStyle` remains a useful user preference, but it is not a standard
Experience taxonomy and must not force each Experience into an `iconic` vs
`local` category.

A7 now models independent evidence-backed signals:

```text
prominence
tourismIntensity
localCharacter
```

with explicit unknown state and provenance.

Canonical corrections:
- low prominence is not evidence of local character;
- high prominence is not evidence of low quality;
- tourism intensity is not inferred from popularity alone;
- missing evidence is `unknown`, not zero;
- `local_deep_dive` is not `1 - prominence`;
- explorationStyle remains ranking-only and outside coverage/sufficiency/
  acquisition authority.

---

## Execution gate

```text
A1    ✅
A2    ✅
A3    ✅
A4    ✅
A5    ✅
A6    ✅
A6.1  ✅ APPROVED
A7    ⏭️ NEXT — Evidence-Backed Exploration Signals
B1    ⛔ do not start before A7 review
```

The agent must read the new A7-specific plan/spec and treat them as authoritative
over older `iconicity` wording in the main plan/spec.

No A7 implementation exists yet at the time of this correction.

No meaningful local-app manual test is expected from A7 itself; it is a pure
ranking primitive and is not live-wired until later composition/orchestration
checkpoints.
