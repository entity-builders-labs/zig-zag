# Overture Places identity-coverage probe (RW4, 2026-10-02)

Read-only characterization of whether Overture Maps Places can close the
identity-acquisition coverage gap found in `../README.md`. Nothing here is
production code. No backend dependency was added, nothing was written to any
DB or catalog, and no COLD/WARM ran.

Verdict and analysis: `assessment.md`.

## Inputs

- Release `2026-09-23.1`, resolved from `https://stac.overturemaps.org/catalog.json`
  (`latest`). Schema `v2.0.0` (`taxonomy`/`basic_category`; `categories`
  removed).
- Source: `s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*`
  (public, anonymous, `s3_region=us-west-2`). Only STAC item `00004`
  intersects the domain.
- Geography: COLD #11 route-scale domain from `../resolver-replay.json`
  (`destination.routeScaleCenter`, `routeScaleRadiusMeters = 80000`).
  Route-scale bbox `[-69.7190, -33.6025, -68.0055, -32.1636]`. A 0.3°
  `WIDER_DIAGNOSTIC` margin was queried in the same pass. Rows beyond 80 km
  are labelled and never counted as candidates.

## Files

| File | Content |
| --- | --- |
| `probe.sql` | generic DuckDB SQL: bbox-pushdown extract, `norm()` mirroring `normalizeGeoName`, `exact_name`, `token_sequence` (discovery only), `neighbourhood`, domain/source profiles |
| `probe.py` | runner: sets variables, executes `probe-plan.json`, writes a bounded projection (≤25 rows/query) |
| `probe-plan.json` | fixture PROBE_QUERY strings and neighbourhood points (spike-only) |
| `raw-results.json` | probe output (projection + aggregate profile) |
| `gers-probe.py`, `gers-registry.json` | GERS registry + release changelog for the 12 inspected ids |
| `alfa-crux.json`, `superuco.json`, `bodega-azul.json`, `a16.json` | per-fixture worksheets |
| `comparison.json` | OSM / Nominatim / Geoapify / Wikidata / Overture matrix |
| `assessment.md` | analysis, verdict, next task |

## Reproduce

```bash
python3 -m venv /tmp/ov && /tmp/ov/bin/pip install duckdb   # throwaway venv
/tmp/ov/bin/python probe.py --release 2026-09-23.1 \
  --center-lat -32.88309217907325 --center-lon -68.86223810433484 \
  --radius-m 80000 --diag-margin-deg 0.3 \
  --plan probe-plan.json --out raw-results.json            # ~20 s
/tmp/ov/bin/python gers-probe.py --release 2026-09-23.1 \
  --bbox -70.1 -33.95 -67.6 -31.8 --out gers-registry.json \
  --ids <ids from the worksheets>                          # ~2 min
```

Validated with DuckDB 1.5.6. Public releases are retained for ≤60 days, so
re-running after ~late November 2026 needs a newer release. Results will
differ, and GERS ids can be checked against the registry.
