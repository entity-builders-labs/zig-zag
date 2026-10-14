/**
 * G-P7-U.A — PROVENANCE-1 owner rule (2026-10-14), evaluated against the LIVE facet vocabulary.
 *
 * `referenceProvenance` below is a spike-only reference of the owner's deterministic rule. It is
 * NOT production code: it imports the real `INITIAL_DIMENSION_VOCABULARY` / `DIMENSION_KEY_SYNONYMS`
 * so the classification reflects the vocabulary that ships today. The second block characterizes
 * what the live interpreter emits for the same inputs (no provenance; substring evidence check).
 *
 * Run from be/: npx jest -c ../spikes/planner-comparison-2026-10-12/g-p7-u-a/characterization/jest.config.json
 * Writes ../runs/provenance.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DIMENSION_KEY_SYNONYMS,
  INITIAL_DIMENSION_VOCABULARY,
  PreferenceDimension,
  canonicalizeFacetKey,
} from '../../../../be/src/modules/tours/preferences/preference-facet-vocabulary';
import { PreferenceInterpreterService } from '../../../../be/src/modules/tours/services/preference-interpreter.service';

const OUT = path.join(__dirname, '..', 'runs', 'provenance.json');
const results: Record<string, unknown> = {};

type Provenance = 'DIRECT' | 'INFERRED';

// Same normalization as the vocabulary's private normalizeText, plus '_'/'-' as token separators
// so 'day_trip' and 'day trip' compare equal. Spike-only copy.
function norm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Token-bounded phrase containment: 'arte' is in 'quiero arte moderno', not in 'el martes'. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const h = norm(haystack);
  const p = norm(phrase);
  return p.length > 0 && ` ${h} `.includes(` ${p} `);
}

/** The canonical key itself plus the explicit aliases that map to it, in that dimension only. */
function directTerms(dimension: PreferenceDimension, key: string): string[] {
  const aliases = Object.entries(DIMENSION_KEY_SYNONYMS[dimension] ?? {})
    .filter(([, canonical]) => canonical === key)
    .map(([alias]) => alias);
  return [key, ...aliases];
}

function referenceProvenance(input: {
  source: 'wizard' | 'free_text';
  dimension: PreferenceDimension;
  key: string;
  excerpts: string[];
  userText: string;
}): { provenance: Provenance; reason: string } {
  if (input.source === 'wizard') {
    return { provenance: 'DIRECT', reason: 'WIZARD_SELECTION' };
  }
  if ((INITIAL_DIMENSION_VOCABULARY[input.dimension] ?? []).length === 0) {
    return { provenance: 'INFERRED', reason: 'OPEN_DIMENSION_NO_VOCABULARY' };
  }
  const terms = directTerms(input.dimension, input.key);
  for (const excerpt of input.excerpts) {
    if (!containsPhrase(input.userText, excerpt)) {
      continue;
    }
    const term = terms.find((t) => containsPhrase(excerpt, t));
    if (term) {
      return { provenance: 'DIRECT', reason: `VOCABULARY_TERM:${norm(term)}` };
    }
  }
  return {
    provenance: 'INFERRED',
    reason: input.excerpts.some((e) => containsPhrase(input.userText, e))
      ? 'NO_VOCABULARY_TERM_IN_EXCERPT'
      : 'EXCERPT_NOT_TOKEN_BOUNDED_IN_USER_TEXT',
  };
}

