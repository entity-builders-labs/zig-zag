#!/usr/bin/env python3
"""RW3 spike analyzer -- writes cold/analysis.json from the Bitacora first.

Trace-derived facts come ONLY from generation-trace.json. Facts the trace
could not supply are listed under `traceGaps` and, where established, taken
from the read-only production-code repro (anchor-resolution-repro.json) and
the backend log, each labelled with its source.
"""
import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load(p):
    return json.loads(p.read_text()) if p.exists() else None


def analyze(run):
    d = BASE / run
    trace = load(d / "generation-trace.json")
    manifest = load(d / "run-manifest.json")
    repro = load(d / "anchor-resolution-repro.json")
    geom = load(d / "caminito-route-geometry.json")
    before, after = load(d / "db-before.json"), load(d / "db-after.json")
    steps = trace["steps"]
    by = lambda stage, comp=None: [s for s in steps if s["stage"] == stage and (comp is None or s.get("component") == comp)]
    pi = by("preference_interpretation")[0]["outputs"]
    anchor_step = by("anchor_geo_resolution")[0]
    routing = by("coverage_analysis", "partitionDeficitsByStrategy")
    arw = by("area_route_walk_acquisition")
    disc = by("discovery")
    providers = Counter(json.loads(l)["key"] for l in (d / "provider-requests.ndjson").read_text().splitlines() if l.strip())
    counts = lambda s: {k: s[k] for k in ("geoEntity", "geoEntityIdentity", "experience", "experienceComponent")}
    return {
        "runLabel": manifest["runLabel"],
        "tourId": manifest["tourId"],
        "generationStatus": manifest["generationStatus"],
        "pollElapsedMs": manifest["pollElapsedMs"],
        "failure": trace["executionSummary"].get("failure"),
        "stages": [f'{s["stage"]}/{s.get("component")}:{s.get("status")}' for s in steps],
        "providerRequests": dict(sorted(providers.items())),
        "coldPrecondition": {"dbBefore": counts(before), "empty": all(v == 0 for v in counts(before).values())},
        "dbAfter": counts(after),
        "fromTrace": {
            "wizardIntents": by("preference_interpretation")[0]["inputs"]["intents"],
            "interpretedAnchors": pi["intent"]["anchoredPlaces"],
            "preferredFacets": [(f["dimension"], f["key"], f["source"]) for f in pi["intent"]["preferredFacets"]],
            "specFacets": pi["preferenceSpec"]["facets"],
            "semanticQuery": pi["preferenceSpec"]["semanticQuery"],
            "resolvedAnchors": anchor_step["outputs"]["anchors"],
            "coverageDeficits": by("coverage_analysis", "FacetRetrievalService")[0]["outputs"]["acquisitionDeficits"],
            "routingPerPass": [r["summary"] for r in routing],
            "areaRouteWalkPerPass": [a["outputs"] for a in arw],
            "discoveryPerPass": [
                {
                    "summary": x["summary"],
                    "routedProviders": x["inputs"]["routedProviders"],
                    "webResults": x["outputs"]["webResults"],
                    "providersFailedSummary": trace["executionSummary"]["acquisition"]["providersFailed"],
                    "isolationRule": next((r for r in x.get("rules", []) if r["ruleId"] == "ACQ-ISOLATION-001"), None),
                    "webSourcePlanConfiguration": next((p.get("configuration") for p in (x.get("acquisition") or {}).get("sourcePlans", []) if p["provider"] == "web"), None),
                    "evidenceCount": len((x.get("acquisition") or {}).get("evidence", [])),
                }
                for x in disc
            ],
        },
        "notFromTrace": {
            "groundedSearchFailure": {
                "source": "backend.log",
                "fact": "SerpApiGroundedSearchService: google_ai_mode error 429 'Your account has run out of searches.' (plan_searches_left=0/250 per serpapi account endpoint, checked after the run)",
            },
            "anchorDiscoveryBranches": {
                "source": "anchor-resolution-repro.json (compiled production resolver, read-only, same local providers + destination scope)",
                "discoverArea": repro["discoverArea"],
                "discoverRoute": repro["discoverRoute"],
                "discoverPlace": repro["discoverPlace"],
                "selectCandidate": repro["selectCandidate"],
                "nominatimResultCount": repro["nominatimSearchAsCalled"]["resultCount"],
                "targetedRouteResolver": {k: repro["targetedRouteResolver"][k] for k in ("status", "reason")},
            },
            "caminitoRouteGeometry": {k: geom[k] for k in ("osm", "tags", "geometryType", "lineCount", "coordinateCount", "bounds", "lengthMetersHaversine")},
            "destinationBoundaryId": repro["destination"]["boundaryId"],
        },
        "traceGaps": [
            "T1 anchor_geo_resolution exposes only unresolvedReason=NO_CONFIDENT_GEO_ENTITY_MATCH: no per-branch (area/route/place) candidates, provider ids, reasons, or the cross-kind selectCandidate ambiguity decision.",
            "T2 grounded-search provider failure (SerpAPI 429 quota exhausted, failureReason) is dropped: web result status=success, no failureReason, providersFailed=[], ACQ-ISOLATION-001 PASS 'Todas las fuentes atendidas respondieron'.",
            "T3 (minor) partitionDeficitsByStrategy output omits anchorMode (tourism_route vs canonical); inferable only from anchor.status.",
            "T4 (minor) destination_resolution outputs omit the boundary identity (osm:relation:1224652); only boundaryName is traced.",
        ],
    }


if __name__ == "__main__":
    out = analyze("cold")
    (BASE / "cold" / "analysis.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print("wrote cold/analysis.json")
