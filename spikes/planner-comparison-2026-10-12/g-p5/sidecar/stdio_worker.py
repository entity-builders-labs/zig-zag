"""Option C (G-P5 spike): long-lived planner worker process speaking JSON lines over stdin/stdout.
Same adapter and contract as server.py; used to measure the child-process alternative to HTTP."""
import json, os, sys, time
import ortools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # -I mode omits the script dir
import adapter as A  # noqa: E402

print(json.dumps({'event': 'ready', 'optimizerVersion': ortools.__version__}), flush=True)
for line in sys.stdin:
    t0 = time.perf_counter()
    try:
        req = json.loads(line)
        res = A.solve(req)
        res['timings']['serverHandlerMs'] = round((time.perf_counter() - t0) * 1000, 2)
    except A.ContractError as e:
        res = {'error': 'CONTRACT_VIOLATION', 'detail': str(e)}
    except Exception as e:   # noqa: BLE001
        res = {'error': 'INTERNAL_ERROR', 'detail': type(e).__name__}
    sys.stdout.write(json.dumps(res, separators=(',', ':')) + '\n'); sys.stdout.flush()
