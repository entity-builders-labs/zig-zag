// RW4-EXTRACT-COMPLETENESS-1 extractor replay (live extractor, no DB, no
// resolver). Calls the REAL discovery extractor provider from be/dist on
// fixed inputs reconstructed from the recorded C3 COLD trace, N times each,
// and scores every emitted candidate against the frozen oracle.
//
//   EXTRACTOR=cloudflare|gemini RUNS=2 INPUTS=SOB_W3,SOB_UNIT LABEL=baseline \
//     node spikes/rw4-extract-completeness-2026-10-05/replay-extract.cjs
//
// Run from the repo root after `cd be && yarn build`, with .env sourced.
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const DIST = path.join(REPO, 'be/dist/src');
const CAMPAIGN = path.join(HERE, '../rw4-functional-composite-campaign-2026-10-05');

process.env.DISCOVERY_EXTRACTOR_PROVIDER = process.env.EXTRACTOR || 'cloudflare';
process.env.CLOUDFLARE_DISCOVERY_MODEL ||= '@cf/qwen/qwen3.8-27b';
process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS ||= '60000';
process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS ||= '4096';
process.env.AI_CACHE_MODE = 'off';

const aiConfig = require(`${DIST}/shared/ai/ai.config`).default;
const { CloudflareDiscoveryProvider } = require(`${DIST}/modules/tours/services/cloudflare-discovery.provider`);
const { GeminiDiscoveryProvider } = require(`${DIST}/modules/tours/services/gemini-discovery.provider`);
const { GroqDiscoveryProvider } = require(`${DIST}/modules/tours/services/groq-discovery.provider`);
const { LangChainService } = require(`${DIST}/shared/ai/langchain.service`);
const { OllamaDiscoveryProvider } = require(`${DIST}/modules/tours/services/ollama-discovery.provider`);
const windowing = require(`${DIST}/modules/tours/utils/source-content-windowing.util`);

// Transport capture (spike only): the providers do not surface finish
// reason, token usage or the effective request settings, so record them
// from the wire. Production code is not touched.
const transport = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const entry = { url: String(url).replace(/accounts\/[^/]+/, 'accounts/<id>').replace(/([?&]key=)[^&]+/, '$1<redacted>') };
  try {
    const body = JSON.parse(init?.body ?? '{}');
    entry.request = {
      model: body.model,
      temperature: body.temperature ?? body.generationConfig?.temperature ?? null,
      maxCompletionTokens: body.max_completion_tokens ?? body.max_tokens ?? body.generationConfig?.maxOutputTokens ?? null,
      chatTemplateKwargs: body.chat_template_kwargs ?? null,
      responseFormat: body.response_format?.type ?? body.generationConfig?.responseMimeType ?? null,
    };
  } catch {}
  transport.push(entry);
  const resp = await realFetch(url, init);
  entry.status = resp.status;
  try {
    const data = await resp.clone().json();
    const choice = data.choices?.[0];
    entry.finishReason = choice?.finish_reason ?? data.candidates?.[0]?.finishReason ?? null;
    entry.usage = data.usage ?? data.usageMetadata ?? null;
    entry.rawContent = choice?.message?.content ?? data.candidates?.[0]?.content?.parts?.map((x) => x.text).join('') ?? null;
    entry.reasoningChars = typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning.length : choice?.message?.reasoning_content?.length ?? 0;
  } catch {}
  return resp;
};

const oracle = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle.json'), 'utf8'));
const trace = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, 'c3-cold/generation-trace.json'), 'utf8'));
const request = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, 'requests/c3-buenos-aires-san-telmo-self-guided.json'), 'utf8'));
const fixture = (id) => fs.readFileSync(path.join(HERE, oracle.sources[id].fixture), 'utf8');

const SOB = 'https://secretsofbuenosaires.com/day-1-self-guided-walking-tour-in-buenos-aires/';
const AG = 'http://www.agusyornet.com/2020/03/self-guided-walking-tour-san-telmo.html';

