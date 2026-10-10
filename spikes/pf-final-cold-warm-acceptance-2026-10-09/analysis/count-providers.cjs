// Counts outbound provider requests per count-requests.cjs key for one run
// (read-only). Routing = keys mentioning "routing".
//   node count-providers.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const lines = fs
  .readFileSync(path.join(path.resolve(process.argv[2]), 'provider-requests.ndjson'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const counts = {};
for (const r of lines) counts[r.key] = (counts[r.key] || 0) + 1;
const routing = Object.entries(counts)
  .filter(([k]) => /routing/i.test(k))
  .reduce((a, [, n]) => a + n, 0);
console.log(JSON.stringify({ total: lines.length, routing, nonRouting: lines.length - routing, counts }, null, 1));
