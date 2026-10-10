import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('venue anchor provider boundary', () => {
  it('does not depend on a concrete Places provider', () => {
    const source = readFileSync(
      join(__dirname, 'venue-anchor-resolution.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/GooglePlacesAcquisitionProvider|Geoapify/);
  });
});
