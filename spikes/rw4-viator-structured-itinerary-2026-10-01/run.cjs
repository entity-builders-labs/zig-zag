#!/usr/bin/env node
/*
 * RW4 Viator structured-itinerary spike (2026-10-01).
 *
 * Standalone, read-only probe of the live Viator Partner API (affiliate key).
 * NOT production code: no Nest/DI, no persistence, no acquisition routing.
 *
 * Credential: read ONLY from process.env.VIATOR_API_KEY (load it with
 * `node --env-file=<gitignored env file> run.cjs`). The key is never logged
 * or written; every artifact is scanned for it before the run reports OK.
 *
 * Endpoints used (all non-transactional):
 *   GET  /destinations          — access check + Mendoza destination id
 *   POST /search/freetext       — product discovery (fixed query set)
 *   GET  /products/{code}       — authoritative product content/itinerary
 *   POST /locations/bulk        — itinerary location ref resolution
 *
 * Raw responses are cached under raw/ so re-analysis never re-spends calls
 * (pass --refresh to force live calls).
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Base URL is non-secret; default is LIVE production. The 2026-10-01 run
// used the sandbox (VIATOR_API_BASE_URL) because the available key is a
// sandbox key (production returned 401 Invalid API Key).
const BASE = process.env.VIATOR_API_BASE_URL || 'https://api.viator.com/partner';
const OUT = __dirname;
const RAW = path.join(OUT, 'raw');
const DETAILS = path.join(OUT, 'product-details');
const REFRESH = process.argv.includes('--refresh');

// Fixed, pre-declared discovery queries (Step 3). Sampling below is rank-based
// over these results and never looks at itinerary content.
const QUERIES = [
  'Mendoza wine tour',
  'Maipu wine tour',
  'Lujan de Cuyo winery tour',
  'Uco Valley wine tour',
  'Mendoza wine bus',
  'Mendoza full day wine excursion',
];
const PER_QUERY_RESULTS = 20;
const TOP_PER_QUERY = 5; // max round-robin depth; loop stops at SAMPLE_CAP
const SAMPLE_CAP = 10;
// Explicitly labeled, out-of-sample supplement: inspected ONLY to observe the
// HOP_ON_HOP_OFF itinerary form (rank 19 of 'Mendoza wine tour'). Excluded
// from the quantitative classification counts.
const SUPPLEMENT = [{ productCode: '5674P1222', reason: 'HOP_ON_HOP_OFF form observation (wine bus); out of sample' }];

const KEY = process.env.VIATOR_API_KEY;
if (!KEY) {
  console.error('VIATOR_API_KEY is not set in the environment. Aborting.');
  process.exit(2);
}

const callLog = [];

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function call(method, endpoint, body, cacheName) {
  const cacheFile = path.join(RAW, `${cacheName}.json`);
  if (!REFRESH && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    callLog.push({ method, endpoint, status: cached.status, cached: true });
    return cached;
  }
  const res = await fetch(BASE + endpoint, {
    method,
    headers: {
      'exp-api-key': KEY,
      Accept: 'application/json;version=2.0',
      'Accept-Language': 'en-US',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { nonJsonBody: text.slice(0, 2000) };
  }
  // Only status, endpoint, request body and response body are persisted —
  // request headers (which carry the key) are never written anywhere.
  const record = {
    method,
    endpoint,
    requestBody: body ?? null,
    status: res.status,
    fetchedAt: new Date().toISOString(),
    body: json,
  };
  fs.writeFileSync(cacheFile, JSON.stringify(record, null, 2));
  callLog.push({ method, endpoint, status: res.status, cached: false });
  return record;
}

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(DETAILS, { recursive: true });

  // Step 2 — access check + destination lookup.
  const dest = await call('GET', '/destinations', null, 'destinations');
  if (dest.status !== 200) {
    write('run-manifest.json', { accessCheck: { endpoint: 'GET /destinations', status: dest.status, body: dest.body }, callLog });
    console.error(`Access check failed: HTTP ${dest.status}`);
    process.exit(1);
  }
  const allDest = dest.body.destinations ?? [];
  const mendozaCandidates = allDest.filter((d) => /mendoza/i.test(d.name));
  const mendoza = mendozaCandidates.find((d) => d.type === 'CITY') ?? mendozaCandidates[0];
  if (!mendoza) throw new Error('No Mendoza destination found');

  // Step 3 — discovery.
  const searchResults = [];
  for (const q of QUERIES) {
    const body = {
      searchTerm: q,
      productFiltering: { destination: String(mendoza.destinationId) },
      searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count: PER_QUERY_RESULTS } }],
      currency: 'USD',
    };
    const r = await call('POST', '/search/freetext', body, `search-${slug(q)}`);
    const products = r.body?.products?.results ?? [];
    searchResults.push({
      query: q,
      request: body,
      status: r.status,
      totalCount: r.body?.products?.totalCount ?? null,
      results: products.map((p, i) => ({
        rank: i + 1,
        productCode: p.productCode,
        title: p.title,
        destinations: p.destinations,
        productUrl: p.productUrl,
        itineraryDurationMinutes: p.duration ?? null,
        reviews: p.reviews ? { totalReviews: p.reviews.totalReviews, combinedAverageRating: p.reviews.combinedAverageRating } : null,
        tags: p.tags,
      })),
    });
  }
  write('search-results.json', { mendozaDestination: mendoza, mendozaCandidates, queries: searchResults });

  // Sampling rule: round-robin over queries by rank (rank 1 of every query,
  // then rank 2, ...), skipping duplicates, until SAMPLE_CAP. Content-blind.
  const sample = [];
  for (let rank = 0; rank < TOP_PER_QUERY && sample.length < SAMPLE_CAP; rank++) {
    for (const q of searchResults) {
      const p = q.results[rank];
      if (p && !sample.some((s) => s.productCode === p.productCode) && sample.length < SAMPLE_CAP) {
        sample.push({ productCode: p.productCode, title: p.title, selectedBy: { query: q.query, rank: p.rank } });
      }
    }
  }

  for (const x of SUPPLEMENT) {
    const hit = searchResults.flatMap((q) => q.results.map((r) => ({ q: q.query, r }))).find((h) => h.r.productCode === x.productCode);
    sample.push({ productCode: x.productCode, title: hit?.r.title ?? null, selectedBy: { supplement: true, reason: x.reason, query: hit?.q ?? null, rank: hit?.r.rank ?? null } });
  }

  // Step 4 — authoritative detail.
  const products = [];
  for (const s of sample) {
    const r = await call('GET', `/products/${encodeURIComponent(s.productCode)}`, null, `product-${s.productCode}`);
    fs.writeFileSync(path.join(DETAILS, `${s.productCode}.json`), JSON.stringify(r.body, null, 2) + '\n');
    const b = r.body ?? {};
    products.push({
      ...s,
      httpStatus: r.status,
      sourceTitle: b.title ?? null,
      status: b.status ?? null,
      productUrl: b.productUrl ?? null,
      destinations: b.destinations ?? null,
      itineraryType: b.itinerary?.itineraryType ?? null,
      itinerary: b.itinerary ?? null,
      logistics: b.logistics ?? null,
      productOptions: (b.productOptions ?? []).map((o) => ({
        productOptionCode: o.productOptionCode,
        title: o.title,
        description: o.description,
      })),
    });
  }
  write('products.json', products);

  // Step 6 — collect every location ref and resolve via /locations/bulk.
  const refs = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'ref' && typeof v === 'string' && v.startsWith('LOC-')) refs.add(v);
        else walk(v);
      }
    }
  };
  products.forEach((p) => {
    walk(p.itinerary);
    walk(p.logistics);
  });
  const refList = [...refs].sort();
  const locations = [];
  for (let i = 0; i < refList.length; i += 500) {
    const batch = refList.slice(i, i + 500);
    const r = await call('POST', '/locations/bulk', { locations: batch }, `locations-bulk-${crypto.createHash('sha1').update(batch.join(',')).digest('hex').slice(0, 12)}`);
    locations.push(...(r.body?.locations ?? []));
  }
  write('locations.json', { requestedRefs: refList, resolved: locations });

  write('run-manifest.json', {
    spike: 'rw4-viator-structured-itinerary-2026-10-01',
    baseUrl: BASE,
    environment: BASE.includes('sandbox') ? 'SANDBOX Partner API (sandbox affiliate key)' : 'LIVE production Partner API (affiliate key)',
    credentialSource: 'process.env.VIATOR_API_KEY (value never persisted)',
    acceptHeader: 'application/json;version=2.0',
    accessCheck: { endpoint: 'GET /destinations', status: dest.status, destinationCount: allDest.length },
    queries: QUERIES,
    perQueryResults: PER_QUERY_RESULTS,
    samplingRule: `round-robin by rank over queries (depth ${TOP_PER_QUERY}), dedupe by productCode, cap ${SAMPLE_CAP}; content-blind`,
    sampledProductCodes: sample.filter((s) => !s.selectedBy.supplement).map((s) => s.productCode),
    supplementProductCodes: SUPPLEMENT,
    locationRefsRequested: refList.length,
    locationsResolved: locations.length,
    callLog,
  });

  // Sanitization guard: no artifact may contain the key.
  const leaks = [];
  const scan = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) scan(p);
      else if (fs.readFileSync(p, 'utf8').includes(KEY)) leaks.push(p);
    }
  };
  scan(OUT);
  if (leaks.length) {
    console.error(`SANITIZATION FAILURE in ${leaks.length} file(s); deleting them.`);
    leaks.forEach((p) => fs.unlinkSync(p));
    process.exit(3);
  }
  console.log(JSON.stringify({ ok: true, mendoza: { id: mendoza.destinationId, name: mendoza.name, type: mendoza.type }, sampled: sample.length, refs: refList.length, resolved: locations.length, calls: callLog }, null, 1));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
