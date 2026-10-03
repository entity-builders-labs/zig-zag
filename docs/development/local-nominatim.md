# Local Nominatim for OSM search/reverse geocoding

> **Opt-in only.** The default Zig-Zag stack does not download or index OSM
> data. Enable the `osm-local` profile only when reproducibility of
> destination/area/route name resolution matters — e.g. the PRE-B6 real-world
> tourism research spikes (`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`)
> or debugging `NominatimApiService`/`AreaRouteAnchorResolverService` against
> a stable snapshot instead of the shared public instance.

This is the same `osm-local` Compose profile documented in
`docs/development/local-overpass.md` — enabling it starts **both** `overpass`
and `nominatim` together, importing the same Argentina Geofabrik source so
area/route name search (Nominatim) and street/boundary geometry (Overpass)
come from the same regional dataset:

```text
same Argentina OSM extract (Geofabrik south-america/argentina-latest.osm.pbf)
      ├── overpass   (streets, boundaries, ways/relations — see local-overpass.md)
      └── nominatim  (name search, reverse geocoding)
```

## Snapshot consistency — an honest limitation

"Same source" does not mean "byte-identical snapshot." Both containers point
at Geofabrik's `argentina-latest.osm.pbf`, which is a moving pointer
regenerated periodically upstream — and `overpass`'s own entrypoint discards
the raw PBF after converting it (`OVERPASS_PLANET_PREPROCESS` in
`docker-compose.yml`), so there is no retained file to hand to `nominatim` for
a guaranteed byte-identical import. If `overpass` was imported on one day and
`nominatim` on another, their snapshots can differ by however much Argentina
OSM data changed in between. `overpass` also runs its own hourly diff-apply
(`OVERPASS_UPDATE_SLEEP=3600`) once running, so its data keeps moving forward
in time even after import; `nominatim` here is started with no
`REPLICATION_URL`/`UPDATE_MODE` (both default off) and `FREEZE=true`, so its
snapshot is frozen at whatever `PBF_URL` resolved to at import time and never
drifts afterward.

