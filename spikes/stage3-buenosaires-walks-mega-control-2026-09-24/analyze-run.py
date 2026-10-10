#!/usr/bin/env python3
"""Spike-only analyzer for one COLD/WARM run of the real HTTP generation path.

Reads the run's persisted generation-trace.json + run-manifest.json and the
dedicated spike DB, and emits one metrics JSON. Never touches production code
paths; every number is derived from persisted trace facts or DB rows.

Provider-call counts are DERIVED from trace attempts (documented per field),
because the generation trace records attempts, not raw HTTP calls:
  - targeted Overpass calls = sum(len(routeResolution.variants)) over
    TARGETED_ROUTE attempts (one exact-name query per retrieval variant);
  - catalog lookups = CATALOG_REUSE attempts (ROUTE: one per variant);
  - Nominatim / Places = NOMINATIM / PLACES attempts;
  - Wikidata = attempts whose evidence carries a WIKIDATA_* fact (the
    collector's network branch ran).
Admin-compatibility network calls are structurally 0 after the cutover (the
destination policy is polygon containment in the hydrated boundary).

Usage: analyze-run.py <run_dir> <db_name> [--label L] > metrics.json
"""
import json
import subprocess
import sys
from collections import Counter, defaultdict

FORENSIC = [
    'defensa', 'san lorenzo', 'caminito', 'balcarce', 'chile', 'giuffra',
    'dorrego', 'zanj', 'mafalda', 'boca juniors', 'bombonera', 'ezeiza',
    'güemes', 'guemes', 'san martín', 'san martin',
]


def psql(db, sql):
    out = subprocess.run(
        ['docker', 'exec', 'zigzag-postgres', 'psql', '-U', 'postgres', '-d',
         db, '-t', '-A', '-F', '\t', '-c', sql],
        capture_output=True, text=True, check=True).stdout
    return [line.split('\t') for line in out.strip().splitlines() if line]


