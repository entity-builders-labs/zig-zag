#!/usr/bin/env python3
"""RW3 anchor-handoff rerun analyzer -- trace-first. Writes cold/analysis.json.

Every fact below comes from cold/generation-trace.json (the Bitácora), except
DB counts (db-*.json), request counts (provider-requests.ndjson) and the
provider preflight (provider-preflight.json), each labelled by source.
"""
import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load(p):
    return json.loads(p.read_text())


def analyze(run):
    d = BASE / run
    t = load(d / "generation-trace.json")
    steps = t["steps"]
    by = lambda stage, comp=None: [s for s in steps if s["stage"] == stage and (comp is None or s.get("component") == comp)]
    pi = by("preference_interpretation")[0]
    anchors = by("anchor_geo_resolution")[0]["outputs"]["anchors"]
    routing = by("coverage_analysis", "partitionDeficitsByStrategy")
    disc = by("discovery")
    web = [sp["web"] for sp in disc[0]["acquisition"]["sourcePlans"] if sp.get("web")][0]
    ex = web["extractor"]
    er = by("entity_resolution")[0]
    counts = lambda s: {k: s[k] for k in ("geoEntity", "geoEntityIdentity", "experience", "experienceComponent")}
    return {
        "source": "generation-trace.json unless labelled",
        "tourId": load(d / "run-manifest.json")["tourId"],
        "generationStatus": load(d / "run-manifest.json")["generationStatus"],
        "pollElapsedMs": load(d / "run-manifest.json")["pollElapsedMs"],
        "failure": t["executionSummary"].get("failure"),
        "providerPreflight[provider-preflight.json]": load(d / "provider-preflight.json"),
        "providerRequests[provider-requests.ndjson]": dict(sorted(Counter(json.loads(l)["key"] for l in (d / "provider-requests.ndjson").read_text().splitlines() if l.strip()).items())),
        "dbBefore[db-before.json]": counts(load(d / "db-before.json")),
        "dbAfter[db-after.json]": counts(load(d / "db-after.json")),
        "persistedGeoEntities[db-after.json]": [
            {"name": g["name"], "kind": g["kind"], "geometryType": g.get("geometrytype") or g.get("geometryType"), "identities": g.get("identities")}
            for g in load(d / "db-after.json")["geoEntities"]
        ],
        "interpretation": {
            "wizardIntents": pi["inputs"]["intents"],
            "anchoredPlaces": pi["outputs"]["intent"]["anchoredPlaces"],
            "semanticQuery": pi["outputs"]["preferenceSpec"]["semanticQuery"],
            "specFacets": pi["outputs"]["preferenceSpec"]["facets"],
        },
        "destination": by("destination_resolution")[0]["outputs"],
        "anchorResolution": [
            {**{k: a.get(k) for k in ("rawName", "status", "kind", "canonicalName", "provider", "externalId", "unresolvedReason")},
             "geometryType": (a.get("geometry") or {}).get("type"),
             "geometryCoordinateCount": sum(len(line) for line in (a.get("geometry") or {}).get("coordinates", [])) if (a.get("geometry") or {}).get("type") == "MultiLineString" else None,
             "candidateFacts": a.get("candidateFacts")}
            for a in anchors
        ],
        "routingPerPass": [
            {"summary": r["summary"], "areaRouteWalk": [(x["anchor"]["rawName"], x.get("anchorMode"), x["intentKey"]) for x in r["outputs"]["areaRouteWalk"]]}
            for r in routing
        ],
        "handoff": {
            "sourcePlanWebAnchorNames": web.get("anchorNames"),
            "extractorRequestAnchorNames": ex.get("requestAnchorNames"),
            "webQuery": web["query"],
            "groundedProvider": web.get("groundedProvider"),
            "groundingStatus": web.get("groundingStatus"),
            "extractor": [ex.get("provider"), ex.get("model")],
        },
        "evidence": [{"key": e.get("evidenceKey"), "title": e.get("title"), "url": e.get("url"), "snippet": e.get("snippet")} for e in web["evidence"]],
        "extraction": {
            "extractedCandidateCount": ex["extractedCandidateCount"],
            "admittedCandidateCount": ex["admittedCandidateCount"],
            "candidates": [
                {"name": dec["candidate"]["name"], "themes": dec["candidate"].get("themes"), "intents": dec["candidate"].get("intents"),
                 "evidenceKeys": dec["candidate"].get("evidenceKeys"), "orderedByEvidence": dec["candidate"].get("orderedByEvidence"),
                 "componentHints": dec["candidate"].get("componentHints"), "admission": [dec["accepted"], dec["reason"], dec["candidateShapeMatches"]]}
                for dec in ex["candidateDecisions"]
            ],
            "sourceSupportAudits": ex.get("sourceSupportAudits"),
        },
        "entityResolution": {
            "summary": er["summary"],
            "candidateDecisions": er.get("candidateDecisions"),
            "perHint": [
                {"name": h["name"], "status": h["status"], "resolvedGeoEntity": h.get("resolvedGeoEntity"), "geography": h.get("geography"),
                 "attempts": [(a["strategy"], a["provider"], a.get("candidateAcquired"), a.get("verificationDecision")) for a in h["attempts"]]}
                for c in er["entityResolutionAudit"] for h in c["hints"]
            ],
            "coverage": [c.get("coverage") for c in er["entityResolutionAudit"]],
            "componentScope": [c.get("componentScope") for c in er["entityResolutionAudit"]],
        },
        "geographicValidation": [s["summary"] for s in by("geographic_validation")],
        "catalogMaterialization": [s["summary"] for s in by("catalog_materialization")],
        "discoveryPerPass": [s["summary"] for s in disc],
        "executionSummaryAcquisition": t["executionSummary"]["acquisition"],
        "traceGaps": [
            "sourceSupportAudits record SUPPORTED per component but not the verified supportSpan text; the raw extractor output is not persisted in the trace, so the exact quoted support cannot be re-read from the Bitácora (minor).",
        ],
    }


if __name__ == "__main__":
    out = analyze("cold")
    (BASE / "cold" / "analysis.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print("wrote cold/analysis.json")
