# Recall forensic after RW4-ID-FALSE-VERIFY-1 (2026-10-07)

State: `NOT_READY_FOR_C3_IDENTITY_RETRY` (owner). No code change was made;
the instrumentation was not committed (copy: `competitor-stage-harness...`).

## Replay

The three real C3 candidates that contain "Cabildo" were replayed with their
real component hints (`c3-candidates-with-cabildo.json`) through the real
resolver:
- real local OSM pools for whatever boundary the resolver requested;
- real local Nominatim;
- the production Wikidata adapter;
- empty Places and catalog.

A spy on `examineCompetitors` records each name-matched pool member at every
filter stage (`cabildo-librería-sanTelmo-replay.json`).

Fidelity:
- The route scope (Defensa) and the destination scope reproduce the C3
  runs.
- agusyornet in PLANNER_CAPACITY ran in C3 with `CANDIDATE_AREA San Telmo`;
  the replay fell back to `DESTINATION_AREA`.

## Cabildo

- It had 1 material competitor (LOCAL_OSM_POOL) or 2 (NOMINATIM), not 11.
  The 11 belonged to "Don Carlos"; the earlier report conflated them.
- LOCAL_OSM_POOL candidate: `osm:node:767690911`, "Museo Histórico Nacional
  del Cabildo y de la Revolución de Mayo", Bolívar 65, `wikidata=Q1024829`.
  Its only material competitor is `osm:way:293947112`, "Cabildo de Buenos
  Aires", the same building: same `wikidata=Q1024829`, same Bolívar 65,
  `short_name=Cabildo`.
- Competitor examination keys OSM members by OSM id only, so the shared QID
  never makes them one identity. The hint's exact name exists only as the
  way's `short_name`.
- NOMINATIM candidate: the way. Its competitor is
  `osm:node:2665183488`, a café named "Cabildo de Buenos Aires"
  (Hipólito Yrigoyen). That is a genuine distinct record matching the
  candidate's name; this path already failed before the fix.

## Shared-QID characterization (Buenos Aires pool)

- 1663 named records carry `wikidata`, with 1609 distinct QIDs; 31 QIDs are
  shared by more than one record.
- 8 of those 31 are not located items (P625 missing): people, a bank chain,
  an embassy, a chess game.
- QID plus containment: Cabildo does not qualify (its node lies outside the
  way's polygon). See `shared-qid-containment.txt`.
- QID plus exact address: 3 groups merge. Cabildo and Casal de Catalunya are
  correct merges; FADU + Facultad de Ciencias Exactas (same campus address,
  mis-tagged QID) is wrong. See `shared-qid-address.txt`.
