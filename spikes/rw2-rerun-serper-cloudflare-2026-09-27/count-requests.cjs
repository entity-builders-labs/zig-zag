// Spike-only preload (`node -r ./count-requests.cjs dist/src/main.js`):
// appends one NDJSON line per outbound HTTP request -- timestamp and a
// provider key derived from host + path ONLY. Never records query strings,
// headers or bodies (no keys, no payloads). Not production code.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const out = process.env.REQUEST_COUNT_FILE;
if (!out) throw new Error('REQUEST_COUNT_FILE is required');

function providerKey(u) {
  const h = u.hostname;
  const p = u.pathname;
  if (h === 'api.geoapify.com') {
    if (p.startsWith('/v2/place-details')) return 'geoapify.place-details';
    if (p.startsWith('/v1/geocode/search')) return 'geoapify.geocode-search';
    if (p.startsWith('/v2/places')) return 'geoapify.places';
    return `geoapify${p}`;
  }
  if (u.port === '8088') return `nominatim.local${p}`;
  if (u.port === '12345') return 'overpass.local';
  if (h.endsWith('wikidata.org')) return 'wikidata';
  if (h.endsWith('wikipedia.org')) return `wikipedia(${h})`;
  if (h === 'serpapi.com') return 'serpapi';
  if (h === 'google.serper.dev') return 'serper';
  if (h === 'places.googleapis.com') return 'google.places';
  if (h === 'maps.googleapis.com') return 'google.maps';
  if (h === 'api.groq.com') return 'groq';
  if (h === 'api.cloudflare.com') return 'cloudflare.workers-ai';
  if (h.endsWith('googleapis.com')) return `google(${h})`;
  if (h === 'localhost' || h === '127.0.0.1') return `localhost:${u.port}`;
  return h;
}

function record(input) {
  let key = 'unknown';
  try {
    const u = input instanceof URL ? input : new URL(String(input));
    key = providerKey(u);
  } catch {}
  fs.appendFileSync(out, JSON.stringify({ t: Date.now(), key }) + '\n');
}

function urlFromOptions(proto, args) {
  const [a, b] = args;
  if (typeof a === 'string' || a instanceof URL) return new URL(String(a));
  const o = a || b || {};
  const host = o.hostname || (o.host || 'unknown').split(':')[0];
  const port = o.port ? `:${o.port}` : '';
  return new URL(`${proto}//${host}${port}${o.path || '/'}`);
}

for (const [mod, proto] of [
  [http, 'http:'],
  [https, 'https:'],
]) {
  for (const name of ['request', 'get']) {
    const original = mod[name];
    mod[name] = function patched(...args) {
      try {
        record(urlFromOptions(proto, args));
      } catch {}
      return original.apply(this, args);
    };
  }
}
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function patchedFetch(input, init) {
    record(typeof input === 'string' || input instanceof URL ? input : input?.url);
    return originalFetch.call(this, input, init);
  };
}