function pass(name) {
  const step = (n) => trace.steps.find((s) => s.name === n && String(s.parentId ?? s.id).includes(name));
  const p = trace.steps.find((s) => s.name === 'acquisition.pass' && s.id.includes(name));
  const search = step('acquisition.web_search');
  return {
    evidence: search.facts.groundedEvidence,
    request: {
      scope: { destinationName: 'Buenos Aires' },
      requestedThemes: p.facts.requestedThemes ?? [],
      requestedIntents: p.facts.requestedIntents ?? [],
      semanticQuery: request.intent.additionalPreferences,
      ...(p.facts.anchorNames?.length ? { anchorNames: p.facts.anchorNames } : {}),
      coverageGaps: [],
      maxCandidates: 8,
      evidenceRequirements: p.facts.evidenceRequirements ?? ['MULTI_COMPONENT_EXPERIENCE'],
    },
  };
}
function recordedWindow(passName, url, ordinal) {
  const s = trace.steps.find(
    (x) =>
      x.name === 'acquisition.deep_source_window' &&
      x.parentId.includes(passName) &&
      x.facts.sourceUrl === url &&
      x.facts.windowing.windowOrdinal === ordinal,
  );
  return s.facts.content;
}
// The section-complete unit as the production windowing policy now emits it
// for this source (falls back to the oracle's frozen offsets on a build that
// has no unit window).
function unitWindow(id, url, passName) {
  const p = pass(passName);
  const same = p.evidence.filter((e) => e.url === url);
  const ctx = {
    titles: same.map((e) => e.title).filter(Boolean),
    snippets: same.map((e) => e.snippet).filter(Boolean),
    queries: [p.request.semanticQuery],
  };
  const { DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS, DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS } = require(`${DIST}/modules/tours/interfaces/web-source-content.interface`);
  if (DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS) {
    const [first] = windowing.windowSourceContentSequence(fixture(id), ctx, DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS, DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS);
    if (first.audit.selectionStrategy !== 'SECTION_UNIT' || !first.audit.sectionComplete) throw new Error(`${id}: window 1 is not a complete unit`);
    return first.content;
  }
  const [start, end] = oracle.sources[id].unit.match(/(\d+)–(\d+)/).slice(1).map(Number);
  return fixture(id).slice(start, end);
}

const INPUTS = {
  SOB_W1: { source: 'secretsofbuenosaires-day1', url: SOB, pass: 'planner_capacity', content: () => recordedWindow('planner_capacity', SOB, 1) },
  SOB_W3: { source: 'secretsofbuenosaires-day1', url: SOB, pass: 'planner_capacity', content: () => recordedWindow('planner_capacity', SOB, 3) },
  SOB_UNIT: { source: 'secretsofbuenosaires-day1', url: SOB, pass: 'planner_capacity', content: () => unitWindow('secretsofbuenosaires-day1', SOB, 'planner_capacity') },
  AG_ARW_W1: { source: 'agusyornet-san-telmo', url: AG, pass: 'area_route_walk', content: () => recordedWindow('area_route_walk', AG, 1) },
  AG_PC_W1: { source: 'agusyornet-san-telmo', url: AG, pass: 'planner_capacity', content: () => recordedWindow('planner_capacity', AG, 1) },
  AG_UNIT: { source: 'agusyornet-san-telmo', url: AG, pass: 'planner_capacity', content: () => unitWindow('agusyornet-san-telmo', AG, 'planner_capacity') },
};

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bare = (s) => fold(s).replace(/^(the|el|la|los|las) /, '');
const matches = (item, label) => !!label && [item.name, ...(item.aliases ?? [])].some((n) => bare(n) === bare(label));

