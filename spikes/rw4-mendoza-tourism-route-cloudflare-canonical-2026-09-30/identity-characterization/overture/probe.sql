-- Overture Places identity-coverage probe (diagnostic only; read-only).
--
-- Generic: nothing here knows a destination, fixture or category. All
-- inputs are DuckDB variables set by the caller (probe.py or by hand):
--
--   SET VARIABLE src         = 's3://overturemaps-us-west-2/release/<RELEASE>/theme=places/type=place/*';
--   SET VARIABLE center_lat  = <route-scale center latitude>;
--   SET VARIABLE center_lon  = <route-scale center longitude>;
--   SET VARIABLE radius_m    = <authorized route-scale radius, metres>;
--   SET VARIABLE diag_margin_deg = <extra bbox margin for the labelled
--                                   WIDER_DIAGNOSTIC ring; 0 = none>;
--
-- Requires: LOAD spatial; LOAD httpfs; SET s3_region='us-west-2';
--
-- Semantics:
--   * Pruning uses the GeoParquet `bbox` covering columns (row-group
--     statistics), never a full download.
--   * `dist_m` is haversine distance from the route-scale center, the same
--     test as destination-compatibility.policy.ts (route-scale radius). Rows
--     with dist_m > radius_m are WIDER_DIAGNOSTIC and are never identity
--     candidates.
--   * norm() mirrors normalizeGeoName() (be/src/modules/tours/utils/
--     nominatim-match.util.ts): strip diacritics, lowercase, non [a-z0-9]
--     runs -> single space, trim.
--   * Declared names are ONLY provider-declared: names.primary,
--     names.common values, names.rules[].value. Query variants are
--     PROBE_QUERY formulations, never aliases.

-- 1. Bounded extract: route-scale bbox (+ optional diagnostic margin).
-- Scalar variables (not a join) so the bbox predicate is pushed down to
-- Parquet row-group statistics.
SET VARIABLE dlat = getvariable('radius_m') / 111194.9266;
SET VARIABLE dlon = getvariable('radius_m')
  / (111194.9266 * cos(radians(getvariable('center_lat'))));
SET VARIABLE q_xmin = getvariable('center_lon') - getvariable('dlon') - getvariable('diag_margin_deg');
SET VARIABLE q_xmax = getvariable('center_lon') + getvariable('dlon') + getvariable('diag_margin_deg');
SET VARIABLE q_ymin = getvariable('center_lat') - getvariable('dlat') - getvariable('diag_margin_deg');
SET VARIABLE q_ymax = getvariable('center_lat') + getvariable('dlat') + getvariable('diag_margin_deg');

CREATE OR REPLACE TEMP TABLE raw_extract AS
SELECT * EXCLUDE (theme, type)
FROM read_parquet(getvariable('src'), hive_partitioning = 1)
WHERE bbox.xmin >= getvariable('q_xmin') AND bbox.xmax <= getvariable('q_xmax')
  AND bbox.ymin >= getvariable('q_ymin') AND bbox.ymax <= getvariable('q_ymax');

CREATE OR REPLACE TEMP TABLE places AS
SELECT
  p.*,
  ST_Y(p.geometry) AS lat,
  ST_X(p.geometry) AS lon,
  6371008.8 * 2 * asin(sqrt(
      pow(sin(radians(ST_Y(p.geometry) - getvariable('center_lat')) / 2), 2)
    + cos(radians(getvariable('center_lat'))) * cos(radians(ST_Y(p.geometry)))
      * pow(sin(radians(ST_X(p.geometry) - getvariable('center_lon')) / 2), 2)
  )) AS dist_m,
  list_distinct(list_filter(list_concat(
    [p.names.primary],
    coalesce(map_values(p.names.common), []),
    coalesce(list_transform(p.names.rules, r -> r.value), [])
  ), n -> n IS NOT NULL)) AS declared_names
FROM raw_extract p;

