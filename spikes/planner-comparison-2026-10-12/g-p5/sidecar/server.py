"""Planner sidecar (G-P5 spike): HTTP/JSON over a host-local port. One bounded request per plan.

GET  /healthz  -> optimizer identity and versions (readiness probe)
POST /v1/plan  -> planning-problem-v1 in, planning-result-v1 out
Errors: 400 MALFORMED_REQUEST, 422 CONTRACT_VIOLATION, 500 INTERNAL_ERROR (typed JSON bodies).
Solves are serialized per process (CPU-bound); scale by processes/replicas, not threads.

Fault injection is TEST-ONLY: honoured only when PLANNER_FAULT_INJECTION=1, via header X-Fault:
crash | sleep:<ms> | malformed | bad-plan.
"""
import json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ortools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # -I mode omits the script dir
import adapter as A  # noqa: E402

SOLVE_LOCK = threading.Lock()
FAULTS = os.environ.get('PLANNER_FAULT_INJECTION') == '1'
if FAULTS:   # TEST-ONLY policy: safety cap so small the search stops before any solution
    A.POLICIES['test-only-cap-1ms'] = dict(first='PATH_CHEAPEST_ARC', meta='GUIDED_LOCAL_SEARCH', time_cap_ms=1)
    # TEST-ONLY P11-style wall-clock stop, to show its machine dependence next to the count-based policy
    A.POLICIES['test-only-wallclock-1000ms'] = dict(first='PATH_CHEAPEST_ARC', meta='GUIDED_LOCAL_SEARCH', time_cap_ms=1000)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):   # keep the benchmark quiet; production would log structured lines
        pass

    def _send(self, code, body, extra=None):
        t = time.perf_counter()
        raw = body if isinstance(body, bytes) else json.dumps(body, separators=(',', ':')).encode()
        ser_ms = (time.perf_counter() - t) * 1000
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('X-Serialize-Ms', f'{ser_ms:.2f}')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != '/healthz':
            return self._send(404, {'error': 'NOT_FOUND'})
        self._send(200, {'status': 'ok', 'optimizer': A.OPTIMIZER, 'optimizerVersion': ortools.__version__,
                         'adapterVersion': A.ADAPTER_VERSION, 'policies': sorted(A.POLICIES)})

    def do_POST(self):
        if self.path != '/v1/plan':
            return self._send(404, {'error': 'NOT_FOUND'})
        t0 = time.perf_counter()
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        fault = self.headers.get('X-Fault') if FAULTS else None
        try:
            req = json.loads(raw)
        except ValueError:
            return self._send(400, {'error': 'MALFORMED_REQUEST'})
        t_parse = time.perf_counter()
        if fault == 'crash':
            os._exit(70)   # simulates a native crash mid-request (no response)
        if fault and fault.startswith('sleep:'):
            time.sleep(int(fault.split(':')[1]) / 1000)
        try:
            with SOLVE_LOCK:
                t_lock = time.perf_counter()
                res = A.solve(req)
        except A.ContractError as e:
            return self._send(422, {'error': 'CONTRACT_VIOLATION', 'detail': str(e)})
        except Exception as e:   # noqa: BLE001 - any adapter/runtime failure is typed, never a verdict
            return self._send(500, {'error': 'INTERNAL_ERROR', 'detail': type(e).__name__})
        if fault == 'malformed':
            return self._send(200, b'{"contractVersion":"planning-result-v1","status":')
        if fault == 'bad-plan' and res.get('status') == 'PLANNED':
            for d in res['days']:
                if d['items']:
                    d['items'][0]['start'] -= 600; d['items'][0]['end'] -= 600; break
        res['timings'].update({'parseMs': round((t_parse - t0) * 1000, 2), 'queueMs': round((t_lock - t_parse) * 1000, 2),
                               'serverHandlerMs': round((time.perf_counter() - t0) * 1000, 2)})
        self._send(200, res)


def main():
    host = os.environ.get('PLANNER_HOST', '127.0.0.1'); port = int(os.environ.get('PLANNER_PORT', '8090'))
    srv = ThreadingHTTPServer((host, port), Handler)
    print(json.dumps({'event': 'listening', 'host': host, 'port': port, 'optimizerVersion': ortools.__version__}), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