function inSource(sourceId, h) {
  const text = fold(fixture(sourceId));
  return [h.name, h.sourceName].some((n) => n && text.includes(fold(n)));
}
function score(sourceId, candidates) {
  const segments = oracle.sources[sourceId].segments;
  const items = segments.flatMap((seg) => seg.orderGroups.flatMap((g, gi) => g.map((item) => ({ ...item, segment: seg.id, group: gi }))));
  return candidates.map((c) => {
    const hints = c.componentHints.map((h) => {
      const item = items.find((i) => matches(i, h.name) || matches(i, h.sourceName));
      return { name: h.name, sourceName: h.sourceName, role: h.role, item: item?.name ?? null, oracleRole: item?.role ?? 'NOT_IN_ORACLE', segment: item?.segment ?? null, group: item?.group ?? null };
    });
    const segIds = [...new Set(hints.map((h) => h.segment).filter(Boolean))];
    const perSegment = segIds.map((segId) => {
      const mandatory = items.filter((i) => i.segment === segId && i.role === 'MANDATORY');
      const present = mandatory.filter((m) => hints.some((h) => h.item === m.name));
      const groups = hints.filter((h) => h.segment === segId).map((h) => h.group);
      const ordered = groups.every((g, i) => i === 0 || g >= groups[i - 1]);
      return { segment: segId, mandatoryRecall: `${present.length}/${mandatory.length}`, missingMandatory: mandatory.filter((m) => !present.includes(m)).map((m) => m.name), ordered };
    });
    return {
      candidate: c.name,
      orderedByEvidence: c.orderedByEvidence,
      hints: hints.map((h) => `${h.name}${h.item && h.item !== h.name ? `=${h.item}` : ''}[${h.oracleRole}]`),
      segmentsMixed: segIds.length > 1,
      perSegment,
      // A hint the oracle does not classify is an INVENTION only when the
      // source text does not name it at all; otherwise it is an unclassified
      // passing mention (reported, never counted as recall).
      notInOracle: hints.filter((h) => h.oracleRole === 'NOT_IN_ORACLE').map((h) => `${h.name}${inSource(sourceId, h) ? '' : '(INVENTED?)'}`),
      alternatives: hints.filter((h) => h.oracleRole === 'ALTERNATIVE').map((h) => h.name),
      // MANDATORY stops of a segment other than the one this candidate
      // mostly covers (segment mixing across a motorized transfer).
      mandatoryFromOtherSegment: (() => {
        const counts = {};
        for (const h of hints) if (h.segment) counts[h.segment] = (counts[h.segment] ?? 0) + 1;
        const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
        return hints.filter((h) => h.segment && h.segment !== main && h.oracleRole === 'MANDATORY').map((h) => h.name);
      })(),
    };
  });
}

// The brief's per-segment acceptance: one emitted, VALIDATED candidate holds
// every MANDATORY stop of the segment, in source order, with no MANDATORY
// stop of another segment, no ALTERNATIVE, no invented component, and no
// validation rejection.
function segmentVerdicts(sourceId, scoredValid, scoredRaw, validationErrors) {
  return oracle.sources[sourceId].segments.map((seg) => {
    const owner = scoredValid.find((s) => s.perSegment.some((p) => p.segment === seg.id));
    const rawOwner = scoredRaw.find((s) => s.perSegment.some((p) => p.segment === seg.id));
    const reasons = [];
    if (!owner) reasons.push(rawOwner ? 'PROPOSED_BUT_REJECTED_BY_VALIDATION' : 'SEGMENT_NOT_EMITTED');
    const s = owner ?? rawOwner;
    const p = s?.perSegment.find((x) => x.segment === seg.id);
    if (p?.missingMandatory.length) reasons.push(`MISSING_MANDATORY:${p.missingMandatory.join('|')}`);
    if (p && !p.ordered) reasons.push('ORDER_VIOLATED');
    if (s?.mandatoryFromOtherSegment.length) reasons.push(`SEGMENT_MIXED:${s.mandatoryFromOtherSegment.join('|')}`);
    if (s?.alternatives.length) reasons.push(`ALTERNATIVE_FLATTENED:${s.alternatives.join('|')}`);
    if (s?.notInOracle.some((n) => n.endsWith('(INVENTED?)'))) reasons.push('INVENTED_COMPONENT');
    return {
      segment: seg.id,
      success: reasons.length === 0,
      mandatoryRecall: p?.mandatoryRecall ?? `0/${seg.orderGroups.flat().filter((i) => i.role === 'MANDATORY').length}`,
      reasons,
      emittedPassBy: s ? s.hints.filter((h) => h.includes('[ACCEPTABLE]')) : [],
    };
  });
}
const INVALID = /HTTP (429|5\d\d)|fetch failed|TimeoutError|aborted|ECONNRESET|Request too large|\b413\b/i;

