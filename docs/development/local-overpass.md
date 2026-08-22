# Local Overpass for OSM composite testing

> **Opt-in only.** The default Zig-Zag stack does not download or index OSM
> data. Enable the `osm-local` profile only when testing destination boundaries,
> neighborhoods, streets, OSM POIs, or composite Activities.

The local service uses the maintained `wiktorn/overpass-api` image pinned by
digest and imports the Argentina Geofabrik extract. The source PBF is currently
roughly 407 MB; the indexed database is several times larger and persists in
the dedicated `overpass_argentina_data` Docker volume. It does not replace any
other regional volume that may already exist.

The profile's entrypoint first makes `/db` traversable by the image's FastCGI
user. The upstream image otherwise creates that home directory with mode
`0700`, which leaves the dispatcher running but makes HTTP queries fail with
`Permission denied`. This runs on every container start and does not modify or
reimport the OSM database.

This replaces only Overpass. Destination name/reverse geocoding still uses the
configured Nominatim endpoint.

## Start and initialize

```bash
docker compose --profile osm-local up -d overpass
docker compose logs -f overpass
```

The first run downloads, converts, and indexes the extract. The initialization
process exits once and the Compose restart policy starts the serving/update
process against the populated volume. Do not judge readiness only from the
container being present; wait until the API answers a query.

```bash
curl --get 'http://localhost:12345/api/interpreter' \
  --data-urlencode 'data=[out:json][timeout:10];relation(286393);out tags;'
```

The response should contain the Argentina relation. Area generation used by
`map_to_area` runs at deliberately low background load and may need additional
time after the base API first becomes available.

## Point the backend at the local service

The backend runs inside the Compose network, so use the service name rather
than `localhost`:

```bash
USE_MOCK_MAPS=false \
OVERPASS_API_URL=http://overpass/api/interpreter \
  docker compose --profile dev --profile osm-local up -d backend
```

The explicit `USE_MOCK_MAPS=false` prevents an old cache entry from making a
live-provider smoke test look successful. In other workflows cache modes still
behave normally; strict mode will not make an uncached external call.

The expected browser-visible acceptance case is:

1. select an Argentine city such as Buenos Aires in the wizard;
2. the trace resolves a real OSM city boundary as an area;
3. real neighborhoods and shortlisted OSM details appear;
4. Groq may propose a composite only from the offered OSM IDs;
5. anti-hallucination verification accepts the waypoint subset;
6. the tour detail renders the composite and its effective
   `TourActivityWaypoint` snapshot.

The itinerary LLM is not forced to create a composite merely because OSM
candidates exist. Backend/database inspection must distinguish "real OSM
candidates were available but the model selected only POIs" from a failed OSM
pipeline.

## Stop, retain, or remove data

Stopping the profile keeps the indexed volume for the next run:

```bash
docker compose --profile osm-local stop overpass
```

Inspect the exact volume name and size before removal:

```bash
docker volume ls --filter name=overpass_argentina_data
docker system df -v
```

Removing that one named volume deletes the imported local OSM database and
requires a full re-import next time. Do not use `docker compose down --volumes`
for this cleanup because it can also remove unrelated PostgreSQL or Ollama
development data.

## Production boundary

This profile is a reproducible development fixture, not the production
deployment design. Production needs a self-hosted or managed OSM query backend
with monitoring, backups/update strategy, capacity planning, and an
asynchronous cold-destination refill path. Normal tour generation should reuse
validated OSM-backed Activities already materialized in PostgreSQL.

Sources:

- [Overpass Docker installation options](https://wiki.openstreetmap.org/wiki/Overpass_API/Installation)
- [`wiktorn/overpass-api` configuration](https://hub.docker.com/r/wiktorn/overpass-api)
- [Geofabrik Argentina extract and updates](https://download.geofabrik.de/south-america/argentina.html)
