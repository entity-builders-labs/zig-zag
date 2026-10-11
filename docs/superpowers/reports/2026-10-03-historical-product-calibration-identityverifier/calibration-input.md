# Runtime calibration input

track=preference-first-selection
reviewed_head=15af1ccb641122d633de4c5f1fd853d963ba0a18
baseline=1842004715930ea2cc2f27aed0ff483d90888ec7
range=1842004715930ea2cc2f27aed0ff483d90888ec7..15af1ccb641122d633de4c5f1fd853d963ba0a18
commit_count=2

## Commits in the declared calibration range

```text
92da63b1d10eeddec0413f326f0367438673b200 fix(identity): stop NEARBY Wikidata deciding homonyms or contradictions
15af1ccb641122d633de4c5f1fd853d963ba0a18 docs(rw4): record IdentityVerifier evidence characterization
```

## Changed files in the declared calibration range

```text
be/src/modules/tours/services/identity-verifier.service.spec.ts
be/src/modules/tours/services/identity-verifier.service.ts
be/test/integration/overture-identity-verification.integration-spec.ts
be/test/integration/support/test-db.ts
be/test/live/rw4-identity-verifier-characterization.live-spec.ts
docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/assessment.md
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/db-after-probe.post-fix.json
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/db-after-probe.pre-fix.json
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/resolver-replay.post-fix.json
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/resolver-replay.pre-fix.json
spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/run.sh
```

The complete diff for the declared range is attached as delta.diff.
Read it with your read tool. This is a declared historical range, not
the incremental-baseline algorithm used for live pull requests.
