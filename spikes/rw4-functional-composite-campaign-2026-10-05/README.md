# RW4 functional composite campaign — 2026-10-05

Bounded real-source campaign for the RW4 functional milestone: one authentic
source-defined multi-component Experience persisted COLD and reused WARM
through the real HTTP pipeline, with the identity policy at HEAD unchanged.

- Runner: `run.sh <label> <db> fresh|reuse <port> <request.json> [cloudflare|tavily]`
  (parameterized copy of the canonical RW4 Mendoza runner; see its header for
  the two recorded differences).
- Requests: `requests/` — destination-bounded walking shapes only; requests
  never name a place the campaign hopes to find.
- Mobility uses the real `enjoys_walking` product preset (10000 m / 3000 m).
- Every attempted run is recorded in `campaign-log.md`, favorable or not.
