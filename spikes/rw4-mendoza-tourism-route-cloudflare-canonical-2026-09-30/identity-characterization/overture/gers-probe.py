#!/usr/bin/env python3
"""GERS registry + changelog lookup for a list of Overture IDs (diagnostic).

Usage: python gers-probe.py --release 2026-09-23.1 --bbox XMIN YMIN XMAX YMAX \
         --out gers-registry.json --ids <id> ...
IDs are validated as UUIDs and inlined as an IN list (a bound list
parameter defeats Parquet min/max pruning on the id-sorted registry).
"""
import argparse, json, pathlib
import duckdb

ap = argparse.ArgumentParser()
ap.add_argument("--release", required=True)
ap.add_argument("--ids", nargs="*", default=[])
ap.add_argument("--bbox", nargs=4, type=float, required=True,
                metavar=("XMIN", "YMIN", "XMAX", "YMAX"),
                help="changelog pruning bbox (covering all ids)")
ap.add_argument("--out", required=True)
a = ap.parse_args()
import uuid
ids = sorted({str(uuid.UUID(i)) for i in a.ids})
in_list = ",".join(f"'{i}'" for i in ids)
con = duckdb.connect()
for s in ("INSTALL spatial", "LOAD spatial", "INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"):
    con.execute(s)
def rows(sql, params):
    cur = con.execute(sql, params); cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
reg = rows("SELECT id, version, first_seen, last_seen, last_changed, path IS NOT NULL AS live "
           f"FROM read_parquet('s3://overturemaps-us-west-2/registry/*.parquet') WHERE id IN ({in_list})", [])
cl = rows(f"SELECT id, change_type, columns_changed FROM read_parquet("
          f"'s3://overturemaps-us-west-2/changelog/{a.release}/theme=places/type=place/*/*.parquet', hive_partitioning=1) "
          f"WHERE bbox.xmin >= ? AND bbox.ymin >= ? AND bbox.xmax <= ? AND bbox.ymax <= ? "
          f"AND id IN ({in_list})", list(a.bbox))
pathlib.Path(a.out).write_text(json.dumps({"release": a.release, "registry": reg, "changelog": cl}, indent=1, default=str))
