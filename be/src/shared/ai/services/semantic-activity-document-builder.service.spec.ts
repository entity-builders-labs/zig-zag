import { ActivityKind, VariantTheme } from '@prisma/client';
import {
  SemanticActivityDocumentBuilder,
  SemanticActivityRecord,
} from './semantic-activity-document-builder.service';

describe('SemanticActivityDocumentBuilder', () => {
  const builder = new SemanticActivityDocumentBuilder();

  const activity = (overrides: Partial<SemanticActivityRecord> = {}) =>
    ({
      id: 'activity-1',
      name: 'San Telmo Historic Walk',
      description: 'A walk through the historic quarter.',
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      variantTheme: VariantTheme.HISTORY,
      type: 'walking tour',
      knownActivityTypeName: null,
      duration: 2,
      latitude: -34.6,
      longitude: -58.37,
      externalId: 'variant:secret',
      rating: 4.9,
      ratingCount: 9000,
      sourceId: 'provider-secret',
      family: { areaActivity: { name: 'San Telmo' } },
      compositeWaypoints: [
        {
          waypointActivity: {
            name: 'Plaza Dorrego',
            kind: ActivityKind.POI,
            type: 'plaza',
            knownActivityTypeName: 'tourist_attraction',
          },
        },
      ],
      ...overrides,
    }) as SemanticActivityRecord;

  it('builds one stable document from verified semantic fields', () => {
    expect(builder.build(activity())).toBe(
      [
        'Name: San Telmo Historic Walk',
        'Kind: NEIGHBORHOOD_WALK',
        'Description: A walk through the historic quarter.',
        'Themes and types: walking tour, history',
        'Area: San Telmo',
        'Suggested duration: 2 hours',
        'Verified waypoints: Plaza Dorrego (tourist_attraction)',
      ].join('\n'),
    );
  });

  it('never embeds identity, coordinates, ratings or provider ids', () => {
    const document = builder.build(activity());

    expect(document).not.toContain('-34.6');
    expect(document).not.toContain('-58.37');
    expect(document).not.toContain('variant:secret');
    expect(document).not.toContain('provider-secret');
    expect(document).not.toContain('4.9');
    expect(document).not.toContain('9000');
  });
});
