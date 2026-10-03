# Runtime calibration input

track=preference-first-selection
reviewed_head=f39101726f9abca012575cc47b2102d43b6c9c18
baseline=1ceb477de44b3589cbc01b13eac9bf7aa22c98da
range=1ceb477de44b3589cbc01b13eac9bf7aa22c98da..f39101726f9abca012575cc47b2102d43b6c9c18
commit_count=1

## Commits in the declared calibration range

```text
f39101726f9abca012575cc47b2102d43b6c9c18 fix(overture): publish only complete import snapshots
```

## Changed files in the declared calibration range

```text
be/prisma/migrations/20261002120000_add_overture_places_index/migration.sql
be/prisma/schema.prisma
be/src/modules/integrations/overture/overture-places-index.service.spec.ts
be/src/modules/integrations/overture/overture-places-index.service.ts
```

The complete diff for the declared range is attached as delta.diff.
Read it with your read tool. This is a declared historical range, not
the incremental-baseline algorithm used for live pull requests.
