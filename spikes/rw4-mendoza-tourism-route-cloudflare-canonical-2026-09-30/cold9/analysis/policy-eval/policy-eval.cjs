// Offline policy evaluation for source-content windowing (RW4 COLD #10 prep).
// Chunking/selection are ported verbatim from production 9692c780; only the
// scoring of chunks varies per policy.
const fs = require('fs');
const ROOT = process.cwd();
const prod = require(ROOT + '/be/dist/src/modules/tours/utils/source-content-windowing.util.js');
const SEP = prod.SOURCE_EXCERPT_SEPARATOR;

const DATA_URI_PATTERN = /data:[a-z0-9.+/-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/gi;
const HEADING_LINE_PATTERN = /^(#{1,6})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/gm;
const PARAGRAPH_BREAK_PATTERN = /\n[ \t]*\n/g;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const HW = 2;
function normalizeToken(token) {
  const t = token.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
function terms(text) {
  const out = new Set();
  for (const m of text.matchAll(TOKEN_PATTERN)) { if (m[0].length < 3) continue; out.add(normalizeToken(m[0])); }
  return out;
}
function splitSections(text) {
  const sections = []; const stack = []; let start = 0; let headings = [];
  for (const m of text.matchAll(HEADING_LINE_PATTERN)) {
    const at = m.index ?? 0;
    if (at > start) sections.push({ start, end: at, headings });
    const level = m[1].length;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title: m[2] });
    headings = stack.map((h) => h.title); start = at;
  }
  if (text.length > start) sections.push({ start, end: text.length, headings });
  return sections;
}
function hardSplit(text, start, end, maxLen) {
  const out = []; let from = start;
  while (end - from > maxLen) {
    const w = text.slice(from, from + maxLen);
    let cut = w.lastIndexOf('\n'); if (cut <= 0) cut = w.search(/\s\S*$/);
    const to = cut > 0 ? from + cut + 1 : from + maxLen; out.push([from, to]); from = to;
  }
  if (end > from) out.push([from, end]);
  return out;
}
function splitChunks(text, sections, maxLen) {
  const chunks = [];
  for (const s of sections) {
    const paragraphs = []; let from = s.start; const body = text.slice(s.start, s.end);
    for (const brk of body.matchAll(PARAGRAPH_BREAK_PATTERN)) {
      const to = s.start + (brk.index ?? 0) + brk[0].length; paragraphs.push(...hardSplit(text, from, to, maxLen)); from = to;
    }
    if (s.end > from) paragraphs.push(...hardSplit(text, from, s.end, maxLen));
    let ps = -1, pe = -1;
    const flush = () => { if (ps >= 0 && text.slice(ps, pe).trim()) chunks.push({ index: chunks.length, start: ps, end: pe, headings: s.headings }); ps = -1; };
    for (const [a, b] of paragraphs) { if (ps >= 0 && b - ps > maxLen) flush(); if (ps < 0) ps = a; pe = b; }
    flush();
  }
  return chunks;
}
// IDF-weighted lexical overlap of chunks with a term set (production formula).
function idfScores(text, chunks, q) {
  const body = chunks.map((c) => terms(text.slice(c.start, c.end)));
  const head = chunks.map((c) => terms(c.headings.join(' ')));
  const df = new Map();
  for (let i = 0; i < chunks.length; i++) for (const t of new Set([...body[i], ...head[i]])) if (q.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = chunks.length;
  return chunks.map((_, i) => { let s = 0; for (const t of q) { const d = df.get(t); if (!d) continue; const idf = Math.log(1 + n / d); if (head[i].has(t)) s += HW * idf; else if (body[i].has(t)) s += idf; } return s; });
}

const POLICIES = {
  'D current (title+snippet+query merged)': (text, chunks, ctx) => {
    const q = terms([...ctx.titles, ...ctx.snippets, ...ctx.queries].join(' '));
    return idfScores(text, chunks, q).map((s) => [s]);
  },
  'A stable only (title+query)': (text, chunks, ctx) => {
    const q = terms([...ctx.titles, ...ctx.queries].join(' '));
    return idfScores(text, chunks, q).map((s) => [s]);
  },
  'B stable primary, snippet tie-break': (text, chunks, ctx) => {
    const st = idfScores(text, chunks, terms([...ctx.titles, ...ctx.queries].join(' ')));
    const sn = idfScores(text, chunks, terms(ctx.snippets.join(' ')));
    return st.map((s, i) => [s, sn[i]]);
  },
  // Snippet bonus normalized to [0,1] of the document's best snippet match,
  // scaled by the weakest positive... no: scaled by a fixed fraction of the
  // best stable score in the document, so it can reorder near-ties only.
  'C stable + snippet bonus <= 25% of top stable': (text, chunks, ctx) => {
    const st = idfScores(text, chunks, terms([...ctx.titles, ...ctx.queries].join(' ')));
    const sn = idfScores(text, chunks, terms(ctx.snippets.join(' ')));
    const maxSt = Math.max(0, ...st), maxSn = Math.max(0, ...sn);
    return st.map((s, i) => [s + (maxSn > 0 ? 0.25 * maxSt * (sn[i] / maxSn) : 0)]);
  },
};

function windowWith(raw, ctx, maxChars, policy) {
  const text = raw.replace(DATA_URI_PATTERN, '');
  if (text.length <= maxChars) return { text, excerpts: [[0, text.length]], content: text, chunks: 1 };
  const chunks = splitChunks(text, splitSections(text), Math.max(1, Math.floor(maxChars / 4)));
  const sc = policy(text, chunks, ctx);
  const cmp = (a, b) => { for (let k = 0; k < sc[a.index].length; k++) { const d = sc[b.index][k] - sc[a.index][k]; if (d) return d; } return a.index - b.index; };
  const ranked = [...chunks].sort(cmp);
  const sel = []; let used = 0;
  for (const c of ranked) { const cost = text.slice(c.start, c.end).trim().length + (sel.length ? SEP.length : 0); if (used + cost > maxChars) continue; sel.push(c); used += cost; }
  sel.sort((a, b) => a.index - b.index);
  const ex = [];
  sel.forEach((c, i) => { const last = ex[ex.length - 1]; if (last && sel[i - 1].index === c.index - 1) last[1] = c.end; else ex.push([c.start, c.end]); });
  for (const e of ex) { const r = text.slice(e[0], e[1]); e[0] += r.length - r.trimStart().length; e[1] -= r.length - r.trimEnd().length; }
  return { text, excerpts: ex, content: ex.map((e) => text.slice(e[0], e[1])).join(SEP), chunks: chunks.length };
}

module.exports = { POLICIES, windowWith, terms };

if (require.main === module) {
  // Sanity: policy D must equal production byte-for-byte on the replay inputs.
  const base = 'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/';
  const src = fs.readFileSync('spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md', 'utf8');
  const ctxs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  for (const c of ctxs) {
    const p = prod.windowSourceContent(src, c, 6000).content;
    const d = windowWith(src, c, 6000, POLICIES['D current (title+snippet+query merged)']).content;
    if (p !== d) { console.error('PORT MISMATCH', c.label); process.exit(1); }
  }
  console.log('port == production on', ctxs.length, 'contexts');
}