async function main() {
  const config = aiConfig();
  // No-op cache: every replay call is a real provider call.
  const noCache = { getCachedResponse: async () => null, cacheResponse: async () => undefined };
  const name = process.env.DISCOVERY_EXTRACTOR_PROVIDER;
  const provider =
    name === 'gemini'
      ? new GeminiDiscoveryProvider(config)
      : name === 'ollama'
        ? new OllamaDiscoveryProvider(config)
        : name === 'groq'
        ? new GroqDiscoveryProvider(new LangChainService(config, noCache), config)
        : new CloudflareDiscoveryProvider(config);
  const runs = Number(process.env.RUNS || 2);
  const selected = (process.env.INPUTS || Object.keys(INPUTS).join(',')).split(',');
  const label = process.env.LABEL || 'run';
  const outDir = path.join(HERE, 'replays', `${label}-${process.env.DISCOVERY_EXTRACTOR_PROVIDER}`);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const inputId of selected) {
    const input = INPUTS[inputId];
    const p = pass(input.pass);
    const content = input.content();
    const evidence = p.evidence.map((e) => (e.url === input.url ? { ...e, snippet: content, evidenceQuality: 'original_content' } : e));
    for (let r = 1; r <= runs; r++) {
      const started = Date.now();
      const t0 = transport.length;
      let out;
      try {
        out = await provider.extractExperiences(p.request, { provider: 'replay', evidence, groundingStatus: 'applied' });
      } catch (error) {
        out = { candidates: [], extractionFailures: [`THROWN: ${error.name}: ${error.message}`], rawOutput: '' };
      }
      const targetKey = evidence.find((e) => e.url === input.url).key;
      const fromTarget = (out.candidates ?? []).filter((c) => (c.evidenceKeys ?? []).includes(targetKey) || c.componentHints.some((h) => (h.evidenceKeys ?? []).includes(targetKey)));
      const failureText = (out.extractionFailures ?? []).join(' ');
      const invalid = INVALID.test(failureText);
      let rawCandidates = [];
      try {
        const parsed = JSON.parse(String(out.rawOutput ?? ''));
        rawCandidates = (Array.isArray(parsed) ? parsed : parsed.candidates ?? []).filter((c) => Array.isArray(c.componentHints));
      } catch {}
      const rawFromTarget = rawCandidates.filter((c) => (c.evidenceKeys ?? []).includes(targetKey) || c.componentHints.some((h) => (h.evidenceKeys ?? []).includes(targetKey)));
      const scoredValid = score(input.source, fromTarget);
      const scoredRaw = score(input.source, rawFromTarget);
      const wire = transport.slice(t0).map(({ rawContent, ...rest }) => rest);
      const row = {
        input: inputId,
        run: r,
        validity: invalid ? 'INVALID_RUN' : 'VALID',
        wire,
        rawCandidateCount: rawCandidates.length,
        normalizationViolations: (out.validationErrors ?? []).flatMap((e) => e.match(/component \d+ \([^)]*\) unsupported: (MISSING|INVALID)_NORMALIZATION_KIND/g) ?? []),
        segmentVerdicts: invalid ? null : segmentVerdicts(input.source, scoredValid, scoredRaw, out.validationErrors ?? []),
        rawScored: scoredRaw,
        provider: out.provider,
        model: out.model,
        ms: Date.now() - started,
        inputChars: content.length,
        failures: out.extractionFailures ?? [],
        validationErrors: out.validationErrors ?? [],
        candidatesTotal: (out.candidates ?? []).length,
        scored: scoredValid,
      };
      results.push(row);
      fs.writeFileSync(path.join(outDir, `${inputId}-${r}.raw.txt`), String(out.rawOutput ?? ''));
      fs.writeFileSync(path.join(outDir, `${inputId}-${r}.wire.json`), JSON.stringify(transport.slice(t0), null, 2) + '\n');
      console.log(JSON.stringify({ input: inputId, run: r, validity: row.validity, wire: wire.map((w) => ({ s: w.status, f: w.finishReason, u: w.usage })), verdicts: row.segmentVerdicts }));
      if (false) console.log(JSON.stringify({ input: inputId, run: r, ms: row.ms, failures: row.failures, scored: row.scored.map((s) => ({ c: s.candidate, seg: s.perSegment, mixed: s.segmentsMixed, notInOracle: s.notInOracle, alt: s.alternatives, hints: s.hints })) }));
    }
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
