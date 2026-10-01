#!/usr/bin/env node
/**
 * RW4 Cloudflare Source Content Fidelity Spike (2026-10-01)
 *
 * Tests whether CloudflareWebSourceContentProvider faithfully preserves
 * the structured Uco Valley itinerary on SolSalute:
 * https://solsalute.com/blog/mendoza-argentina-wine-capital/
 *
 * Target invariants:
 *   1. Exactly the target URL without mutation or query params.
 *   2. Executed via CloudflareWebSourceContentProvider with production semantics.
 *   3. Evaluates presence of mandatory stops (Alfa Crux, SuperUco, Bodega Azul),
 *      optional alternatives (Corazon del Sol OR Solo Contigo), times, and headings/lists.
 */

const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://solsalute.com/blog/mendoza-argentina-wine-capital/';
const SPIKE_DIR = __dirname;
const REPO_ROOT = path.resolve(SPIKE_DIR, '../..');

// Load environment from REPO_ROOT/.env
const envFile = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)$/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[match[1]]) {
      process.env[match[1]] = val;
    }
  }
}

// Ensure WEB_SOURCE_CONTENT_PROVIDER is cloudflare
process.env.WEB_SOURCE_CONTENT_PROVIDER = 'cloudflare';

const aiConfig = require(path.join(REPO_ROOT, 'be/dist/src/shared/ai/ai.config')).default;
const { CloudflareWebSourceContentProvider } = require(
  path.join(REPO_ROOT, 'be/dist/src/modules/tours/services/cloudflare-web-source-content.provider'),
);

const config = aiConfig();
const mockAiCache = {
  getCachedResponse: async () => null, // AI_CACHE_MODE=off
  cacheResponse: async () => {},
};

async function main() {
  console.log('=== RW4 Cloudflare Source Fidelity Spike ===');
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Cloudflare Account ID present: ${Boolean(config.webSourceContent?.cloudflare?.accountId)}`);
  console.log(`Cloudflare API Token present: ${Boolean(config.webSourceContent?.cloudflare?.apiToken)}`);
  console.log(`Timeout: ${config.webSourceContent?.cloudflare?.timeoutMs}ms`);

  const provider = new CloudflareWebSourceContentProvider(config, mockAiCache);

  console.log('\nExecuting provider.retrieve({ urls: [TARGET_URL] })...');
  const startTs = Date.now();
  const result = await provider.retrieve({ urls: [TARGET_URL] });
  const totalDurationMs = Date.now() - startTs;

  console.log(`Retrieved in ${totalDurationMs}ms (reported total: ${result.totalDurationMs}ms)`);
  console.log(`Items count: ${result.items.length}`);

  const item = result.items[0];
  if (!item) {
    throw new Error('No result item returned from provider');
  }

  console.log(`Item status: ${item.status}`);
  if (item.status !== 'retrieved') {
    console.error(`Failure reason: ${item.failureReason}`);
    console.error(`Failure detail: ${item.failureDetail}`);
  }

  const content = item.content || '';
  const contentChars = content.length;
  console.log(`Content chars: ${contentChars}`);

  // Save raw output
  fs.writeFileSync(path.join(SPIKE_DIR, 'output.md'), content, 'utf8');
  fs.writeFileSync(
    path.join(SPIKE_DIR, 'result.json'),
    JSON.stringify(
      {
        targetUrl: TARGET_URL,
        totalDurationMs,
        provider: result.provider,
        item: {
          requestedUrl: item.requestedUrl,
          status: item.status,
          failureReason: item.failureReason,
          failureDetail: item.failureDetail,
          durationMs: item.durationMs,
          contentType: item.contentType,
          contentChars,
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  // Deterministic checks
  const checks = {
    alfaCrux: /Alfa\s*Crux/i.test(content),
    superUco: /Super\s*Uco/i.test(content),
    bodegaAzul: /Bodega\s*Azul/i.test(content),
    corazonDelSol: /Coraz[oó]n\s*del\s*Sol/i.test(content),
    soloContigo: /Solo\s*Contigo/i.test(content),
    time10am: /10\s*(?:am|a\.m\.)/i.test(content),
    time12pm: /12\s*(?:pm|p\.m\.)/i.test(content),
    time230pm: /2:30\s*(?:pm|p\.m\.)/i.test(content),
    ucoItineraryHeading: /Uco\s*Valley\s*Itinerary/i.test(content),
    optionalBonusText: /Optional\s*Bonus\s*Tasting/i.test(content) || /or\s*Solo\s*Contigo/i.test(content),
    orderedListSemantics: /1\.\s+.*Alfa\s*Crux/i.test(content) || /1\.\s+.*Crux/i.test(content) || /\b1[\.\)]\s+.*Alfa/i.test(content),
  };

  console.log('\n--- Deterministic Content Checks ---');
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${k}: ${v ? 'PASS' : 'FAIL'}`);
  }

  // Extract excerpt around Uco Valley Itinerary if present
  let ucoExcerpt = '';
  const ucoMatch = content.match(/Uco\s*Valley\s*Itinerary/i);
  if (ucoMatch && ucoMatch.index !== undefined) {
    const start = Math.max(0, ucoMatch.index - 100);
    const end = Math.min(content.length, ucoMatch.index + 2000);
    ucoExcerpt = content.slice(start, end);
    fs.writeFileSync(path.join(SPIKE_DIR, 'uco-itinerary-excerpt.md'), ucoExcerpt, 'utf8');
    console.log('\n--- Uco Valley Itinerary Excerpt ---');
    console.log(ucoExcerpt);
  } else {
    console.log('\n--- Uco Valley Itinerary heading NOT found! ---');
  }

  const mandatoryPresent = checks.alfaCrux && checks.superUco && checks.bodegaAzul;
  const optionalPresent = checks.corazonDelSol || checks.soloContigo;
  const timingPresent = checks.time10am && checks.time12pm && checks.time230pm;

  const fidelityPass = item.status === 'retrieved' && mandatoryPresent && optionalPresent;

  const analysis = {
    targetUrl: TARGET_URL,
    provider: 'cloudflare',
    status: item.status,
    durationMs: item.durationMs,
    contentChars,
    checks,
    mandatoryPresent,
    optionalPresent,
    timingPresent,
    fidelityVerdict: fidelityPass ? 'PASS' : 'FAIL',
  };

  fs.writeFileSync(path.join(SPIKE_DIR, 'analysis.json'), JSON.stringify(analysis, null, 2), 'utf8');

  console.log(`\n========================================`);
  console.log(`CLOUDFLARE FIDELITY = ${fidelityPass ? 'PASS' : 'FAIL'}`);
  console.log(`========================================`);

  if (!fidelityPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Spike error:', err);
  process.exit(1);
});
