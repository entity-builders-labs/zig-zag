import { ActivityKind } from '@prisma/client';
import { toExperienceCandidate } from './experience-candidate-adapter.util';

describe('toExperienceCandidate', () => {
  it('drops structural kind and maps physical hints to GeoEntity kinds', () => {
    const candidate = toExperienceCandidate({
      name: 'Paseo Costanera',
      kind: ActivityKind.ROUTE,
      themes: ['nature'],
      entityHints: [
        {
          key: 'route-1',
          name: 'Costanera Norte',
          role: 'route',
          expectedType: 'promenade',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'place-1',
          name: 'Plaza',
          role: 'waypoint',
          expectedType: 'square',
          required: false,
          evidenceKeys: ['ev-2'],
        },
      ],
      suggestedDurationMinutes: 90,
      shortReason: 'Grounded route',
      evidenceKeys: ['ev-1', 'ev-2'],
    });

    expect(candidate).not.toHaveProperty('kind');
    expect(candidate.componentHints).toEqual([
      expect.objectContaining({ expectedKind: 'ROUTE', role: 'route' }),
      expect.objectContaining({ expectedKind: 'PLACE', role: 'waypoint' }),
    ]);
    expect(candidate.evidenceKeys).toEqual(['ev-1', 'ev-2']);
  });
});