def main():
    run_dir, db = sys.argv[1], sys.argv[2]
    label = sys.argv[sys.argv.index('--label') + 1] if '--label' in sys.argv else run_dir
    trace = json.load(open(f'{run_dir}/generation-trace.json')) or {}
    manifest = json.load(open(f'{run_dir}/run-manifest.json'))
    steps = trace.get('steps') or []

    discovery = Counter()
    for s in steps:
        if s.get('stage') != 'discovery':
            continue
        o = s.get('outputs') or {}
        discovery['discoverySteps'] += 1
        discovery['candidateCount'] += o.get('candidateCount') or 0
        discovery['webCandidateCount'] += o.get('webCandidateCount') or 0
        discovery['structuredCandidateCount'] += o.get('structuredCandidateCount') or 0

    hints_total = Counter()
    reasons = Counter()
    strategy_attempts = Counter()
    strategy_verified = Counter()
    calls = Counter()
    route = Counter()
    route_segments = []
    route_clusters = []
    known_debt = Counter()
    candidates = []
    forensic = defaultdict(list)
    route_hint_details = []

    for s in steps:
        if s.get('stage') != 'entity_resolution':
            continue
        for audit in s.get('entityResolutionAudit') or []:
            hints = audit.get('hints') or []
            resolved = [h for h in hints if h.get('status') == 'resolved']
            candidates.append({
                'name': audit.get('candidateName'),
                'hintCount': len(hints),
                'resolvedCount': len(resolved),
                'accepted': audit.get('accepted'),
                'rejectionReasons': audit.get('rejectionReasons'),
                'hints': [
                    {
                        'name': h.get('name'),
                        'kind': h.get('expectedKind'),
                        'status': h.get('status'),
                        'reason': h.get('reason'),
                        'strategies': [a.get('strategy') for a in h.get('attempts') or []],
                    }
                    for h in hints
                ],
            })
            for h in hints:
                hints_total['total'] += 1
                if h.get('status') == 'resolved':
                    hints_total['resolved'] += 1
                else:
                    reasons[h.get('reason') or 'UNKNOWN'] += 1
                attempts = h.get('attempts') or []
                for a in attempts:
                    st = a.get('strategy')
                    strategy_attempts[st] += 1
                    if a.get('verificationDecision') == 'VERIFIED':
                        strategy_verified[st] += 1
                        if any(e.get('type') == 'IDENTITY_CONVERGENCE'
                               for e in a.get('identityEvidence') or []):
                            strategy_verified['IDENTITY_CONVERGENCE'] += 1
                    if st == 'CATALOG_REUSE':
                        calls['catalogLookups'] += 1
                    if st == 'NOMINATIM':
                        calls['nominatim'] += 1
                    if st == 'PLACES':
                        calls['places'] += 1
                    if any(str(e.get('type', '')).startswith('WIKIDATA')
                           for e in a.get('identityEvidence') or []):
                        calls['wikidataEvidenceAttempts'] += 1
                    rr = a.get('routeResolution')
                    if st == 'TARGETED_ROUTE' and rr:
                        calls['targetedOverpass'] += len(rr.get('variants') or [])
                        route['targetedAttempts'] += 1
                        route[rr.get('status')] += 1
                        route_clusters.append(rr.get('clusterCount') or 0)
                        if rr.get('resolvedSegmentCount'):
                            route_segments.append(rr['resolvedSegmentCount'])
                        raw_total = sum(v.get('rawCount') or 0 for v in rr.get('variants') or [])
                        if rr.get('status') == 'NOT_FOUND' and raw_total == 0:
                            known_debt['exactNameRetrievalMiss'] += 1
                        if rr.get('reason') == 'MULTIPLE_COMPATIBLE_CLUSTERS':
                            known_debt['multipleCompatibleClusters'] += 1
                        route_hint_details.append({
                            'hint': h.get('name'),
                            'status': rr.get('status'),
                            'reason': rr.get('reason'),
                            'variants': [(v.get('name'), v.get('rawCount')) for v in rr.get('variants') or []],
                            'clusters': rr.get('clusterCount'),
                            'compatible': rr.get('compatibleClusterCount'),
                            'segments': rr.get('resolvedSegmentCount'),
                            'knownGeoEntities': rr.get('knownGeoEntityCount'),
                            'final': h.get('status'),
                            'finalReason': h.get('reason'),
                        })
                if h.get('expectedKind') == 'ROUTE' or h.get('role') == 'route':
                    route['routeHints'] += 1
                    if h.get('status') == 'resolved':
                        route['routeHintsResolved'] += 1
                        if attempts and attempts[-1].get('strategy') == 'CATALOG_REUSE':
                            route['routeCatalogReuse'] += 1
                name = (h.get('name') or '').lower()
                for f in FORENSIC:
                    if f in name:
                        forensic[f].append({
                            'hint': h.get('name'),
                            'kind': h.get('expectedKind'),
                            'status': h.get('status'),
                            'reason': h.get('reason'),
                            'strategies': [a.get('strategy') for a in attempts],
                            'resolvedGeoEntity': h.get('resolvedGeoEntity'),
                        })

    multi = [c for c in candidates if c['hintCount'] >= 2]
    buckets = Counter()
    for c in multi:
        r = c['resolvedCount']
        buckets['0' if r == 0 else '1' if r == 1 else 'all' if r == c['hintCount'] else '2+partial'] += 1

    geo = Counter()
    for s in steps:
        if s.get('stage') == 'geographic_validation':
            o = s.get('outputs') or {}
            geo['geoVerified'] += o.get('geoVerifiedCount') or 0
            geo['rejected'] += o.get('rejectedCount') or 0

    persisted_ids = set()
    for s in steps:
        if s.get('stage') == 'catalog_materialization':
            persisted_ids.update((s.get('outputs') or {}).get('persistedExperienceIds') or [])

    comp_rows = psql(db, """
      select e.id, e."canonicalName", count(c.id)
      from experience e left join experience_component c on c."experienceId" = e.id
      group by e.id, e."canonicalName" order by e."canonicalName" """)
    route_rows = psql(db, """
      select g.id, g.name, count(i.id)
      from geo_entity g join geo_entity_identity i on i."geoEntityId" = g.id
      where g.kind = 'ROUTE' group by g.id, g.name order by g.name""")
    dup_identities = psql(db, """
      select count(*) from (select provider, "externalId" from geo_entity_identity
      group by 1,2 having count(*) > 1) d""")
    counts = psql(db, """select (select count(*) from experience),
      (select count(*) from experience_component), (select count(*) from geo_entity),
      (select count(*) from geo_entity_identity),
      (select count(*) from geo_entity where kind='ROUTE')""")[0]

    multi_persisted = [r for r in comp_rows if int(r[2]) >= 2]
    result = {
        'label': label,
        'tourId': manifest.get('tourId'),
        'generationStatus': manifest.get('generationStatus'),
        'pollElapsedMs': manifest.get('pollElapsedMs'),
        'discovery': dict(discovery),
        'candidates': {
            'total': len(candidates),
            'simple': sum(1 for c in candidates if c['hintCount'] <= 1),
            'multiComponent': len(multi),
            'acceptedAfterResolution': sum(1 for c in candidates if c['accepted']),
        },
        'components': {**dict(hints_total), 'unresolvedByReason': dict(reasons)},
        'strategies': {'attempts': dict(strategy_attempts), 'verified': dict(strategy_verified)},
        'route': {
            **dict(route),
            'avgSegmentsPerResolved': round(sum(route_segments) / len(route_segments), 2) if route_segments else None,
            'maxSegments': max(route_segments) if route_segments else None,
            'clustersPerTargetedHint': route_clusters,
            'details': route_hint_details,
        },
        'knownDebt': dict(known_debt),
        'composites': {
            'multiComponentCandidates': len(multi),
            'resolutionBuckets': dict(buckets),
            'geographicValidation': dict(geo),
            'persistedThisRun': len(persisted_ids),
        },
        'providerCallsDerived': dict(calls),
        'db': {
            'experiences': int(counts[0]),
            'experienceComponents': int(counts[1]),
            'geoEntities': int(counts[2]),
            'geoEntityIdentities': int(counts[3]),
            'routeGeoEntities': int(counts[4]),
            'duplicateIdentityRows': int(dup_identities[0][0]),
            'multiComponentExperiences': [
                {'id': r[0], 'name': r[1], 'components': int(r[2])} for r in multi_persisted],
            'routeGeoEntities_detail': [
                {'id': r[0], 'name': r[1], 'identities': int(r[2])} for r in route_rows],
        },
        'forensicControls': forensic,
        'candidateDetails': candidates,
    }
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)


if __name__ == '__main__':
    main()
