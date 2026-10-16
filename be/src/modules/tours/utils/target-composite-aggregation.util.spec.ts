import { hardTargetCompatibility } from './target-composite-aggregation.util';
import { TargetKnowledge } from '../preferences/target-knowledge.interface';

const SATISFIES: TargetKnowledge = { state: 'SATISFIES' };
const DOES_NOT: TargetKnowledge = { state: 'DOES_NOT_SATISFY' };
const UNKNOWN: TargetKnowledge = { state: 'UNKNOWN', reason: 'NO_EVIDENCE' };

describe('hardTargetCompatibility (HARD INCLUDE)', () => {
  it('is COMPATIBLE when every required component SATISFIES', () => {
    expect(hardTargetCompatibility('INCLUDE', [SATISFIES, SATISFIES])).toBe(
      'COMPATIBLE',
    );
  });

  it('is INCOMPATIBLE when any required component DOES_NOT_SATISFY', () => {
    expect(hardTargetCompatibility('INCLUDE', [SATISFIES, DOES_NOT])).toBe(
      'INCOMPATIBLE',
    );
  });

  it('is UNKNOWN otherwise (an unknown component is never compatible)', () => {
    expect(hardTargetCompatibility('INCLUDE', [SATISFIES, UNKNOWN])).toBe(
      'UNKNOWN',
    );
  });

  it('is UNKNOWN with no required components', () => {
    expect(hardTargetCompatibility('INCLUDE', [])).toBe('UNKNOWN');
  });
});

describe('hardTargetCompatibility (HARD EXCLUDE)', () => {
  it('is COMPATIBLE when every required component DOES_NOT_SATISFY', () => {
    expect(hardTargetCompatibility('EXCLUDE', [DOES_NOT, DOES_NOT])).toBe(
      'COMPATIBLE',
    );
  });

  it('is INCOMPATIBLE when any required component SATISFIES', () => {
    expect(hardTargetCompatibility('EXCLUDE', [DOES_NOT, SATISFIES])).toBe(
      'INCOMPATIBLE',
    );
  });

  it('is UNKNOWN otherwise', () => {
    expect(hardTargetCompatibility('EXCLUDE', [DOES_NOT, UNKNOWN])).toBe(
      'UNKNOWN',
    );
  });
});
