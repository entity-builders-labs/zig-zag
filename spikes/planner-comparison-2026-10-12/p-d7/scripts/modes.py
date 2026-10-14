"""Mode-mix summary per policy: walk/drive legs and minutes, short hops, Σu, scheduled.
Usage: python -I modes.py <runs/file.json> [profile]"""
import json, sys
d = json.load(open(sys.argv[1])); prof = sys.argv[2] if len(sys.argv) > 2 else None
for p in d['meta']['params']:
    rs = [r for r in d['rows'] if r['params']['name'] == p['name'] and r['status'] == 'PLANNED' and (prof is None or r['profile'] == prof)]
    if not rs:
        continue
    wl = sum(r['walkLegs'] for r in rs); dl = sum(r['driveLegs'] for r in rs)
    wm = sum(r['walkMin'] for r in rs); dm = sum(r['driveMin'] for r in rs)
    print(f"{p['name']}: walkLegs {wl} driveLegs {dl} walkMin {wm:.0f} driveMin {dm:.0f} avgWalk {wm / max(wl, 1):.1f} avgDrive {dm / max(dl, 1):.1f} "
          f"shortHops {sum(r['shortHopDrive'] for r in rs)} sumU {sum(r['sumU'] for r in rs):.2f} sched {sum(r['scheduled'] for r in rs)} "
          f"unknown {sum(r['unknownVisits'] for r in rs)}")
