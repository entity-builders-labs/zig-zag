# OpenSpec Documentation and Governance Cutover — Proposed Track

Status: **PROPOSED / NON-BLOCKING / NOT YET ACTIVE**  
Created: 2026-10-09  
Current host branch: `feat/preference-first-selection`  
Activation base: **accepted `main` after Preference-First merge**

This document records a future documentation/governance migration track using
the repository's current documentation format.

It is intentionally **not ACTIVE** yet and therefore has no `progress/` file
or `agent-track` header. It must not delay the remaining Preference-First
blocker closure, final merge reconciliation, or merge to `main`.

## 1. Goal

Migrate Zig-Zag's durable specification/change workflow toward OpenSpec so
future work uses a simpler model:

```text
stable capability specs
+ self-contained active changes
+ explicit design
+ task/progress state
+ archived completed changes
```

while preserving Zig-Zag's stronger multi-agent safety, review and evidence
discipline.

## 2. Hard sequencing decision

Do **not** create another descendant feature branch from
`feat/preference-first-selection`.

```text
close remaining Preference-First blocker(s)
→ final review reconciliation
→ merge Preference-First to main
→ create OpenSpec migration branch FROM accepted main
→ activate this track there
```

The future OpenSpec branch must be created from the accepted `main` commit,
not from the long-lived Preference-First branch.

## 3. Migration hypothesis

Initial target is an OpenSpec-compatible hybrid, not blind deletion of current
governance.

```text
OpenSpec
  → stable behavioral specs
  → change proposals / delta specs
  → design
  → tasks/progress
  → completed-change archive

Zig-Zag retained layers
  → AGENTS.md safety/engineering contract
  → Git worktree/branch isolation
  → preflight/integration safety
  → roadmap/product sequencing where still useful
  → immutable spikes / forensic evidence
  → PR/review boundary
```

The track must prove which current mechanisms become redundant before deleting
them.

## 4. Core questions

1. Can OpenSpec become the canonical home for durable capability specs?
2. Can OpenSpec change artifacts replace most implementation plans?
3. Can `tasks.md` replace most `progress.md` execution state?
4. How does a fresh agent determine the active change for its branch?
5. What remains of `scripts/agent-track`?
6. What remains of `scripts/agent-preflight`?
7. How are human approval gates represented?
8. How are review findings anchored to a reviewed HEAD?
9. Where do COLD/WARM, mutation and forensic artifacts live?
10. How are cross-change branch/worktree conflicts discovered?
11. How is roadmap-level sequencing represented without a second PM system?
12. How do we cut over without rewriting project history?

## 5. Proposed target shape

```text
openspec/
├── specs/
│   ├── identity-resolution/
│   ├── experience-catalog/
│   ├── planning/
│   └── city-catalog-bootstrap/
├── changes/
│   ├── <active-change>/
│   │   ├── proposal.md
│   │   ├── specs/
│   │   ├── design.md
│   │   └── tasks.md
│   └── archive/
└── config.yaml
```

Start with the standard OpenSpec schema plus Zig-Zag configuration/rules.
Do not customize the schema until a real Zig-Zag prototype proves the need.

## 6. Historical migration boundary

Do not rewrite all existing documentation history.

```text
accepted main after Preference-First
→ extract current durable canonical behavior
→ seed OpenSpec stable specs
→ future behavioral changes use OpenSpec changes
```

Historical progress narratives, old plans, reviews and spike evidence may
remain historical unless needed to establish current canonical behavior.
Favor one future authority over dual maintenance.

## 7. Evidence storage

Raw and forensic evidence may remain under `spikes/`, `characterization/` and
`reports/`. OpenSpec artifacts may reference that evidence; they do not need
to absorb large run outputs.

## 8. Governance invariants that must survive

- no direct push to `main`;
- no force-push/history rewrite without explicit owner authorization;
- isolated branch/worktree per concurrent writer;
- no two writers in one worktree;
- explicit integration target;
- preflight before durable writes;
- no merge while required integration/review gates are red;
- no accepted behavior regression without explicit owner authorization;
- unknown stays unknown;
- canonical architecture/spec beats convenient local implementation;
- PR/review remains a human-controlled integration boundary;
- raw evidence does not silently become product authority.

If OpenSpec conflicts with these invariants, current Zig-Zag governance wins
until an explicit owner decision changes the contract.

## 9. Proposed migration gates

### OS1 — OpenSpec capability/workflow characterization
Evaluate the real OpenSpec workflow on a migration branch from accepted `main`.

### OS2 — One real Zig-Zag change prototype
Represent one bounded real change using proposal, delta spec, design, tasks and
archive. Exercise resume across at least two agents/sessions.

### OS3 — Authority mapping
Produce a current-authority → OpenSpec-authority → retained/deleted matrix.
No authority may keep two indefinite canonical homes.

### OS4 — Resume/governance integration
Decide whether `agent-track` is deleted, reduced to an OpenSpec-aware adapter,
or retained narrowly. Do the same for preflight, review handoffs and progress
discovery.

### OS5 — Canonical spec cutover
Seed OpenSpec stable specs from accepted current behavior, not by mechanically
copying every historical amendment.

### OS6 — Documentation deletion/migration
Delete superseded current-format authorities once replacements are accepted.
Avoid permanent dual-write.

### OS7 — Fresh-agent acceptance
A fresh agent must be able to answer from repo state: what change am I on, why,
what behavior changes, what design is authorized, what task is next, what
blocks completion, and what canonical specs constrain it.

## 10. Definition of done

- one canonical future spec/change model;
- concise resumable active execution state;
- completed changes archive cleanly;
- historical evidence remains discoverable but non-authoritative;
- multi-agent branch/worktree safety remains deterministic;
- owner approval gates remain explicit;
- no duplicate progress/spec/plan authority remains;
- redundant old documentation/governance machinery is deleted;
- repository instructions explain the new workflow to all supported agents.

## 11. Explicit non-goals

This proposed track does not authorize:

- modifying Preference-First product behavior;
- delaying Preference-First merge merely to introduce OpenSpec;
- migrating every historical document;
- rewriting Git history;
- creating another feature branch before Preference-First lands in `main`;
- replacing `AGENTS.md` safety rules without an accepted replacement;
- deleting evidence because it does not fit OpenSpec.

## 12. Activation rule

While Preference-First remains unmerged:

```text
status = PROPOSED
hosted as future-track documentation only
no branch
no worktree
no ACTIVE progress
```

After Preference-First is accepted and merged to `main`:

1. create the OpenSpec migration branch from that accepted `main` HEAD;
2. create its current-format ACTIVE `progress/` document and `agent-track`
   header as bootstrap authority;
3. execute OS1;
4. once OpenSpec becomes accepted authority, migrate/delete the bootstrap
   current-format machinery according to the accepted cutover design.