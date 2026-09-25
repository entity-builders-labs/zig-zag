#!/usr/bin/env python3
"""Stage 5 RW1 analyzer (spike-only).

Reads each run dir (generation-trace.json, run-manifest.json,
provider-requests.ndjson, db-before/after.json) and writes:
  <run>/analysis.json  -- per-run candidate/component/composite facts
  matrix.json          -- one row per (run, candidate), comparable across runs
  provider-counts.json -- outbound requests per provider key, per run
Only reads the typed trace fields; no raw provider payloads are copied.

Usage: analyze.py <spike-dir> <run-label>...
"""
import json
import sys
from collections import Counter
from pathlib import Path

base = Path(sys.argv[1])
labels = sys.argv[2:]


def load(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def providers(run_dir):
    counts = Counter()
    path = run_dir / "provider-requests.ndjson"
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                counts[json.loads(line)["key"]] += 1
    return dict(sorted(counts.items()))


def component(hint):
    geo = hint.get("geography") or {}
    deficit = hint.get("deficit") or {}
    attempts = hint.get("attempts") or []
    verified = [a["strategy"] for a in attempts if a.get("verificationDecision") == "VERIFIED"]
    return {
        "hint": hint["name"],
        "role": hint.get("role"),
        "expectedKind": hint.get("expectedKind"),
        "identityStatus": hint.get("identityStatus"),
        "geoEntityId": geo.get("geoEntityId"),
        "canonicalName": (hint.get("resolvedGeoEntity") or {}).get("canonicalName"),
        "externalId": (hint.get("resolvedGeoEntity") or {}).get("externalId"),
        "geoEntityKind": geo.get("geoEntityKind"),
        "canonicalGeometry": geo.get("canonicalGeometry"),
        "relation": geo.get("geographicRelation") if geo else "N/A",
        "distanceToBoundaryMeters": geo.get("distanceToBoundaryMeters"),
        "deficitReason": deficit.get("reason"),
        "deficitClassification": deficit.get("classification"),
        "finalReason": hint.get("reason"),
        "verifiedBy": verified[0] if verified else None,
        "attempts": [
            {
                "strategy": a["strategy"],
                "provider": a.get("provider"),
                "execution": a.get("executionStatus"),
                "acquired": a.get("candidateAcquired"),
                "selected": (a.get("selectedCandidate") or {}).get("externalId"),
                "verdict": a.get("verificationDecision"),
                "evidence": [
                    e.get("type")
                    + (f"({e['identityMultiplicity']})" if e.get("identityMultiplicity") else "")
                    for e in a.get("identityEvidence") or []
                ],
                **({"route": f"{a['routeResolution']['status']}/{a['routeResolution']['reason']}"} if a.get("routeResolution") else {}),
                **({"failure": a.get("failureReason")} if a.get("failureReason") else {}),
            }
            for a in attempts
        ],
    }


def analyze(label):
    run_dir = base / label
    trace = load(run_dir / "generation-trace.json", {"steps": []})
    manifest = load(run_dir / "run-manifest.json", {})
    steps = trace.get("steps", [])
    origins = {}
    extractor = []
    for step in steps:
        acq = step.get("acquisition") or {}
        for cand in acq.get("candidates") or []:
            origins[cand["traceKey"]] = cand.get("origin")
        if step.get("stage") == "discovery":
            for plan in acq.get("sourcePlans") or []:
                web = plan.get("web") or {}
                ext = web.get("extractor")
                if ext is None:
                    continue
                extractor.append({
                    "pass": (step.get("acquisitionContext") or {}).get("passNumber"),
                    "strategy": (step.get("acquisitionContext") or {}).get("strategy"),
                    "groundedProvider": web.get("groundedProvider"),
                    "evidenceCount": len(web.get("evidence") or []),
                    "extracted": ext.get("extractedCandidateCount"),
                    "admitted": ext.get("admittedCandidateCount"),
                    "rejected": ext.get("rejectedCandidateCount"),
                    "sourceSupport": [
                        {
                            "candidate": audit.get("candidateName"),
                            "status": audit.get("status"),
                            "components": [
                                f"{c['name']}:{c['status']}" for c in audit.get("components") or []
                            ],
                        }
                        for audit in ext.get("sourceSupportAudits") or []
                    ],
                })
    geo = {}
    outcomes = {}
    candidates = []
    for index, step in enumerate(steps):
        for dec in step.get("geographicValidationAudit") or []:
            geo[(index, dec["candidateTraceKey"])] = dec
        for dec in step.get("materializationAudit") or []:
            outcomes[(index, dec["candidateTraceKey"])] = dec
    for index, step in enumerate(steps):
        for dec in step.get("entityResolutionAudit") or []:
            key = dec["candidateTraceKey"]
            g = next(
                (v for (i, k), v in sorted(geo.items(), key=lambda kv: kv[0][0]) if k == key and i > index),
                None,
            )
            # The first materialization step after THIS entity_resolution step
            # (the same trace key can recur in a later acquisition pass).
            mat = next(
                (v for (i, k), v in sorted(outcomes.items(), key=lambda kv: kv[0][0]) if k == key and i > index),
                None,
            )
            out = (mat or {}).get("compositeOutcome")
            candidates.append({
                "stepIndex": index,
                "candidate": dec["candidateName"],
                "origin": origins.get(key),
                "shape": "composite" if len(dec["hints"]) > 1 else "simple",
                "componentCount": len(dec["hints"]),
                "components": [component(h) for h in dec["hints"]],
                "coverage": dec.get("coverage"),
                "componentScope": dec.get("componentScope"),
                "entityResolution": {
                    "admittedToGeographicValidation": dec["accepted"],
                    "rejectionReasons": dec["rejectionReasons"],
                },
                "compositeGeographicValidation": (
                    {
                        "reached": True,
                        "accepted": g["accepted"],
                        "status": g["status"],
                        "strategy": g.get("strategy"),
                        "rejectionReasons": g["rejectionReasons"],
                        "offending": [
                            c["hintName"] for c in g.get("components") or [] if c.get("relation") == "offending"
                        ],
                    }
                    if g
                    else {"reached": False}
                ),
                "compositeOutcome": out,
            })
    planner = trace.get("materializedTourExperiences") or []
    return {
        "label": label,
        "tourId": manifest.get("tourId"),
        "generationStatus": manifest.get("generationStatus"),
        "pollElapsedMs": manifest.get("pollElapsedMs"),
        "providerRequests": providers(run_dir),
        "extractor": extractor,
        "stepsExecuted": [s["stage"] for s in steps],
        "candidates": candidates,
        "plannerSelected": planner,
        "dbBefore": load(run_dir / "db-before.json"),
        "dbAfter": load(run_dir / "db-after.json"),
    }


runs = [analyze(label) for label in labels]
for run in runs:
    (base / run["label"] / "analysis.json").write_text(json.dumps(run, indent=2, ensure_ascii=False))

matrix = []
for run in runs:
    for cand in run["candidates"]:
        out = cand.get("compositeOutcome") or {}
        matrix.append({
            "run": run["label"],
            "candidate": cand["candidate"],
            "origin": cand["origin"],
            "shape": cand["shape"],
            "sourceComponentHints": [c["hint"] for c in cand["components"]],
            "identityStatuses": {c["hint"]: c["identityStatus"] for c in cand["components"]},
            "geoRelations": {c["hint"]: c["relation"] for c in cand["components"]},
            "deficits": {
                c["hint"]: f"{c['deficitReason']}/{c['deficitClassification']}"
                for c in cand["components"]
                if c["deficitReason"]
            },
            "coverage": (
                f"{cand['coverage']['identityResolvedComponents']}/{cand['coverage']['totalComponents']}"
                if cand.get("coverage")
                else None
            ),
            "sourceCompositionComplete": (cand.get("coverage") or {}).get("sourceCompositionComplete"),
            "compositeDecision": (out.get("geographicDecision") or {}),
            "persistence": (out.get("persistence") or {}),
            "plannerEligible": out.get("plannerEligible"),
        })
(base / "matrix.json").write_text(json.dumps(matrix, indent=2, ensure_ascii=False))
(base / "provider-counts.json").write_text(
    json.dumps({run["label"]: run["providerRequests"] for run in runs}, indent=2)
)
for run in runs:
    comps = [c for c in run["candidates"] if c["shape"] == "composite"]
    print(
        run["label"], run["generationStatus"], run["pollElapsedMs"],
        "candidates", len(run["candidates"]), "composites", len(comps),
        "providers", run["providerRequests"],
    )
