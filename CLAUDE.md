# CLAUDE.md

This file contains Claude-specific repository guidance only.

## Canonical repository instructions

**Do not treat this file as the repository architecture or engineering source of truth.**

Before proposing, editing, reviewing, or generating code in this repository, read and obey:

1. `/AGENTS.md` — canonical repository-wide instructions for every coding/design agent.
2. The nearest scoped `AGENTS.md` for the code being changed. In particular, when working under `/be`, read `/be/AGENTS.md`.
3. Any architecture/spec/plan documents that those files mark as mandatory for the area being changed.

The rules in `AGENTS.md` files apply to Claude exactly as they apply to Codex, Antigravity, and other agents. They take precedence over duplicated or stale architectural descriptions in tool-specific context.

Do **not** copy repository-wide architecture rules into this file. If a durable engineering rule needs to change, update the canonical `AGENTS.md` / architecture documentation instead so every agent receives the same rule.

## Claude working discipline

- Treat the current codebase as implementation truth and the canonical architecture/spec/plan documents as design truth; distinguish clearly between the two.
- Inspect actual implementations and call graphs before claiming behavior or implementation status.
- Do not infer that a planned component exists merely because a design document names it.
- Respect scoped `AGENTS.md` files automatically when entering those parts of the repository.
- Do not bypass architecture boundaries for a locally convenient fix. If a requested change conflicts with a canonical invariant, stop and surface the conflict rather than inventing a compatibility path.
- Keep changes focused on the requested milestone. Do not opportunistically redesign unrelated areas.
- Never weaken production invariants merely to make an obsolete fixture or legacy test pass.
- For long tasks, maintain concise milestone/progress notes so work can be resumed without reconstructing state from chat history.

## Repository overview

Zig-Zag is a yarn-workspaces monorepo:

- `be/` — NestJS backend, TypeScript, Prisma/PostgreSQL + pgvector.
- `fe/` — React Native / Expo frontend.

Detailed module READMEs exist throughout the repository. Read the relevant module README before modifying that module when instructed by `AGENTS.md`.

## Common commands

### Setup

```bash
yarn install
cp .env.example .env
```

### Root

```bash
yarn simulator
yarn simulator:android
yarn start
yarn start:be
yarn start:fe
```

### Backend (`cd be`)

```bash
yarn start:dev
yarn build
yarn typecheck
yarn lint:check
yarn check

yarn test
yarn test path/to/x.spec.ts
yarn test:integration
yarn test:e2e

yarn prisma:generate
yarn prisma:migrate
yarn prisma:studio
yarn seed
```

Before considering backend work complete, run the verification required by `/be/AGENTS.md` and by the active milestone/plan. Do not report commands as green unless they were actually executed.

### Frontend (`cd fe`)

```bash
yarn start
yarn ios
yarn android
yarn build:web
yarn test:e2e
```

## Claude-specific note

Claude may receive additional session-level instructions from its runtime. Those may refine how Claude operates, but they must not be used to create a second repository architecture or silently override the canonical repository rules. Repository-wide durable decisions belong in `AGENTS.md` and the linked architecture documents.
