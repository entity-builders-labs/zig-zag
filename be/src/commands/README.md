# Backend commands

The command bootstrap lives in `src/commands/scripts/cli.ts` and is reserved
for Experience V2 maintenance tasks. Activity-era embedding, metadata,
template, discovery, and composite-fixture commands were removed with the
domain cutover and must not be reintroduced.

Tour generation uses the asynchronous HTTP API. It creates a
`TourGenerationRequested` outbox event; the worker performs acquisition,
verification, selection, planning, and `TourExperience` snapshot persistence.
