#!/usr/bin/env python3
"""Overture Places identity-coverage probe runner (diagnostic only).

Generic: release, route-scale geography and the query plan are inputs. All
query logic lives in probe.sql; this runner only sets variables, executes the
plan and serializes a bounded projection. No DB/catalog writes.

Usage (from a throwaway venv with `pip install duckdb`; not a backend dep):
  python probe.py --release 2026-09-23.1 \
    --center-lat -32.88309217907325 --center-lon -68.86223810433484 \
    --radius-m 80000 --diag-margin-deg 0.3 \
    --plan probe-plan.json --out raw-results.json
"""
import argparse
import datetime as dt
import json
import pathlib
import sys

import duckdb

LIMIT = 25  # bounded projection per query


def rows(con, sql, params=()):
    cur = con.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True)
    ap.add_argument("--center-lat", type=float, required=True)
    ap.add_argument("--center-lon", type=float, required=True)
    ap.add_argument("--radius-m", type=float, required=True)
    ap.add_argument("--diag-margin-deg", type=float, default=0.0)
    ap.add_argument("--plan", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    here = pathlib.Path(__file__).parent
    plan = json.loads(pathlib.Path(a.plan).read_text())
    src = f"s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*"

    con = duckdb.connect()
    for s in ("INSTALL spatial", "LOAD spatial", "INSTALL httpfs", "LOAD httpfs",
              "SET s3_region='us-west-2'"):
        con.execute(s)
    con.execute("SET VARIABLE src = ?", [src])
    con.execute("SET VARIABLE center_lat = ?", [a.center_lat])
    con.execute("SET VARIABLE center_lon = ?", [a.center_lon])
    con.execute("SET VARIABLE radius_m = ?", [a.radius_m])
    con.execute("SET VARIABLE diag_margin_deg = ?", [a.diag_margin_deg])
    con.execute((here / "probe.sql").read_text())

    out = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "release": a.release,
        "source": src,
        "routeScale": {"centerLat": a.center_lat, "centerLon": a.center_lon,
                       "radiusMeters": a.radius_m},
        "diagnosticMarginDeg": a.diag_margin_deg,
        "routeScaleBbox": rows(con, """SELECT getvariable('center_lon') - getvariable('dlon') AS xmin,
                                              getvariable('center_lon') + getvariable('dlon') AS xmax,
                                              getvariable('center_lat') - getvariable('dlat') AS ymin,
                                              getvariable('center_lat') + getvariable('dlat') AS ymax""")[0],
        "queriedBbox": rows(con, """SELECT getvariable('q_xmin') AS xmin, getvariable('q_xmax') AS xmax,
                                           getvariable('q_ymin') AS ymin, getvariable('q_ymax') AS ymax""")[0],
        "duckdb": duckdb.__version__,
        "profile": {
            "domain": rows(con, "SELECT * FROM domain_profile()")[0],
            "sources": rows(con, "SELECT * FROM source_profile()"),
            "wholeRecordSourceMultiplicity": rows(con, "SELECT * FROM multi_source_profile()"),
            "operatingStatus": rows(con, "SELECT * FROM status_profile()"),
        },
        "fixtures": {},
    }
    for fixture, spec in plan["fixtures"].items():
        res = {"exactName": {}, "tokenSequence": {}, "neighbourhoods": {}}
        for q in spec.get("probeQueries", []):
            res["exactName"][q] = rows(con, f"SELECT * FROM exact_name(?) LIMIT {LIMIT}", [q])
            res["tokenSequence"][q] = rows(con, f"SELECT * FROM token_sequence(?) LIMIT {LIMIT}", [q])
        for label, n in spec.get("neighbourhoods", {}).items():
            res["neighbourhoods"][label] = {
                "point": n,
                "rows": rows(con, f"SELECT * FROM neighbourhood(?, ?, ?) LIMIT {LIMIT}",
                             [n["lat"], n["lon"], n["radiusM"]]),
            }
        out["fixtures"][fixture] = res

    pathlib.Path(a.out).write_text(json.dumps(out, default=str, ensure_ascii=False, indent=1))
    print(f"wrote {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
