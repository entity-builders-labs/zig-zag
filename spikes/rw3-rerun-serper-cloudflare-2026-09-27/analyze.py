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
            "groundedSearchProvider": {
                "source": "provider-requests.ndjson + trace executionSummary",
                "fact": f"Grounded search executed via Serper (canonical rerun pair): serper={providers.get('serper', 0)} request(s), cloudflare.workers-ai={providers.get('cloudflare.workers-ai', 0)} extraction(s); providersFailed={trace['executionSummary']['acquisition']['providersFailed']}",
            },
            "anchorDiscoveryBranches": {
                "source": "anchor-resolution-repro.json (compiled production resolver, read-only, same local providers + destination scope)",
                "note": "repro selectCandidate reflects the pre-fix cross-kind helper; the authoritative post-fix decision is the live trace anchor_geo_resolution (route SELECTED, venue homonym REJECTED_DESTINATION_INCOMPATIBLE).",
                "discoverArea": repro["discoverArea"],
                "discoverRoute": repro["discoverRoute"],
                "discoverPlace": repro["discoverPlace"],
                "selectCandidate": repro["selectCandidate"],
                "nominatimResultCount": repro["nominatimSearchAsCalled"]["resultCount"],
                "targetedRouteResolver": {k: repro["targetedRouteResolver"][k] for k in ("status", "reason")},
            },
            "caminitoRouteGeometry": {
                "source": "anchor-resolution-repro.json discoverRouteFullGeometry",
                "geometryType": (repro.get("discoverRouteFullGeometry") or {}).get("type"),
                "lineCount": len((repro.get("discoverRouteFullGeometry") or {}).get("coordinates") or []),
                "coordinateCount": sum(len(line) for line in ((repro.get("discoverRouteFullGeometry") or {}).get("coordinates") or [])),
                "externalId": (repro.get("discoverRoute") or {}).get("externalId"),
            },
            "destinationBoundaryId": repro["destination"]["boundaryId"],
        },
        "fixedDefectEvidence": [
            "F1 FIXED (live): anchor_geo_resolution resolved Caminito as kind=route (osm:way:144844726); candidateFacts show route ELIGIBLE/SELECTED (COMPATIBLE, WITHIN_DESTINATION_BOUNDARY) and the Ezeiza venue homonym REJECTED_DESTINATION_INCOMPATIBLE (OUTSIDE_DESTINATION_BOUNDARY). Pre-fix behavior discarded both via cross-kind ambiguity.",
            "F2 OBSERVED (no failure this run): grounded search ran via Serper and succeeded; providersAttempted names 'serper' (not generic 'web'); providersFailed=[] -- failure provenance path exercised by unit/integration tests instead.",
            "F3 FIXED (live): persisted anchor steps carry bounded candidateFacts (area/route/place branch eligibility, decision, compatibility, discovery status/reason) -- audit-only, no downstream coupling.",
            "F4 FIXED (live): destination_resolution outputs include boundaryId osm:relation:1224652 + boundaryName; coverage routing output includes anchorMode='canonical' for the resolved route anchor (AREA_ROUTE_WALK=1; GENERIC=0).",
        ],
        "newFindings": [
            "N1: generation still FAILS closed at coverage_analysis (intent:walk has no strong catalog match). Pass 1 produced 1 web candidate ('Avenida de Mayo to Congreso Walking Route', 2 anchors) which entity_resolution accepted but geographic_validation REJECTED with external_scope_mismatch; pass 2 produced 0 candidates. Extraction targeted a generic BA walk instead of the resolved Caminito route corridor.",
            "N2: fail-closed behavior is canonical: no silent generic fallback, explicit failure message, ACQ budget respected (1 serper + 1 cloudflare extraction, 2 bounded passes).",
        ],
    }


if __name__ == "__main__":
    out = analyze("cold")
    (BASE / "cold" / "analysis.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print("wrote cold/analysis.json")
