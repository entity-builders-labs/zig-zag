import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');

describe('single live orchestration owner', () => {
  it('keeps generation behind one processor-owned Experience path', () => {
    const processor = readFileSync(
      join(
        root,
        'src/modules/tours/services/tour-generation-processor.service.ts',
      ),
      'utf8',
    );
    const generation = readFileSync(
      join(root, 'src/modules/tours/services/experience-generation.service.ts'),
      'utf8',
    );

    expect(processor).toContain('ExperienceGenerationService');
    expect(processor.match(/generateTourExperiences\(/g)).toHaveLength(1);
    expect(generation).not.toMatch(/from ['"].*coverage-analyzer/);
    expect(generation).not.toContain('selectBoundedWindow');
  });
});