Record the actual imported snapshot age for each spike run rather than
assuming consistency: Nominatim's own `/status?format=json` response includes
`data_updated`, and Overpass's `/api/interpreter` responses include
`osm3s.timestamp_osm_base` — both go in the spike manifest (see the "Required
run manifest" section of the spike gate plan).

## Start and initialize

```bash
docker compose --profile osm-local up -d nominatim
docker compose logs -f nominatim
```

The first run downloads the Argentina extract and imports it — this is a
real country-level `osm2pgsql` import (geocoding data, not just streets), and
can take well over an hour depending on hardware; it's a much heavier
operation than `overpass`'s own first import. Subsequent restarts start
directly against the already-imported volume, and skip re-import entirely:
the image's own entrypoint treats an already-initialized Postgres data
directory at `/var/lib/postgresql/16/main` (the `nominatim_argentina_data`
named volume) as proof the import already succeeded, matching the same
"init exits once, `restart: unless-stopped` serves afterward" pattern
`overpass` already uses.

Do not judge readiness from the container being present — wait for the
health check (`docker compose ps nominatim`, or `docker inspect
--format '{{.State.Health.Status}}' zigzag-nominatim-argentina`) to report
`healthy`, or poll directly:

```bash
curl -sf http://localhost:8088/status
# "OK" once the API is up AND import has completed
curl -s 'http://localhost:8088/status?format=json'
# {"status":0,"message":"OK","data_updated":"...","software_version":"...","database_version":"..."}
```

The Compose health check itself allows a 2-hour `start_period` for exactly
this reason — a long first import must not be flagged unhealthy while it's
still legitimately working.

## Verify independently (infrastructure check, not a spike result)

```bash
# Search — real OSM object suitable for AREA resolution
curl -s --get 'http://localhost:8088/search' \
  --data-urlencode 'q=San Telmo, Buenos Aires' \
  --data-urlencode 'format=jsonv2' \
  --data-urlencode 'addressdetails=1' \
  --data-urlencode 'countrycodes=ar' | python3 -m json.tool

# Reverse — a known San Telmo coordinate (Plaza Dorrego)
curl -s --get 'http://localhost:8088/reverse' \
  --data-urlencode 'lat=-34.6212' \
  --data-urlencode 'lon=-58.3731' \
  --data-urlencode 'format=jsonv2' | python3 -m json.tool

# Another real Argentine location (RW4 — Mendoza)
curl -s --get 'http://localhost:8088/search' \
  --data-urlencode 'q=Mendoza, Argentina' \
  --data-urlencode 'format=jsonv2' \
  --data-urlencode 'countrycodes=ar' | python3 -m json.tool
```

Nominatim's `search`/`reverse` responses never carry boundary/route
*geometry* themselves (the production `NominatimApiService.search()` doesn't
request `polygon_geojson`, and the reverse endpoint intentionally uses
`zoom=10` for settlement-level results — see the service's own comments).
Geometry for an AREA/ROUTE comes from a **second**, separate call —
`OsmPlacesService.lookupBoundaryById(osmType, osmId)` — using the `osm_type`/
`osm_id` this search just returned, against the **local Overpass** instance
above. Verifying Nominatim alone therefore only proves identity resolution
(osm type/id/display name); pair it with an Overpass boundary/way lookup (see
`local-overpass.md`) to prove the full AREA/ROUTE resolution path this
container is meant to support.

## Point the backend at the local service

Same pattern as `local-overpass.md`'s `OVERPASS_API_URL` override — set
`NOMINATIM_API_URL`/`NOMINATIM_REVERSE_API_URL` to the local endpoint rather
than editing the shared `.env` (see `.env.spike.example` at the repo root for
the full PRE-B6 spike override set, which sets these alongside
`OVERPASS_API_URL`, `GROUNDED_SEARCH_PROVIDER=serpapi`, `AI_CACHE_MODE=off`,
and the spike `DATABASE_URL`):

```bash
NOMINATIM_API_URL=http://localhost:8088/search \
NOMINATIM_REVERSE_API_URL=http://localhost:8088/reverse \
  yarn start:dev   # (from be/, outside Docker) or:

NOMINATIM_API_URL=http://nominatim:8080/search \
NOMINATIM_REVERSE_API_URL=http://nominatim:8080/reverse \
  docker compose --profile dev --profile osm-local up -d backend
```

Use the Compose service name (`nominatim`, not `localhost`) when the backend
itself runs inside the Compose network; use `localhost:8088` when running
`yarn start:dev` directly on the host.

`NominatimApiService` (`src/modules/integrations/osm/services/nominatim-api.service.ts`)
is never special-cased for this — it just reads `NOMINATIM_API_URL`/
`NOMINATIM_REVERSE_API_URL` from config like any other environment, falling
back to the public `nominatim.openstreetmap.org` endpoints when unset. The
production/normal-dev default stays the public instance; only an explicit
override (never a code change) selects the local one — do not special-case
spike behavior inside `NominatimApiService` itself.

## Foreign-city rule

This local instance is Argentina-only (via `PBF_URL`). A foreign-city case
(e.g. RW5 — Montmartre/Paris or Trastevere/Rome) must never point at it —
either configure the real public/external Nominatim endpoint explicitly for
that run, or provision a separate local extract for that region. An empty
result from this Argentina-only instance for a foreign query is an
infrastructure misconfiguration, not a product finding.

## Stop, retain, or remove data

```bash
docker compose --profile osm-local stop nominatim   # keeps the imported volume
docker volume ls --filter name=nominatim_argentina
```

Removing `nominatim_argentina_data` deletes the imported database and
requires a full re-import; removing `nominatim_argentina_flatnode` alone just
loses the (optional, import-only) flatnode acceleration file. Do not use
`docker compose down --volumes` for this — it removes unrelated Postgres/
Overpass volumes too. Ollama is host-managed and has no Compose volume.

## Resource notes

- **Disk, not just RAM, is the real constraint — check it before starting an
  import.** A country-level `osm2pgsql` import (even for a ~430MB PBF like
  Argentina's) commonly needs on the order of several tens of GB of
  intermediate/indexed data, on top of whatever this repo's other Docker
  images/volumes already occupy. On Docker Desktop (macOS/Windows), that
  data grows inside the VM's own virtual disk file (typically
  `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw` on
  macOS) — check `docker system df -v` for current image/volume usage AND
  Docker Desktop's own configured disk-image size limit (Settings →
  Resources → Advanced) BEFORE starting the first import, not just the
  host's free disk space; the two are not the same number, and Docker
  Desktop's VM has been observed to remount its internal filesystem
  read-only and power itself off when its own disk fills mid-import, which
  then requires a full Docker Desktop restart to recover (containers with
  `restart: unless-stopped` resume automatically once it's back; no host
  data is lost, but the interrupted import must be redone). Increase the
  disk-image size limit first if headroom looks tight.
- `shm_size` defaults to `1g` (`NOMINATIM_SHM_SIZE` to override) — the
  image's own docs recommend at least 1GB for country-level imports.
- Memory limit/reservation default to `4G`/`2G` (`NOMINATIM_MEMORY_LIMIT`/
  `NOMINATIM_MEMORY_RESERVATION`). Increase if the first import is slow/OOM-killed
  on a smaller machine.
- `IMPORT_WIKIPEDIA=false` — skips the importance-ranking dump. This speeds
  up first import and is safe for B5's resolver, which needs a correct
  `osm_type`/`osm_id`/geometry match (narrowed by `countrycodes`), not
  `importance`-based tie-breaking against candidates in unrelated countries.
- `NOMINATIM_PASSWORD` defaults to a placeholder dev-only value (the
  container's *internal* Postgres is not published on the host by default —
  only port 8080/8088, the HTTP API, is). Override via the `NOMINATIM_PASSWORD`
  environment variable if you do publish 5432 for direct `psql` debugging.

## Production boundary

Same as `local-overpass.md`: this is a reproducible development/spike
fixture, not the production deployment design. Production Nominatim (if ever
self-hosted rather than a managed/public endpoint) needs monitoring, an
update/backup strategy, and capacity planning of its own.

Sources:

- [mediagis/nominatim-docker `howto.md`](https://github.com/mediagis/nominatim-docker/blob/master/howto.md)
- [Nominatim `/status` API docs](https://nominatim.org/release-docs/latest/api/Status/)
- [Geofabrik Argentina extract and updates](https://download.geofabrik.de/south-america/argentina.html)
