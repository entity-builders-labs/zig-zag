import { TourGenerationHarness } from './support/harness';
import { osmPoi, placeData } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * A food + nightlife request routes contextual commercial types
 * (restaurant/cafe/bakery/bar/night_club) to Google Places. Those bare
 * operational venues are admitted as observations but marked
 * without a matching origination capability, so corroboration drops them — they never
 * become VERIFIED tourism Experiences. Evidence-backed tourism food
 * (Wikivoyage EAT, a web-discovered parrilla) still can. The gate is domain /
 * source semantics, not a name blacklist and not a ratings threshold.
 */
const DEST = { latitude: -34.6083, longitude: -58.3712 };

const GENERIC_VENUES = [
  { name: 'Café Rivas', type: 'cafe' },
  { name: 'Bar El Federal', type: 'bar' },
  { name: 'Panadería La Argentina', type: 'bakery' },
  { name: 'Resto Bar Krishna', type: 'restaurant' },
  { name: 'Night Club XYZ', type: 'night_club' },
  { name: 'Confitería Ideal Café', type: 'cafe' },
  { name: 'Cervecería Esquina', type: 'bar' },
  { name: 'Bodegón Los Amigos', type: 'restaurant' },
];

describe('tour-generation integration · places admission', () => {
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

  it('does not turn generic operational venues into VERIFIED Experiences', async () => {
    harness.configure({
      places: {
        nearby: GENERIC_VENUES.map((venue, i) =>
          placeData({
            id: `places-generic-${i}`,
            text: venue.name,
            types: [venue.type],
            primaryType: venue.type,
            rating: 4.7,
            userRatingCount: 5000,
            location: {
              latitude: DEST.latitude + i * 0.0002,
              longitude: DEST.longitude + i * 0.0002,
            },
          }),
        ),
      },
      wikivoyage: {
        status: 'ok',
        title: 'Buenos Aires',
        entries: [
          {
            name: 'Mercado de San Telmo',
            sectionType: 'SEE',
            description:
              'Historic 1897 covered market, wrought-iron structure.',
          },
        ],
      },
      groundedSearch: { evidence: [{ key: 'web:food:1' }] },
      discoveryExtractor: {
        candidates: [
          {
            name: 'Parrilla Don Julio tasting experience',
            description: 'A guided asado tasting at a landmark parrilla.',
            themes: ['food'],
            intents: ['food'],
            evidenceKeys: ['web:food:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi('Mercado de San Telmo', DEST.latitude, DEST.longitude),
          osmPoi(
            'Parrilla Don Julio tasting experience',
            DEST.latitude + 0.0005,
            DEST.longitude + 0.0005,
          ),
          // Even give the generic venues resolvable geography — the gate must
          // still stop them before the resolver.
          ...GENERIC_VENUES.map((venue, i) =>
            osmPoi(
              venue.name,
              DEST.latitude + i * 0.0002,
              DEST.longitude + i * 0.0002,
            ),
          ),
        ],
      },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['food'],
      intents: ['nightlife', 'food'],
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    // Places WAS queried for the contextual types (the plan asked for them).
    expect(harness.fakes.places.searchNearby).toHaveBeenCalled();

    const verified = await harness.prisma.experience.findMany({
      where: { status: 'VERIFIED' },
    });
    const verifiedNames = verified.map((e) => e.canonicalName);

    // No bare operational venue became a standalone tourism Experience.
    for (const venue of GENERIC_VENUES) {
      expect(verifiedNames).not.toContain(venue.name);
    }

    // Evidence-backed tourism food survived (Wikivoyage SEE and/or the
    // web-discovered parrilla).
    expect(
      verifiedNames.some(
        (name) =>
          name === 'Mercado de San Telmo' ||
          name === 'Parrilla Don Julio tasting experience',
      ),
    ).toBe(true);
  });
});
