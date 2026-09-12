# Repository instructions for AI agents

The current codebase is the source of truth. Read the relevant module README
and inspect the implementation before proposing or applying changes.

These instructions apply to every AI coding/design agent working in the repo,
including Codex, Claude, and Antigravity. Antigravity is currently used often
for visual/frontend work, but the frontend conventions below are shared rules,
not tool-specific preferences.

For Places-provider acquisition/classification work on
`feat/preference-first-selection`, also read
`docs/superpowers/specs/2026-09-12-places-provider-cost-control-amendment.md`.
It supersedes the older B1 instruction to request Google
`editorialSummary` on every baseline search: the core is provider-agnostic
(`IPlacesApiService`, currently Google or Geoapify), and paid provider-specific
narrative fields must remain optional/selective rather than baseline-required.

Before changing any of the following areas, read
`docs/architecture/activity-discovery-and-tour-generation.md` completely:

- tour or activity generation;
- destination resolution;
- candidate retrieval, coverage, ranking, or embeddings;
- transportation modes, spatial feasibility, routing, travel times, or
  itinerary scheduling;
- Google Places, OSM, Nominatim, Overpass, or discovery providers;
- composite Activities, families, waypoints, or tour snapshots;
- Prisma models related to Activities or Tours.

That document describes target architecture and invariants. It does not imply
that every component shown there is already implemented. Confirm implementation
status in the repository and preserve the boundaries between Destination
Resolution, Activity Discovery, Entity Resolution, Validation, and Tour
Generation.

## Frontend responsive layout convention

Zig-Zag targets web, iOS, and Android from the same frontend. Preserve a
consistent application canvas when navigating between screens.

- Top-level application screens fill the available viewport: screen roots use
  full width and `flex: 1` (or the equivalent for that surface).
- Do not constrain an entire screen with `maxWidth`, a fixed desktop width, or
  a centered phone-sized shell. Navigation between screens must not make the
  whole application jump between full-width and a narrow centered column.
- Responsive width constraints belong inside the screen, around content that
  benefits from a readable maximum width (for example forms, long text,
  settings panels, or dense detail sections), not around the screen root.
- Map and other immersive surfaces normally use the full available width.
- A full-width screen does not mean every child should stretch indefinitely on
  desktop. Constrain individual content sections responsively where that
  improves readability while keeping the screen/app shell itself full-width.
- When changing a shared screen, consider web, iOS, and Android behavior. Do
  not fix one platform by reintroducing a root-level width constraint that
  makes another platform or web navigation visually inconsistent.

In short:

```text
screen / app shell = full viewport
content sections    = may use responsive max-width where appropriate
```

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Context discipline

Keep development tasks focused on the requested outcome and current phase.
Reuse files, symbols, and findings already inspected; do not reread or
reprint unchanged material. Prefer focused CodeGraph queries, `rg`, and
bounded file ranges. Keep command output concise: summarize logs and inspect
only relevant failure excerpts instead of dumping complete files, documents,
HTML responses, or stack traces. Full reads required by this file remain
mandatory, but their contents need not be repeated in chat. Avoid unrelated
inventories, speculative refactors, and unnecessary IDE/MCP/integration
context. For long tasks, keep a concise handoff/progress note and split work
into clear milestones so the chat can be compacted or restarted between them.
