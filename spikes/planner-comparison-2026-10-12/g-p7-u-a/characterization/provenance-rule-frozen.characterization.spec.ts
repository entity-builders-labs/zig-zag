/**
 * G-P7-U.A — PROVENANCE-1 reference rule (owner, 2026-10-14) on FROZEN historical inputs.
 *
 * HISTORICAL EVIDENCE ONLY. The lexical provenance rule evaluated here was superseded on
 * 2026-10-15 by the preference-assertion contract (task 25.4), which removed every maintained
 * alias/synonym table from production. This harness keeps the spike reproducible without any
 * production import: it reads the facet vocabulary and synonym table exactly as they shipped at
 * the evidence commit (`frozen-facet-vocabulary-9673571e.json`, dumped from that commit's module)
 * and re-derives `referenceRule` and `vocabularyVersionExports`, asserting they equal the recorded
 * `runs/provenance.json`. It never writes `runs/`.
 *
 * The live-code characterizations (`provenance-rule.characterization.spec.ts`'s interpreter block
 * and `current-code.characterization.spec.ts`) characterize production code that no longer exists;
 * they are reproduced at the evidence commit by `scripts/reproduce-live-characterization.sh`.
 *
 * Run from be/: npx jest -c ../spikes/planner-comparison-2026-10-12/g-p7-u-a/characterization/jest.frozen.config.json
 */
import * as fs from 'fs';
import * as path from 'path';

type Provenance = 'DIRECT' | 'INFERRED';

interface FrozenVocabulary {
  sourceCommit: string;
  PREFERENCE_DIMENSIONS: Record<string, string>;
  INITIAL_DIMENSION_VOCABULARY: Record<string, string[]>;
  DIMENSION_KEY_SYNONYMS: Record<string, Record<string, string>>;
  moduleVersionExports: string[];
}

const FROZEN: FrozenVocabulary = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'frozen-facet-vocabulary-9673571e.json'), 'utf8'),
);
const RECORDED = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'runs', 'provenance.json'), 'utf8'),
);

// Historical `normalizeText` of the vocabulary module at the evidence commit (spike-only copy).
function vocabularyNormalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Historical `canonicalizeFacetKey` at the evidence commit, over the frozen data (spike-only copy).
function historicalCanonicalizeFacetKey(dimension: string, rawKey: string): string | undefined {
  if (!dimension || !rawKey) return undefined;
  const dim = dimension.trim().toLowerCase();
  if (!Object.values(FROZEN.PREFERENCE_DIMENSIONS).includes(dim)) return undefined;
  const normalizedRaw = vocabularyNormalizeText(rawKey);
  if (!normalizedRaw) return undefined;
  const snake = normalizedRaw.replace(/[ -]+/g, '_');
  if (dim === FROZEN.PREFERENCE_DIMENSIONS.TRAIT) return snake;
  const dimSynonyms = FROZEN.DIMENSION_KEY_SYNONYMS[dim];
  const candidateKey = dimSynonyms?.[normalizedRaw] ?? dimSynonyms?.[snake] ?? snake;
  const vocab = FROZEN.INITIAL_DIMENSION_VOCABULARY[dim];
  if (vocab && vocab.includes(candidateKey)) return candidateKey;
  if (vocab && vocab.includes(normalizedRaw)) return normalizedRaw;
  return undefined;
}

// Same as the original spike: vocabulary normalization plus '_'/'-' as token separators.
function norm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const h = norm(haystack);
  const p = norm(phrase);
  return p.length > 0 && ` ${h} `.includes(` ${p} `);
}

function directTerms(dimension: string, key: string): string[] {
  const aliases = Object.entries(FROZEN.DIMENSION_KEY_SYNONYMS[dimension] ?? {})
    .filter(([, canonical]) => canonical === key)
    .map(([alias]) => alias);
  return [key, ...aliases];
}

function referenceProvenance(input: {
  source: 'wizard' | 'free_text';
  dimension: string;
  key: string;
  excerpts: string[];
  userText: string;
}): { provenance: Provenance; reason: string } {
  if (input.source === 'wizard') {
    return { provenance: 'DIRECT', reason: 'WIZARD_SELECTION' };
  }
  if ((FROZEN.INITIAL_DIMENSION_VOCABULARY[input.dimension] ?? []).length === 0) {
    return { provenance: 'INFERRED', reason: 'OPEN_DIMENSION_NO_VOCABULARY' };
  }
  const terms = directTerms(input.dimension, input.key);
  for (const excerpt of input.excerpts) {
    if (!containsPhrase(input.userText, excerpt)) continue;
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

// The original spike's cases, unchanged.
const CASES: {
  id: string;
  note: string;
  source: 'wizard' | 'free_text';
  dimension: string;
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

describe('PROVENANCE-1 reference rule on frozen historical inputs (G-P7-U.A, superseded)', () => {
  it('uses the frozen vocabulary of the evidence commit', () => {
    expect(FROZEN.sourceCommit).toBe('9673571e');
  });

  it('reproduces the recorded referenceRule exactly', () => {
    const rows = CASES.map((c) => {
      const key = historicalCanonicalizeFacetKey(c.dimension, c.rawKey);
      if (!key) {
        return { ...c, canonicalKey: null, provenance: 'NOT_IN_VOCABULARY', reason: 'canonicalizeFacetKey -> undefined' };
      }
      const r = referenceProvenance({ source: c.source, dimension: c.dimension, key, excerpts: c.excerpts, userText: c.userText });
      return { ...c, canonicalKey: key, ...r };
    });
    const referenceRule = rows.map(({ id, note, dimension, rawKey, canonicalKey, provenance, reason, expected }) => ({
      id, note, facet: `${dimension}:${canonicalKey ?? rawKey}`, provenance, reason, expected, pass: provenance === expected,
    }));
    expect(referenceRule).toEqual(RECORDED.referenceRule);
  });

  it('reproduces the recorded absence of a vocabulary version', () => {
    expect(FROZEN.moduleVersionExports).toEqual(RECORDED.vocabularyVersionExports);
  });
});
