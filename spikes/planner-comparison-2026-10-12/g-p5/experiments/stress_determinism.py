"""Determinism under CPU contention (G-P5): the same request solved on an idle machine and while N busy
processes compete for the CPU (a stand-in for a slower/throttled host, e.g. a burstable instance out of
CPU credits). A wall-clock stop changes the plan; a count-based stop must not.
Usage: python -I stress_determinism.py <case> <hogs> <policy-name>... ; writes ../runs/stress_determinism.json"""
import json, multiprocessing as mp, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import build_request as B   # noqa: E402
import adapter as A   # noqa: E402
from stop_policies import POLICIES   # noqa: E402


def hog(stop):
    x = 0
    while not stop.is_set():
        x += 1


def run(req, pol, reps):
    outs = [A.solve(req, pol) for _ in range(reps)]
    return [{'sig': json.dumps(o['days'], sort_keys=True), 'objective': o['objectiveValue'], 'solveMs': o['timings']['solveMs'],
             'solutions': o['optimizer']['solutionsGenerated']} for o in outs]


def main():
    case, hogs, names = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
    req = next(c for c in json.load(open(os.path.join(os.path.dirname(HERE), 'runs', 'bench_cases.json'))) if c['name'] == case)['pythonRequest']
    rows = []
    for name in names:
        pol = POLICIES[name][0]
        idle = run(req, pol, 3)
        stop = mp.Event(); ps = [mp.Process(target=hog, args=(stop,)) for _ in range(hogs)]
        for p in ps: p.start()
        time.sleep(0.5)
        loaded = run(req, pol, 3)
        stop.set()
        for p in ps: p.join()
        sigs = {r['sig'] for r in idle + loaded}
        row = {'case': case, 'policy': name, 'hogs': hogs, 'distinctPlans': len(sigs),
               'idle': [{k: v for k, v in r.items() if k != 'sig'} for r in idle],
               'loaded': [{k: v for k, v in r.items() if k != 'sig'} for r in loaded]}
        rows.append(row); print(json.dumps(row), flush=True)
    path = os.path.join(os.path.dirname(HERE), 'runs', 'stress_determinism.json')
    prev = json.load(open(path)) if os.path.exists(path) else []
    json.dump(prev + rows, open(path, 'w'), indent=1)


if __name__ == '__main__':
    main()
