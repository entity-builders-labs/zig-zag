# Commands Module

CLI commands for maintenance and data processing tasks. Built with [nest-commander](https://docs.nestjs.com/recipes/nest-commander).

## Architecture

```
commands/
├── commands.module.ts                # Global commands module
└── scripts/
    ├── cli.ts                        # CLI bootstrap entrypoint
    └── commands/
        ├── scripts.module.ts         # Scripts sub-module
        ├── embedding-checker.command.ts  # Rebuild vector embeddings
        ├── image-audit.command.ts        # Audit activity images
        └── metadata-checker.command.ts   # Regenerate AI metadata
```

## Available Commands

### `match-activities` (Embedding Checker)

Rebuilds pgvector embeddings (`Activity.embedding`) for every activity with non-null `metadata`:

```bash
yarn script match-activities
```

Options:

- `--search-prompt "outdoor activities..."` — after rebuilding, run a test similarity search with this prompt instead of the default `"outdoor activities"`

### `image-audit`

Audits activity photos and identifies missing/broken images.

### `metadata-checker`

Regenerates AI-powered metadata for activities that lack it.

## Running Commands

```bash
# From the project root
yarn script <command-name> [options]
```

The CLI bootstraps a NestJS application context (without HTTP server) via `scripts/cli.ts`.
