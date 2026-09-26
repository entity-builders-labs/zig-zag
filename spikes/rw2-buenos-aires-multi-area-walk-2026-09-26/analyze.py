#!/usr/bin/env python3
"""RW2 spike analyzer — writes structured analysis.json per run."""
import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load(p):
    return json.loads(p.read_text()) if p.exists() else {}


def providers(run):
    c = Counter()
    p = BASE / run / "provider-requests.ndjson"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.strip():
                c[json.loads(line)["key"]] += 1
    return dict(sorted(c.items()))


def analyze(run):
    trace = load(BASE / run / "generation-trace.json")
    manifest = load(BASE / run / "run-manifest.json")
    db_after = load(BASE / run / "db-after.json")
    steps = {s["stage"]: s for s in trace.get("steps", [])}
    out = {
        "runLabel": manifest.get("runLabel"),
        "tourId": manifest.get("tourId"),
        "generationStatus": manifest.get("generationStatus"),
        "pollElapsedMs": manifest.get("pollElapsedMs"),
        "steps": [s["stage"] for s in trace.get("steps", [])],
        "providers": providers(run),
    }
    pi = steps.get("preference_interpretation", {})
    intent = (pi.get("outputs") or {}).get("intent") or {}
    spec = (pi.get("outputs") or {}).get("preferenceSpec") or {}
    out["preferenceInterpretation"] = {
        "model": (pi.get("preferenceInterpretation") or {}).get("model"),
        "anchoredPlaces": intent.get("anchoredPlaces"),
        "preferredFacets": intent.get("preferredFacets"),
        "positiveSemanticQuery": intent.get("positiveSemanticQuery"),
        "preferenceSpec_facets": spec.get("facets"),
        "preferenceSpec_semanticQuery": spec.get("semanticQuery"),
    }
    ar = steps.get("anchor_geo_resolution", {})
    out["resolvedAnchors"] = [
        {k: a.get(k) for k in ("rawName", "usage", "priority", "status", "kind",
                               "canonicalName", "provider", "externalId")}
        for a in ((ar.get("outputs") or {}).get("anchors") or [])
    ]
    routing = next((s for s in trace.get("steps", [])
                    if s.get("component") == "partitionDeficitsByStrategy"), None)
    if routing:
        out["routing"] = {
            "summary": routing.get("summary"),
            "areaRouteWalk": routing.get("outputs", {}).get("areaRouteWalk"),
            "generic": routing.get("outputs", {}).get("generic"),
        }
    disc = steps.get("discovery")
    if disc:
        acq = disc.get("acquisition") or {}
        out["discovery"] = {
            "summary": disc.get("summary"),
            "routedProviders": disc.get("inputs", {}).get("routedProviders"),
            "webResults": disc.get("outputs", {}).get("webResults"),
            "webEvidence": [
                {"key": e.get("evidenceKey"), "title": e.get("title"),
                 "snippet": (e.get("snippet") or e.get("description") or "")[:400]}
                for e in acq.get("evidence", [])
                if (e.get("evidenceKey") or "").startswith("ev-")
            ],
        }
        for cand in acq.get("candidates", []):
            if cand.get("origin") == "web" and cand.get("componentHints"):
                out["webCompositeCandidate"] = {
                    "name": cand.get("name"), "themes": cand.get("themes"),
                    "intents": cand.get("intents"), "evidenceKeys": cand.get("evidenceKeys"),
                    "orderedByEvidence": cand.get("orderedByEvidence"),
                    "componentHints": cand.get("componentHints"),
                }
                break
    for st in ("entity_resolution", "geographic_validation", "catalog_materialization"):
        s = steps.get(st, {})
        out[st] = {"summary": s.get("summary"), "status": s.get("status")}
    nm = {e["id"]: e["name"] for e in db_after.get("experiences", [])}
    out["materializedTour"] = [
        {"order": m.get("order"), "name": nm.get(m.get("experienceId")),
         "componentCount": m.get("componentCount"),
         "durationMinutes": round((m.get("durationHours") or 0) * 60)}
        for m in trace.get("materializedTourExperiences") or []
    ]
    out["dbAfter"] = {k: db_after.get(k) for k in (
        "experience", "experienceByStatus", "geoEntity", "geoEntityByKind",
        "experienceComponent", "duplicateExperienceNames", "duplicateIdentityRows")}
    out["composites"] = [
        {"id": e["id"], "name": e["name"], "components": e["components"],
         "componentSet": e["componentset"]}
        for e in db_after.get("experiences", []) if e.get("components", 0) > 1
    ]
    return out


if __name__ == "__main__":
    result = {"cold": analyze("cold"), "warm": analyze("warm")}
    for run in ("cold", "warm"):
        (BASE / run / "analysis.json").write_text(
            json.dumps(result[run], indent=2, ensure_ascii=False))
    print("wrote cold/analysis.json and warm/analysis.json")