const CASES: {
  id: string;
  note: string;
  source: 'wizard' | 'free_text';
  dimension: PreferenceDimension;
  rawKey: string;
  excerpts: string[];
  userText: string;
  expected: Provenance | 'NOT_IN_VOCABULARY';
}[] = [
  { id: 'P1', note: 'owner example', source: 'free_text', dimension: 'theme', rawKey: 'architecture', excerpts: ['me encanta la arquitectura'], userText: 'me encanta la arquitectura', expected: 'DIRECT' },
  { id: 'P2a', note: 'owner example; no modern_art key exists in the vocabulary', source: 'free_text', dimension: 'theme', rawKey: 'modern_art', excerpts: ['arte moderno'], userText: 'quiero arte moderno', expected: 'NOT_IN_VOCABULARY' },
  { id: 'P2b', note: 'nearest canonical key: theme art via alias "arte"', source: 'free_text', dimension: 'theme', rawKey: 'art', excerpts: ['arte moderno'], userText: 'quiero arte moderno', expected: 'DIRECT' },
  { id: 'P2c', note: 'alias "moderno" -> local_character contemporary is in the table, so DIRECT (alias review item)', source: 'free_text', dimension: 'local_character', rawKey: 'contemporary', excerpts: ['arte moderno'], userText: 'quiero arte moderno', expected: 'DIRECT' },
  { id: 'P3', note: 'owner example', source: 'free_text', dimension: 'theme', rawKey: 'architecture', excerpts: ['los edificios de Gaudí'], userText: 'quiero ver los edificios de Gaudí', expected: 'INFERRED' },
  { id: 'P4a', note: 'owner example', source: 'free_text', dimension: 'theme', rawKey: 'history', excerpts: ['la ESMA'], userText: 'quiero conocer la ESMA', expected: 'INFERRED' },
  { id: 'P4b', note: 'same sentence, intent visit via alias "conocer"', source: 'free_text', dimension: 'intent', rawKey: 'visit', excerpts: ['conocer la ESMA'], userText: 'quiero conocer la ESMA', expected: 'DIRECT' },
  { id: 'P5', note: 'excerpt "arte" only occurs inside "martes"', source: 'free_text', dimension: 'theme', rawKey: 'art', excerpts: ['arte'], userText: 'quiero ir el martes al centro', expected: 'INFERRED' },
  { id: 'P6', note: 'case and accents normalize', source: 'free_text', dimension: 'theme', rawKey: 'history', excerpts: ['lo HISTÓRICO'], userText: 'me interesa lo HISTÓRICO', expected: 'DIRECT' },
  { id: 'P7', note: 'multi-word alias', source: 'free_text', dimension: 'theme', rawKey: 'nightlife', excerpts: ['vida nocturna'], userText: 'algo de vida nocturna', expected: 'DIRECT' },
  { id: 'P8', note: 'no stemming: inflection without an explicit alias', source: 'free_text', dimension: 'theme', rawKey: 'architecture', excerpts: ['obras arquitectónicas'], userText: 'ver obras arquitectónicas', expected: 'INFERRED' },
  { id: 'P9a', note: 'dimension-scoped alias "playa" (theme beach)', source: 'free_text', dimension: 'theme', rawKey: 'beach', excerpts: ['playa'], userText: 'un día de playa', expected: 'DIRECT' },
  { id: 'P9b', note: 'dimension-scoped alias "playa" (nature_type coast)', source: 'free_text', dimension: 'nature_type', rawKey: 'coast', excerpts: ['playa'], userText: 'un día de playa', expected: 'DIRECT' },
  { id: 'P10', note: 'open dimension (trait) has no vocabulary to certify against', source: 'free_text', dimension: 'trait', rawKey: 'tranquilo', excerpts: ['tranquila'], userText: 'una zona tranquila', expected: 'INFERRED' },
  { id: 'P11', note: 'wizard selection', source: 'wizard', dimension: 'theme', rawKey: 'history', excerpts: [], userText: '', expected: 'DIRECT' },
  { id: 'P12', note: 'negation: provenance is lexical, polarity is not checked (residual)', source: 'free_text', dimension: 'theme', rawKey: 'architecture', excerpts: ['no me interesa la arquitectura'], userText: 'no me interesa la arquitectura', expected: 'DIRECT' },
  { id: 'P13', note: 'English text matches the canonical key itself', source: 'free_text', dimension: 'theme', rawKey: 'architecture', excerpts: ['I love architecture'], userText: 'I love architecture', expected: 'DIRECT' },
  { id: 'P14', note: 'snake key and spaced text', source: 'free_text', dimension: 'intent', rawKey: 'day_trip', excerpts: ['a day trip'], userText: 'a day trip outside the city', expected: 'DIRECT' },
  { id: 'P15', note: 'excerpt names a different key', source: 'free_text', dimension: 'theme', rawKey: 'history', excerpts: ['la arquitectura'], userText: 'me encanta la arquitectura', expected: 'INFERRED' },
];

afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
});

describe('PROVENANCE-1 owner rule vs live vocabulary', () => {
  it('classifies every case as the rule states', () => {
    const rows = CASES.map((c) => {
      const key = canonicalizeFacetKey(c.dimension, c.rawKey);
      if (!key) {
        return { ...c, canonicalKey: null, provenance: 'NOT_IN_VOCABULARY', reason: 'canonicalizeFacetKey -> undefined' };
      }
      const r = referenceProvenance({ source: c.source, dimension: c.dimension, key, excerpts: c.excerpts, userText: c.userText });
      return { ...c, canonicalKey: key, ...r };
    });
    results.referenceRule = rows.map(({ id, note, dimension, rawKey, canonicalKey, provenance, reason, expected }) => ({
      id, note, facet: `${dimension}:${canonicalKey ?? rawKey}`, provenance, reason, expected, pass: provenance === expected,
    }));
    for (const r of rows) {
      expect(`${r.id}:${r.provenance}`).toBe(`${r.id}:${r.expected}`);
    }
  });

  it('records the live vocabulary has no version identifier', () => {
    const mod = require('../../../../be/src/modules/tours/preferences/preference-facet-vocabulary');
    const versionExports = Object.keys(mod).filter((k) => /version/i.test(k));
    results.vocabularyVersionExports = versionExports;
    expect(versionExports).toEqual([]);
  });
});

describe('live interpreter on the same inputs (characterization)', () => {
  function makeService(response?: string, error?: Error) {
    const langChain = {
      getProviderMetadata: jest.fn(() => ({ provider: 'test', model: 'test' })),
      generateChatResponse: jest.fn(async () => {
        if (error) throw error;
        return response ?? '{}';
      }),
    } as any;
    return new PreferenceInterpreterService(langChain);
  }

  it('LLM path: facets carry no provenance; Gaudí -> architecture is indistinguishable from a direct statement', async () => {
    const direct = await makeService(JSON.stringify({ preferredFacets: [
      { dimension: 'theme', key: 'architecture', confidence: 0.9, strength: 'strong', evidence: ['me encanta la arquitectura'] },
    ] })).interpret('me encanta la arquitectura');
    const inferred = await makeService(JSON.stringify({ preferredFacets: [
      { dimension: 'theme', key: 'architecture', confidence: 0.9, strength: 'strong', evidence: ['los edificios de Gaudí'] },
    ] })).interpret('quiero ver los edificios de Gaudí');
    const strip = (f: any) => ({ ...f, evidence: undefined });
    results.llmPathFacetFields = Object.keys(direct.intent.preferredFacets[0]).sort();
    results.llmPathDirectVsInferredIdenticalExceptEvidence =
      JSON.stringify(strip(direct.intent.preferredFacets[0])) === JSON.stringify(strip(inferred.intent.preferredFacets[0]));
    expect(results.llmPathDirectVsInferredIdenticalExceptEvidence).toBe(true);
    expect(results.llmPathFacetFields).not.toContain('provenance');
  });

  it('LLM path: the evidence-support check is substring based ("arte" accepted from "martes")', async () => {
    const out = await makeService(JSON.stringify({ preferredFacets: [
      { dimension: 'theme', key: 'art', confidence: 0.9, strength: 'strong', evidence: ['arte'] },
    ] })).interpret('quiero ir el martes al centro');
    results.llmPathSubstringEvidenceAccepted = out.intent.preferredFacets.map((f) => `${f.dimension}:${f.key}`);
    expect(results.llmPathSubstringEvidenceAccepted).toEqual(['theme:art']);
  });

  it('fallback path: keyword triggers are substring matches and the excerpt is the trigger, not a user span', async () => {
    const out = await makeService(undefined, new Error('llm down')).interpret('quiero ir el martes al centro');
    results.fallbackSubstringTrigger = out.intent.preferredFacets.map((f) => ({
      facet: `${f.dimension}:${f.key}`, evidence: f.evidence?.map((e) => e.text),
    }));
    expect(out.intent.preferredFacets.map((f) => `${f.dimension}:${f.key}`)).toContain('theme:art');
  });
});
