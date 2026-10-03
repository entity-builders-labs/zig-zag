"""Country-wide Overture exact-name multiplicity probe (read-only, diagnostic).

Generic: the caller supplies release, ISO country code, a country bbox used
only for Parquet row-group pruning, and the hint names. A row belongs to the
country when any of its addresses declares that country code; rows inside
the pruning bbox with no declared country are reported separately as
COUNTRY_UNDECLARED (never silently counted in or out).
"""
import argparse, json, time, duckdb

p = argparse.ArgumentParser()
p.add_argument('--release', required=True)
p.add_argument('--country', required=True)
p.add_argument('--bbox', nargs=4, type=float, required=True)  # xmin ymin xmax ymax
p.add_argument('--names', nargs='+', required=True)
p.add_argument('--out', required=True)
a = p.parse_args()

con = duckdb.connect()
for s in ("INSTALL spatial", "LOAD spatial", "INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"):
    con.execute(s)
con.execute("""CREATE MACRO norm(s) AS trim(regexp_replace(lower(strip_accents(coalesce(s,''))), '[^a-z0-9]+', ' ', 'g'))""")
src = f"s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*"
targets = [con.execute("SELECT norm(?)", [n]).fetchone()[0] for n in a.names]
xmin, ymin, xmax, ymax = a.bbox
t0 = time.time()
con.execute(f"""
CREATE TEMP TABLE hits AS
SELECT id, names.primary AS primary_name, norm(names.primary) AS n,
       ST_Y(geometry) AS lat, ST_X(geometry) AS lon,
       list_transform(addresses, x -> x.country) AS countries,
       list_transform(addresses, x -> x.locality) AS localities,
       taxonomy.primary AS category,
       list_transform(sources, x -> x.dataset) AS datasets
FROM read_parquet('{src}', hive_partitioning=1)
WHERE bbox.xmin >= {xmin} AND bbox.xmax <= {xmax}
  AND bbox.ymin >= {ymin} AND bbox.ymax <= {ymax}
  AND norm(names.primary) IN ({",".join("?"*len(targets))})
""", targets)
scan_s = round(time.time() - t0, 1)
rows = con.execute("SELECT * FROM hits ORDER BY n, id").fetchall()
cols = [d[0] for d in con.description]
recs = [dict(zip(cols, r)) for r in rows]
out = {"release": a.release, "country": a.country, "pruningBbox": a.bbox,
       "nameField": "names.primary (normalizeGeoName mirror)", "scanSeconds": scan_s, "byName": {}}
for name, t in zip(a.names, targets):
    m = [r for r in recs if r["n"] == t]
    inc = [r for r in m if a.country in (r["countries"] or [])]
    und = [r for r in m if not any(r["countries"] or [])]
    out["byName"][name] = {"normalized": t, "inCountry": len(inc), "countryUndeclared": len(und),
                           "otherCountry": len(m) - len(inc) - len(und), "records": m}
json.dump(out, open(a.out, "w"), indent=1, default=str)
print(json.dumps({k: {kk: v[kk] for kk in ("inCountry", "countryUndeclared", "otherCountry")} for k, v in out["byName"].items()}), scan_s)
