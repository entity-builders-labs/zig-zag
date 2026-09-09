import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { canonicalizeFacetKey } from 'src/modules/tours/preferences/preference-facet-vocabulary';
import {
  CANONICAL_INTENT_KEYS,
  CANONICAL_THEME_KEYS,
} from 'src/modules/tours/utils/experience-candidate-facet-normalizer.util';
import { PREFERENCE_DIMENSIONS } from 'src/modules/tours/preferences/preference-facet-vocabulary';

/**
 * Load the monorepo-root `.env` (and a `be/.env` fallback) into `process.env`
 * without overriding anything already set — so a CLI-supplied var
 * (`OLLAMA_BASE_URL=…`, `LIVE_DISCOVERY_PROVIDER=…`, …) always wins. Mirrors
 * `src/commands/scripts/cli.ts`.
 */
export function loadRootEnv(): void {
  const candidates = [
    path.resolve(__dirname, '../../../../.env'), // <repo root>/.env
    path.resolve(__dirname, '../../../.env'), // be/.env
    path.resolve(process.cwd(), '../.env'), // cwd fallback (jest runs from be/)
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) dotenv.config({ path: file });
  }
}

export interface LiveExtractionResult {
  provider: string;
  model: string;
  rawOutput?: string;
  candidates: any[];
  validationErrors: string[];
}

const VALID_ROLES = new Set(['area', 'waypoint', 'route', 'venue']);
const VALID_KINDS = new Set(['PLACE', 'AREA', 'ROUTE']);

function truncate(value: string | undefined, max = 2000): string {
  if (!value) return '(empty)';
  return value.length > max ? `${value.slice(0, max)}… [truncated]` : value;
}

/**
 * Structural + domain invariants only — never exact names / counts / strings.
 * `allowEmptyCandidates` is for the generic-entity probe: returning no candidate
 * at all for deliberately thin category-only evidence is a valid, conservative
 * outcome (§ "candidate sin venue: válido") — the only hard rule there is the
 * no-generic-pseudo-entity check, applied separately.
 */
export function assertLiveExtractionContract(args: {
  result: LiveExtractionResult;
  evidenceKeys: string[];
  expectedProvider: string;
  allowEmptyCandidates?: boolean;
}): void {
  const { result, evidenceKeys, expectedProvider, allowEmptyCandidates } = args;
  const evidence = new Set(evidenceKeys);
  const detail = () =>
    `\nprovider=${result.provider} model=${result.model}` +
    `\nvalidationErrors=${JSON.stringify(result.validationErrors)}` +
    `\nrawOutput=${truncate(result.rawOutput)}`;

  expect(result.provider).toBe(expectedProvider);
  expect(typeof result.model === 'string' && result.model.length > 0).toBe(
    true,
  );
  if (!result.rawOutput || result.rawOutput.length === 0) {
    throw new Error(`live result has empty rawOutput.${detail()}`);
  }
  if (result.validationErrors.length > 0) {
    throw new Error(`live extraction produced validationErrors.${detail()}`);
  }
  if (result.candidates.length === 0 && !allowEmptyCandidates) {
    throw new Error(`live extraction produced zero candidates.${detail()}`);
  }

  for (const c of result.candidates) {
    expect(typeof c.name === 'string' && c.name.trim().length > 0).toBe(true);

    for (const theme of c.themes ?? []) {
      expect(CANONICAL_THEME_KEYS).toContain(theme);
    }
    for (const intent of c.intents ?? []) {
      expect(CANONICAL_INTENT_KEYS).toContain(intent);
    }
    for (const trait of c.traits ?? []) {
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, trait),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, trait),
      ).toBeUndefined();
    }

    for (const key of c.evidenceKeys ?? []) {
      expect(evidence.has(key)).toBe(true);
    }

    for (const hint of c.componentHints ?? []) {
      expect(typeof hint.name === 'string' && hint.name.trim().length > 0).toBe(
        true,
      );
      expect(VALID_ROLES.has(hint.role)).toBe(true);
      expect(VALID_KINDS.has(hint.expectedKind)).toBe(true);
      expect(
        Array.isArray(hint.evidenceKeys) && hint.evidenceKeys.length > 0,
      ).toBe(true);
      for (const key of hint.evidenceKeys) expect(evidence.has(key)).toBe(true);
    }
  }
}

/**
 * Fixture-semantic assertion for the generic-entity probe. That fixture's
 * evidence deliberately names only real AREA(s) (e.g. Palermo) plus generic
 * categories ("specialty coffee shops", "small craft breweries") and NO
 * concrete venue/business — so for that scenario ANY `componentHint` with
 * `expectedKind === 'PLACE'` is a fabricated concrete entity, regardless of
 * how the model named it. AREA hints, candidates without hints, and zero
 * candidates all remain valid. This is stronger than any banned-name list and
 * needs no fuzzy matching / category regex / runtime taxonomy.
 */
export function assertNoConcretePlaceHints(result: LiveExtractionResult): void {
  const offenders: string[] = [];
  for (const c of result.candidates) {
    for (const hint of c.componentHints ?? []) {
      if (hint.expectedKind === 'PLACE') {
        offenders.push(
          `candidate "${c.name}" -> componentHint name="${hint.name}" role=${hint.role} expectedKind=${hint.expectedKind}`,
        );
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `generic-entity evidence (no concrete venue) produced PLACE componentHints — ` +
        `fabricated concrete entities:\nprovider=${result.provider} model=${result.model}\n` +
        `${offenders.join('\n')}\nrawOutput=${truncate(result.rawOutput)}`,
    );
  }
}

/** Compact, secret-free characterization output. */
export function printCharacterization(
  scenario: string,
  result: LiveExtractionResult,
): void {
  const lines: string[] = [
    `\n── LIVE ${result.provider} · ${scenario} ──`,
    `model: ${result.model}`,
    `candidates: ${result.candidates.length} · validationErrors: ${result.validationErrors.length}`,
  ];
  result.candidates.forEach((c, i) => {
    lines.push(
      `  ${i + 1}. ${c.name}`,
      `     themes:  ${JSON.stringify(c.themes ?? [])}`,
      `     intents: ${JSON.stringify(c.intents ?? [])}`,
      `     traits:  ${JSON.stringify(c.traits ?? [])}`,
      `     components: ${JSON.stringify(
        (c.componentHints ?? []).map(
          (h: any) => `${h.name} (${h.role}/${h.expectedKind})`,
        ),
      )}`,
    );
  });
  if (result.validationErrors.length) {
    lines.push(
      `  validationErrors: ${JSON.stringify(result.validationErrors)}`,
    );
  }
  // eslint-disable-next-line no-console
  console.info(lines.join('\n'));
}

export function liveGate(thisProvider: 'gemini' | 'groq' | 'ollama'): boolean {
  if (process.env.RUN_LIVE_DISCOVERY_TESTS !== '1') return false;
  const only = process.env.LIVE_DISCOVERY_PROVIDER;
  return !only || only === 'all' || only === thisProvider;
}
