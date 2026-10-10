import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * Invariant: a provider result is NOT a VERIFIED Experience. A structured
 * observation only becomes a persisted Experience after synthesis →
 * corroboration → the resolver → geographic validation → persistence. An
 * observation the resolver can't ground never lands a row.
 */
const DEST = { latitude: -34.61, longitude: -58.38 };

describe('tour-generation integration · no direct persistence', () => {
  let harness: TourGenerationHarness;

  beforeAll(async () => {
    harness = await TourGenerationHarness.create();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
  });

  it('persists an Experience only through the resolver, never straight from an observation', async () => {
    harness.configure({
      wikivoyage: {
        status: 'ok',
        title: 'Buenos Aires',
        entries: [
          // Groundable: a matching OSM POI exists below.
          { name: 'Basílica de San Francisco', sectionType: 'SEE' },
          // NOT groundable: no OSM POI, no Nominatim match => resolver rejects.
          { name: 'Fictional Rooftop Nobody Can Resolve', sectionType: 'SEE' },
        ],
      },
      groundedSearch: { evidence: [{ key: 'web:ndp:1' }] },
      discoveryExtractor: {
        candidates: [
          {
            name: 'Monserrat colonial churches visit',
            themes: ['history'],
            intents: ['visit'],
            evidenceKeys: ['web:ndp:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi('Basílica de San Francisco', DEST.latitude, DEST.longitude),
          osmPoi(
            'Monserrat colonial churches visit',
            DEST.latitude + 0.0003,
            DEST.longitude,
          ),
        ],
      },
    });

    const resolveSpy = jest.spyOn(harness.resolver, 'resolve');

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });

    // Precondition: nothing persisted yet.
    expect(
      await harness.prisma.experience.count({ where: { status: 'VERIFIED' } }),
    ).toBe(0);

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    // The resolver is the only path to a VERIFIED row.
    expect(resolveSpy).toHaveBeenCalled();

    const verified = await harness.prisma.experience.findMany({
      where: { status: 'VERIFIED' },
    });
    expect(verified.length).toBeGreaterThanOrEqual(1);
    // Every persisted row carries the resolver's own provenance stamp.
    for (const experience of verified) {
      expect((experience.metadata as any)?.source).toBe(
        'grounded_experience_discovery',
      );
    }
    // The ungroundable observation never became a row.
    expect(
      verified.some(
        (e) => e.canonicalName === 'Fictional Rooftop Nobody Can Resolve',
      ),
    ).toBe(false);

    resolveSpy.mockRestore();
  });
});