CREATE OR REPLACE MACRO norm(s) AS
  trim(regexp_replace(lower(strip_accents(coalesce(s, ''))), '[^a-z0-9]+', ' ', 'g'));

-- Projection of every field the characterization reports. Absent fields
-- stay NULL; nothing is inferred.
CREATE OR REPLACE MACRO projected() AS TABLE
SELECT
  id, names, declared_names, lat, lon, round(dist_m) AS dist_m,
  CASE WHEN dist_m <= getvariable('radius_m') THEN 'AUTHORIZED_DOMAIN'
       ELSE 'WIDER_DIAGNOSTIC' END AS domain,
  addresses, websites, phones, emails, socials, taxonomy, basic_category,
  brand, operating_status, confidence, version, sources
FROM places;

-- 2. Exact normalized name: some provider-declared name == query.
CREATE OR REPLACE MACRO exact_name(q) AS TABLE
SELECT * FROM projected()
WHERE list_contains(list_transform(declared_names, n -> norm(n)), norm(q))
ORDER BY dist_m;

-- 3. Discovery only (PROBE_QUERY): the normalized query occurs as a whole
-- token sequence inside a declared name. Never identity evidence.
CREATE OR REPLACE MACRO token_sequence(q) AS TABLE
SELECT * FROM projected()
WHERE len(list_filter(declared_names,
        n -> (' ' || norm(n) || ' ') LIKE ('% ' || norm(q) || ' %'))) > 0
ORDER BY dist_m;

-- 4. Neighbourhood of a point (e.g. a previously known provider object or
-- a linked-page location), radius in metres.
CREATE OR REPLACE MACRO neighbourhood(plat, plon, r) AS TABLE
SELECT * FROM (
  SELECT *, round(6371008.8 * 2 * asin(sqrt(
      pow(sin(radians(lat - plat) / 2), 2)
    + cos(radians(plat)) * cos(radians(lat)) * pow(sin(radians(lon - plon) / 2), 2)
  ))) AS from_point_m
  FROM projected()
) WHERE from_point_m <= r
ORDER BY from_point_m;

-- 5. Domain-level field coverage / provenance profile (aggregate only).
CREATE OR REPLACE MACRO domain_profile() AS TABLE
SELECT
  count(*) AS rows_total,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m')) AS rows_authorized,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND names.common IS NOT NULL) AS with_names_common,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND names.rules IS NOT NULL) AS with_names_rules,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND len(websites) > 0) AS with_website,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND len(phones) > 0) AS with_phone,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND len(addresses) > 0 AND addresses[1].freeform IS NOT NULL) AS with_address_freeform,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND operating_status IS NOT NULL) AS with_operating_status,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND brand.wikidata IS NOT NULL) AS with_brand_wikidata,
  count(*) FILTER (WHERE dist_m <= getvariable('radius_m') AND basic_category IS NULL) AS without_basic_category
FROM places;

CREATE OR REPLACE MACRO source_profile() AS TABLE
SELECT s.dataset, s.provider, s.license, s.property, count(*) AS n
FROM (SELECT unnest(sources) AS s FROM places WHERE dist_m <= getvariable('radius_m'))
GROUP BY ALL ORDER BY n DESC;

CREATE OR REPLACE MACRO multi_source_profile() AS TABLE
SELECT
  len(list_filter(sources, s -> s.property = '')) AS whole_record_sources,
  list_sort(list_distinct(list_transform(list_filter(sources, s -> s.property = ''), s -> s.dataset))) AS datasets,
  count(*) AS n
FROM places WHERE dist_m <= getvariable('radius_m')
GROUP BY ALL ORDER BY n DESC;

CREATE OR REPLACE MACRO status_profile() AS TABLE
SELECT operating_status, count(*) AS n FROM places
WHERE dist_m <= getvariable('radius_m') GROUP BY ALL ORDER BY n DESC;
