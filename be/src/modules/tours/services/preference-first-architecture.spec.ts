import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as vocabularyModule from '../preferences/preference-facet-vocabulary';
import * as assertionModule from '../preferences/preference-assertion.interface';
import * as mergeModule from '../utils/preference-facet-merge.util';
import * as matchFactsModule from '../utils/experience-match-facts.util';
import {
  canonicalTargetKey,
  INITIAL_DIMENSION_VOCABULARY,
} from '../preferences/preference-facet-vocabulary';

const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');
/** Source without comments, so guards check code rather than prose. */
const code = (name: string) =>
  source(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('preference-first architecture boundaries', () => {
  it('keeps PreferenceSpec as the downstream preference authority', () => {
    const generation = source('experience-generation.service.ts');
    expect(generation).not.toMatch(/request\.intent\.(interests|intents)\s*=/);
    expect(generation).not.toMatch(
      /request\.intent\.additionalPreferences\s*=/,
    );
    expect(generation).not.toMatch(
      /request\.intent\.normalizedPreferences\s*=/,
    );
  });

  it('keeps one typed portfolio policy and no point-radius OSM identity', () => {
    expect(source('experience-generation.service.ts')).not.toMatch(
      /osmId:\s*0/,
    );
    expect(source('experience-proposal-resolver.service.ts')).not.toMatch(
      /synthetic:point-radius/,
    );
    expect(source('experience-proposal-resolver.service.ts')).not.toMatch(
      /destinationPointRadius/,
    );
    expect(
      source('../interfaces/experience-resolution.interface.ts'),
    ).not.toMatch(/\[key: string\]: unknown/);
    expect(source('../utils/preference-sufficiency.util.ts')).toMatch(
      /export function portfolioTarget/,
    );
  });

  it('keeps composition on its typed projection boundary', () => {
    const composition = source('experience-composition.service.ts');
    expect(composition).not.toMatch(/experience\.metadata/);
    expect(composition).not.toMatch(/experiences:\s*any\[\]/);
    expect(composition).not.toMatch(/Map<string, any>/);
  });

  it('keeps provider isolation and one generation orchestrator', () => {
    expect(source('venue-anchor-resolution.service.ts')).not.toMatch(
      /GooglePlacesAcquisitionProvider|Geoapify/,
    );
    expect(source('experience-generation.service.ts')).toMatch(
      /async generateTourExperiences\(/,
    );
    expect(source('experience-generation.service.ts')).not.toMatch(
      /GenerationWorkflowService|SecondTourOrchestrator|PlannerAcquisitionOrchestrator/,
    );
  });

  it('does not let interpreted anchor kind reach routing as geographic authority', () => {
    const interpreter = source('preference-interpreter.service.ts');
    const generation = source('experience-generation.service.ts');
    expect(interpreter).not.toMatch(/AnchoredPlace\['kind'\]/);
    expect(generation).toMatch(
      /partitionDeficitsIntoWorkUnits\([\s\S]*resolvedAnchors/,
    );
    expect(generation).toMatch(/resolveNamedAnchors\(/);
  });

  it('forwards resolved anchors into the GENERIC / DEDICATED_INTENT acquisition plans (RW2 fix)', () => {
    const generation = source('experience-generation.service.ts');
    // Each unit's buildAcquisitionPlan call must pass `anchors: resolvedAnchors`
    // so structured anchors survive as typed facts, never only via semanticQuery,
    // and must be built from ONLY that unit's own deficits.
    expect(generation).toMatch(
      /buildAcquisitionPlan\(\s*\{[\s\S]*?deficits:\s*workUnitDeficits\(unit\)[\s\S]*?anchors:\s*resolvedAnchors/,
    );
  });

  // Geographic-authorization contract
  // (docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md).
  it('has no request-global geographic validation intent anywhere', () => {
    expect(
      existsSync(join(__dirname, '../utils/request-validation-intent.util.ts')),
    ).toBe(false);
    const sources = [
      'experience-generation.service.ts',
      'experience-acquisition.service.ts',
      'area-route-walk-acquisition.service.ts',
      'experience-proposal-resolver.service.ts',
      'composite-geographic-validation.service.ts',
      'venue-anchor-resolution.service.ts',
      '../interfaces/experience-resolution.interface.ts',
      '../utils/generation-trace/resolution-audit.ts',
      '../utils/generation-trace/acquisition-audit.ts',
    ].map(source);
    for (const text of sources) {
      expect(text).not.toMatch(
        /deriveRequestValidationIntent|validationIntentOf|MIXED_UNSUPPORTED|requestValidationIntent|validationIntent/,
      );
    }
  });

  it('pairs every resolver candidate with its own authorization (no batch policy)', () => {
    expect(source('../interfaces/experience-resolution.interface.ts')).toMatch(
      /candidates:\s*AuthorizedExperienceCandidate\[\]/,
    );
    expect(source('experience-acquisition.service.ts')).toMatch(
      /authorizeCandidates\(\s*context\.geographicGrant,\s*execution\.candidates,?\s*\)/,
    );
  });

  it('never grants route geography from a source hint role alone', () => {
    // The canonical physical-ROUTE predicate lives with the single scope
    // owner; the validator consumes it, never a role-only shortcut.
    const validator = source('composite-geographic-validation.service.ts');
    const scopePolicy = source(
      '../utils/experience-geographic-scope.policy.ts',
    );
    expect(validator).not.toMatch(/role === 'route' && entity\.geometry/);
    expect(validator).not.toMatch(
      /anchors\.some\(\s*\(entity\) => entity\.role === 'route',?\s*\)/,
    );
    expect(scopePolicy).toMatch(/entity\.kind === 'ROUTE'/);
  });

  it('never emits a trace key the credential sanitizer would redact as domain audit state', () => {
    // generation-trace-recorder.util.ts SECRET_KEY redacts any key containing
    // "authorization"; COLD #11 lost the per-candidate policy that way.
    for (const name of [
      '../utils/generation-trace/resolution-audit.ts',
      '../utils/generation-trace/acquisition-audit.ts',
    ]) {
      expect(source(name)).not.toMatch(/\b\w*[Aa]uthorization\w*\s*:/);
    }
  });

  /**
   * Structural semantic-boundary invariants (review correction C, F4). They
   * check data flow and module roles, not identifier names.
   */
  describe('semantic boundary (review C)', () => {
    const TOURS = join(__dirname, '..');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
      });
    const productionFiles = walk(TOURS);
    const stripComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const filesUsing = (pattern: RegExp) =>
      productionFiles
        .filter((path) =>
          pattern.test(stripComments(readFileSync(path, 'utf8'))),
        )
        .map((path) => relative(TOURS, path))
        .sort();

    /** The deterministic preference path: validation, resolution, utility. */
    const DETERMINISTIC_PREFERENCE_PATH = [
      'preferences/preference-facet-vocabulary.ts',
      'preferences/preference-assertion.interface.ts',
      'utils/preference-spec-builder.util.ts',
      'utils/preference-facet-merge.util.ts',
      'utils/preference-facet-matching.util.ts',
      'utils/preference-strong-match.util.ts',
      'utils/preference-utility.util.ts',
      'utils/hard-constraint-enforceability.util.ts',
      'utils/experience-match-facts.util.ts',
      'utils/composition-set-cover.util.ts',
      'services/preference-utility.service.ts',
      'services/experience-composition.service.ts',
    ];

    it('user free text reaches preference semantics only through the extractor', () => {
      for (const file of DETERMINISTIC_PREFERENCE_PATH) {
        const body = stripComments(readFileSync(join(TOURS, file), 'utf8'));
        expect(`${file}: ${/additionalPreferences/.test(body)}`).toBe(
          `${file}: false`,
        );
      }
      // The orchestrator hands the text to exactly one interpreter call.
      expect(
        source('experience-generation.service.ts').match(
          /preferenceInterpreter\.interpret\(/g,
        ),
      ).toHaveLength(1);
    });

    it('only reviewed boundary modules turn strings into schema identifiers', () => {
      // A new caller of the schema-key primitives must be reviewed: it is
      // either a validation/adaptation boundary or a semantic regression.
      expect(
        filesUsing(/\b(canonicalTargetKey|canonicalizeFacetKey)\(/),
      ).toEqual([
        'preferences/preference-facet-vocabulary.ts', // definition
        'services/area-route-walk-acquisition.service.ts', // typed deficit key
        'services/experience-classification.service.ts', // classifier output validation
        'services/preference-interpreter.service.ts', // extractor output validation
        'utils/experience-candidate-facet-normalizer.util.ts', // extraction output validation
        'utils/experience-match-facts.util.ts', // fact adapters
        'utils/preference-facet-merge.util.ts', // structured selection validation
      ]);
    });

    it('the schema holds identifiers only, and no preference module exports a surface-form table', () => {
      for (const keys of Object.values(INITIAL_DIMENSION_VOCABULARY)) {
        for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
      for (const moduleExports of [
        vocabularyModule,
        assertionModule,
        mergeModule,
        matchFactsModule,
      ]) {
        for (const [name, value] of Object.entries(moduleExports)) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
          }
          // A lowercase-keyed string-to-string object is a translation
          // table; constant enums (UPPER_SNAKE keys) are not.
          const entries = Object.entries(value as Record<string, unknown>);
          const isTable =
            entries.length > 0 &&
            entries.every(([, v]) => typeof v === 'string') &&
            entries.some(([k]) => /[a-z\s]/.test(k));
          expect(`${name}: ${isTable}`).toBe(`${name}: false`);
        }
      }
    });

    it('schema-key normalization never maps one word to a different identifier', () => {
      const formatOnly = (value: string) =>
        value
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9_ -]+/g, ' ')
          .replace(/[\s-]+/g, '_');
      const probes = [
        ...Object.values(INITIAL_DIMENSION_VOCABULARY).flat(),
        'Historia',
        'arquitectura',
        'vino',
        'caminata',
        'silla de ruedas',
        'Day Trip',
        'vida nocturna',
      ];
      for (const dimension of Object.keys(INITIAL_DIMENSION_VOCABULARY)) {
        for (const probe of probes) {
          const key = canonicalTargetKey(dimension, probe);
          if (key !== undefined) expect(key).toBe(formatOnly(probe));
        }
      }
    });

    it('keeps the deleted lexical evaluator and legacy facet model deleted', () => {
      for (const deleted of [
        '../utils/experience-preference-evaluator.util.ts',
        '../preferences/preference-facet.interface.ts',
      ]) {
        expect(existsSync(join(__dirname, deleted))).toBe(false);
      }
    });
  });

  it('keeps one preference-utility authority and no planner scoring formula (task 25.2)', () => {
    expect(
      existsSync(join(__dirname, '../utils/candidate-ranking.util.ts')),
    ).toBe(false);
    for (const name of [
      '../utils/daily-planning-candidate-sort.util.ts',
      '../utils/daily-planning-placement.util.ts',
      'greedy-daily-planning.solver.ts',
      'experience-generation.service.ts',
      'planning-candidate-normalizer.service.ts',
      'experience-composition.service.ts',
      '../utils/composition-set-cover.util.ts',
    ]) {
      const code = source(name);
      expect(code).not.toMatch(/plannerRelevanceScore|preferenceWeight\b/);
      expect(code).not.toMatch(/semanticWeight|qualityWeight/);
      expect(code).not.toMatch(/groundingStrength/);
      expect(code).not.toMatch(/semanticSimilarity\s*\?\?\s*0/);
    }
    // Only the utility service queries the semantic batch.
    expect(source('experience-composition.service.ts')).not.toMatch(
      /getSimilarityScores/,
    );
    expect(source('preference-utility.service.ts')).toMatch(
      /getSimilarityScores/,
    );
  });

  it('keeps the canonical matcher on typed Experience facts only (review B)', () => {
    for (const name of [
      '../utils/preference-facet-matching.util.ts',
      '../utils/preference-strong-match.util.ts',
      '../utils/preference-utility.util.ts',
    ]) {
      const body = code(name);
      expect(body).not.toMatch(/\bmetadata\b/);
      expect(body).not.toMatch(
        /Record<string,\s*any>|:\s*unknown\b|\bas any\b/,
      );
    }
    // One adapter module owns the translation into typed facts.
    expect(source('../utils/experience-match-facts.util.ts')).toMatch(
      /export function catalogMatchFacts/,
    );
  });
});
