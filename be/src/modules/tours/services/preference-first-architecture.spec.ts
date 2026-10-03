import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');

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
});
