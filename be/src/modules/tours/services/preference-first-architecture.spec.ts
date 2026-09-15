import { readFileSync } from 'node:fs';
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
      /destinationBoundary|destinationPointRadius/,
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
    expect(interpreter).toMatch(
      /const kind: AnchoredPlace\['kind'\] = 'unknown'/,
    );
    expect(generation).toMatch(
      /partitionDeficitsByStrategy\([\s\S]*resolvedAnchors/,
    );
    expect(generation).toMatch(/resolveNamedAnchors\(/);
  });
});
