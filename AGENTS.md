# Repository instructions for AI agents

The current codebase is the source of truth. Read the relevant module README
and inspect the implementation before proposing or applying changes.

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
