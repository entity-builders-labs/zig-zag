#!/usr/bin/env python3
"""Stage 4: per-candidate component matrix from a generation trace.

Usage: component-matrix.py <run-dir>  (reads <run-dir>/generation-trace.json)
Emits JSON: every entity_resolution candidate with >1 component hint, its
coverage, per-component identity/geography/deficit, admission outcome.
"""
import json, sys
trace = json.load(open(f"{sys.argv[1]}/generation-trace.json"))
out = []
for index, step in enumerate(trace["steps"]):
    for decision in step.get("entityResolutionAudit") or []:
        hints = decision.get("hints", [])
        out.append({
            "stepIndex": index,
            "candidate": decision["candidateName"],
            "accepted": decision["accepted"],
            "rejectionReasons": decision["rejectionReasons"],
            "scope": decision.get("componentScope"),
            "coverage": decision.get("coverage"),
            "components": [
                {
                    "hint": h["name"],
                    "role": h["role"],
                    "expectedKind": h.get("expectedKind"),
                    "identityStatus": h.get("identityStatus"),
                    "geoEntityId": (h.get("geography") or {}).get("geoEntityId"),
                    "canonicalGeometry": (h.get("geography") or {}).get("canonicalGeometry"),
                    "relation": (h.get("geography") or {}).get("geographicRelation"),
                    "distanceToBoundaryMeters": (h.get("geography") or {}).get("distanceToBoundaryMeters"),
                    "deficit": h.get("deficit"),
                    "finalReason": h.get("reason"),
                }
                for h in hints
            ],
        })
json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
