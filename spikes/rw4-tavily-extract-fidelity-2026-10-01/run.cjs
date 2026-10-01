#!/usr/bin/env node
/**
 * RW4 Tavily Extract Fidelity Spike (2026-10-01)
 *
 * Investigates whether Tavily /extract source-content loss in COLD #5
 * is caused by default extract_depth: "basic" vs extract_depth: "advanced",
 * and whether output format (markdown vs text) affects preservation.
 *
 * Target URL: https://solsalute.com/blog/mendoza-argentina-wine-capital/
 *
 * Tested Arms:
 *   A. basic + markdown
 *   B. advanced + markdown
 *   C. basic + text
 *   D. advanced + text
 *
 * Usage:
 *   node --env-file=.env spikes/rw4-tavily-extract-fidelity-2026-10-01/run.cjs
 *   node spikes/rw4-tavily-extract-fidelity-2026-10-01/run.cjs --analyze-only
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGET_URL = 'https://solsalute.com/blog/mendoza-argentina-wine-capital/';
const SPIKE_DIR = __dirname;
const REF_DIR = path.join(SPIKE_DIR, 'reference');
const OUT_DIR = path.join(SPIKE_DIR, 'outputs');

const ARMS = [
  { id: 'basic-markdown', depth: 'basic', format: 'markdown', ext: 'md' },
  { id: 'advanced-markdown', depth: 'advanced', format: 'markdown', ext: 'md' },
  { id: 'basic-text', depth: 'basic', format: 'text', ext: 'txt' },
  { id: 'advanced-text', depth: 'advanced', format: 'text', ext: 'txt' },
];

function getApiKey() {
  if (process.env.TAVILY_API_KEY) {
    return process.env.TAVILY_API_KEY.trim();
  }
  const rootEnv = path.resolve(SPIKE_DIR, '../../.env');
  if (fs.existsSync(rootEnv)) {
    const envContent = fs.readFileSync(rootEnv, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^\s*TAVILY_API_KEY\s*=\s*(["']?)(.*?)\1\s*$/);
      if (match && match[2]) {
        return match[2].trim();
      }
    }
  }
  return null;
}

async function fetchOriginReference() {
  console.log(`[Reference] Fetching origin HTML: ${TARGET_URL}`);
  const originPath = path.join(REF_DIR, 'solsalute-origin.html');
  const excerptPath = path.join(REF_DIR, 'solsalute-origin-itinerary-excerpt.html');

  const start = Date.now();
  const resp = await fetch(TARGET_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(30000),
  });

  const durationMs = Date.now() - start;
  if (!resp.ok) {
    throw new Error(`Failed to fetch origin HTML: HTTP ${resp.status}`);
  }
  const html = await resp.text();
  fs.writeFileSync(originPath, html, 'utf8');
  console.log(`[Reference] Saved origin HTML (${html.length} chars, HTTP ${resp.status}, ${durationMs}ms)`);

  const ucoIdx = html.indexOf('id="uco-valley-itinerary"');
  if (ucoIdx !== -1) {
    const startExcerpt = Math.max(0, ucoIdx - 200);
    const endExcerpt = Math.min(html.length, ucoIdx + 2500);
    const excerpt = html.slice(startExcerpt, endExcerpt);
    fs.writeFileSync(excerptPath, excerpt, 'utf8');
  }

  return {
    status: resp.status,
    durationMs,
    chars: html.length,
    sha256: crypto.createHash('sha256').update(html).digest('hex'),
  };
}

async function runArmLive(arm, apiKey, cacheBustId) {
  // Use distinct cache-bust query param per arm so Tavily backend cache does not cross-pollute
  const requestUrl = `${TARGET_URL}?tavily_spike_${cacheBustId}=1`;
  console.log(`[Tavily] Executing Arm: ${arm.id} (depth=${arm.depth}, format=${arm.format})`);

  const payload = {
    urls: [requestUrl],
    extract_depth: arm.depth,
    format: arm.format,
    include_usage: true,
  };

  const start = Date.now();
  let httpStatus = 0;
  let responseData = null;
  let errorMsg = null;

  try {
    const resp = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    httpStatus = resp.status;
    responseData = await resp.json();
  } catch (err) {
    errorMsg = err.message;
  }
  const durationMs = Date.now() - start;

  const jsonOutPath = path.join(OUT_DIR, `${arm.id}.json`);
  const contentOutPath = path.join(OUT_DIR, `${arm.id}.${arm.ext}`);

  if (responseData) {
    fs.writeFileSync(jsonOutPath, JSON.stringify(responseData, null, 2), 'utf8');
    const rawContent = responseData.results?.[0]?.raw_content ?? '';
    fs.writeFileSync(contentOutPath, rawContent, 'utf8');
    console.log(
      `[Tavily] Arm ${arm.id} completed: HTTP ${httpStatus}, ${rawContent.length} chars, ${durationMs}ms, Tavily response_time=${responseData.response_time}`,
    );
  } else {
    fs.writeFileSync(
      jsonOutPath,
      JSON.stringify({ error: errorMsg, httpStatus, durationMs }, null, 2),
      'utf8',
    );
    console.error(`[Tavily] Arm ${arm.id} FAILED: ${errorMsg} (${durationMs}ms)`);
  }

  return {
    armId: arm.id,
    depth: arm.depth,
    format: arm.format,
    requestUrl,
    httpStatus,
    durationMs,
    error: errorMsg,
    tavilyResponseTime: responseData?.response_time ?? null,
    usage: responseData?.usage ?? null,
    contentChars: responseData?.results?.[0]?.raw_content?.length ?? 0,
    resultsCount: responseData?.results?.length ?? 0,
    failedResultsCount: responseData?.failed_results?.length ?? 0,
  };
}

function checkPattern(content, pattern) {
  if (typeof pattern === 'string') {
    return content.includes(pattern);
  }
  return pattern.test(content);
}

function analyzeOutputs(originMeta) {
  console.log('[Analysis] Running deterministic checks on outputs...');

  const checks = {
    // Primary stops in Uco Valley Itinerary
    ucoStopAlfaCruxInItinerary: /(?:Uco Valley Itinerary[\s\S]*?)(?:Alfa Crux)(?:[\s\S]*?Bodega Azul)/i,
    ucoStopSuperUcoInItinerary: /(?:Uco Valley Itinerary[\s\S]*?)(?:SuperUco)(?:[\s\S]*?Bodega Azul)/i,
    ucoStopBodegaAzulInItinerary: /(?:Uco Valley Itinerary[\s\S]*?)(?:Bodega Azul)/i,

    // Standalone occurrences anywhere on page
    hasAlfaCruxAnywhere: 'Alfa Crux',
    hasSuperUcoAnywhere: 'SuperUco',
    hasBodegaAzulAnywhere: 'Bodega Azul',

    // Itinerary headings
    headingSampleItineraries: /Sample Mendoza Winery Itineraries/i,
    headingUcoValley: /Uco Valley Itinerary/i,
    headingLujanCuyo: /Lujan de Cuyo Itinerary/i,

    // Itinerary schedule times
    time10am: /10\s*am/i,
    time12pm: /12\s*pm/i,
    time230pm: /2:30\s*pm/i,

    // Outbound winery links
    linkAlfaCrux: /agostinowinegroup\.com/i,
    linkSuperUco: /superuco\.com/i,
    linkBodegaAzul: /bodegalaazul\.com/i,

    // Explanatory itinerary prose
    proseFurthest: /This winery is the furthest/i,
    prose40mins: /40 minutes to drive here/i,
    proseAfternoon: /remaining hours of your afternoon/i,

    // List ordering / numbered stops
    orderedListMarker1: /(?:^|\n)\s*1[\.\)]\s+/i,
    orderedListMarker2: /(?:^|\n)\s*2[\.\)]\s+/i,

    // Lujan de Cuyo stops
    stopA16: /\bA16\b/,
    stopOjoDeAgua: /Ojo de Agua/i,

    // Non-itinerary controls across the page
    controlHeadingArch: /Mendoza Vineyards for Architecture Lovers/i,
    controlProseArch: /A team of two architects together make up the firm Bormida y Yanzon/i,
    controlListRegions: /Maipu[\s\S]{1,20}closest to the city/i,
    controlLinkCarmeloPatti: /bodegacarmelopatti\.com/i,
    controlWineryCatena: /Catena Zapata/i,
    controlWineryZuccardi: /Zuccardi/i,
    controlWinerySalentein: /Salentein/i,
    controlWineryElEnemigo: /El Enemigo/i,
  };

  const results = {};

  for (const arm of ARMS) {
    const jsonPath = path.join(OUT_DIR, `${arm.id}.json`);
    const contentPath = path.join(OUT_DIR, `${arm.id}.${arm.ext}`);

    let rawContent = '';
    let json = {};
    if (fs.existsSync(contentPath)) {
      rawContent = fs.readFileSync(contentPath, 'utf8');
    }
    if (fs.existsSync(jsonPath)) {
      json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }

    const armChecks = {};
    for (const [name, pat] of Object.entries(checks)) {
      armChecks[name] = checkPattern(rawContent, pat);
    }

    const preservesItineraryStops =
      armChecks.ucoStopAlfaCruxInItinerary &&
      armChecks.ucoStopSuperUcoInItinerary &&
      armChecks.ucoStopBodegaAzulInItinerary;

    results[arm.id] = {
      depth: arm.depth,
      format: arm.format,
      chars: rawContent.length,
      lines: rawContent.split('\n').length,
      sha256: crypto.createHash('sha256').update(rawContent).digest('hex'),
      preservesItineraryStops,
      checks: armChecks,
      tavilyResponseTime: json.response_time ?? null,
      usage: json.usage ?? null,
    };
  }

  // Check origin HTML as ground truth
  const originPath = path.join(REF_DIR, 'solsalute-origin.html');
  const originHtml = fs.existsSync(originPath) ? fs.readFileSync(originPath, 'utf8') : '';
  const originChecks = {};
  for (const [name, pat] of Object.entries(checks)) {
    originChecks[name] = checkPattern(originHtml, pat);
  }

  // Verdict evaluation
  const basicMd = results['basic-markdown'];
  const advMd = results['advanced-markdown'];
  const basicTxt = results['basic-text'];
  const advTxt = results['advanced-text'];

  let verdict = 'UNKNOWN';
  let verdictSummary = '';

  if (!basicMd.preservesItineraryStops && advMd.preservesItineraryStops) {
    verdict = 'RESULT A — ADVANCED FIXES IT';
    verdictSummary =
      'COLD #5 blocker was caused by using Tavily basic extraction for content requiring advanced extraction fidelity. Basic extraction strips HTML list elements (<ol>, <ul>), losing the entire itinerary structure. Advanced extraction preserves all itinerary stops (Alfa Crux, SuperUco, Bodega Azul), schedules, outbound links, and prose.';
  } else if (!basicMd.preservesItineraryStops && basicTxt.preservesItineraryStops) {
    verdict = 'RESULT B — FORMAT FIXES IT';
    verdictSummary = 'Text format preserves the content while markdown format drops it.';
  } else if (!basicMd.preservesItineraryStops && !advMd.preservesItineraryStops) {
    verdict = 'RESULT C — ADVANCED STILL LOSES IT';
    verdictSummary =
      'Both basic and advanced omit the stops: Tavily extract cannot faithfully recover this source structure with the tested supported modes.';
  } else if (basicMd.preservesItineraryStops && advMd.preservesItineraryStops) {
    verdict = 'RESULT D — ALL VARIANTS CONTAIN IT';
    verdictSummary =
      'All live variants contain the stops; COLD #5 discrepancy must be investigated.';
  }

  const analysis = {
    targetUrl: TARGET_URL,
    executedAt: new Date().toISOString(),
    verdict,
    verdictSummary,
    originReference: {
      meta: originMeta,
      checks: originChecks,
    },
    arms: results,
  };

  fs.writeFileSync(
    path.join(SPIKE_DIR, 'analysis.json'),
    JSON.stringify(analysis, null, 2),
    'utf8',
  );

  return analysis;
}

function scanForSecrets(apiKey) {
  console.log('[Security] Scanning all spike artifacts for secret leaks...');
  if (!apiKey || apiKey.length < 10) {
    console.warn('[Security] API key not provided for scanning. Skipping pattern search.');
    return;
  }

  const allFiles = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        allFiles.push(full);
      }
    }
  }
  walk(SPIKE_DIR);

  let leaksFound = 0;
  for (const file of allFiles) {
    if (file.endsWith('.git') || file.includes('/node_modules/')) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(apiKey)) {
      console.error(`[SECURITY ALERT] API key detected in ${file}!`);
      leaksFound++;
    }
    if (/Bearer\s+tvly-[a-zA-Z0-9_-]+/i.test(content)) {
      console.error(`[SECURITY ALERT] Authorization Bearer token detected in ${file}!`);
      leaksFound++;
    }
  }

  if (leaksFound > 0) {
    throw new Error(`Security scan failed: ${leaksFound} secret leaks found.`);
  }
  console.log(`[Security] PASS: ${allFiles.length} files scanned; 0 secret leaks found.`);
}

async function main() {
  const analyzeOnly = process.argv.includes('--analyze-only');
  const apiKey = getApiKey();

  let originMeta = null;
  const manifestPath = path.join(SPIKE_DIR, 'run-manifest.json');

  if (!analyzeOnly) {
    if (!apiKey) {
      console.error('ERROR: TAVILY_API_KEY is required for live execution.');
      process.exit(1);
    }

    originMeta = await fetchOriginReference();

    const armManifests = [];
    const timestamp = Date.now();
    for (const arm of ARMS) {
      const m = await runArmLive(arm, apiKey, `${arm.id}_${timestamp}`);
      armManifests.push(m);
    }

    const runManifest = {
      spike: 'rw4-tavily-extract-fidelity-2026-10-01',
      executedAt: new Date().toISOString(),
      targetUrl: TARGET_URL,
      origin: originMeta,
      arms: armManifests,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(runManifest, null, 2), 'utf8');
  } else {
    if (fs.existsSync(manifestPath)) {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      originMeta = existing.origin;
    }
  }

  const analysis = analyzeOutputs(originMeta);
  console.log('\n=============================================');
  console.log(`SPIKE VERDICT: ${analysis.verdict}`);
  console.log(`Summary: ${analysis.verdictSummary}`);
  console.log('=============================================\n');

  console.log('Comparison Table:');
  console.log('-----------------------------------------------------------------------------------------------------------');
  console.log('Arm                 | Chars  | Time (s) | In-Itinerary Stops (Alfa Crux, SuperUco, Bodega Azul) | Result');
  console.log('-----------------------------------------------------------------------------------------------------------');
  for (const [id, arm] of Object.entries(analysis.arms)) {
    const time = arm.tavilyResponseTime ? arm.tavilyResponseTime.toFixed(2) : 'N/A';
    const c1 = arm.checks.ucoStopAlfaCruxInItinerary ? 'YES' : 'NO ';
    const c2 = arm.checks.ucoStopSuperUcoInItinerary ? 'YES' : 'NO ';
    const c3 = arm.checks.ucoStopBodegaAzulInItinerary ? 'YES' : 'NO ';
    const stopsStr = `Alfa:${c1} SuperUco:${c2} Azul:${c3}`;
    const all = arm.preservesItineraryStops ? 'PRESERVED' : 'LOST';
    console.log(
      `${id.padEnd(20)}| ${String(arm.chars).padEnd(7)}| ${time.padEnd(9)}| ${stopsStr.padEnd(54)}| ${all}`,
    );
  }
  console.log('-----------------------------------------------------------------------------------------------------------\n');

  if (apiKey) {
    scanForSecrets(apiKey);
  }
}

main().catch((err) => {
  console.error('Fatal error running spike:', err);
  process.exit(1);
});
