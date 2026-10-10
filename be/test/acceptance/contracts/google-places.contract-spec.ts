import { PlaceData } from 'src/modules/integrations/google-places/interfaces/places-api.interface';

describe('Provider Contract: Google Places Normalization (TC-PROV-03)', () => {
  it('validates canonical PlaceData schema returned by Places API', () => {
    const rawPlace: PlaceData = {
      id: 'places/ChIJ123456789',
      name: 'places/ChIJ123456789',
      displayName: { text: 'Café Tortoni', languageCode: 'es' },
      formattedAddress: 'Av. de Mayo 825, CABA',
      location: { latitude: -34.6084, longitude: -58.3791 },
      rating: 4.6,
      userRatingCount: 35000,
      primaryType: 'cafe',
      types: ['cafe', 'food', 'point_of_interest', 'establishment'],
      businessStatus: 'OPERATIONAL',
      priceLevel: 'PRICE_LEVEL_MODERATE',
      openingHoursWeekdayText: [
        'Monday: 8:00 AM – 9:00 PM',
        'Tuesday: 8:00 AM – 9:00 PM',
      ],
    };

    expect(rawPlace.id).toBeDefined();
    expect(rawPlace.displayName?.text).toBe('Café Tortoni');
    expect(rawPlace.location?.latitude).toBeCloseTo(-34.6084);
    expect(rawPlace.location?.longitude).toBeCloseTo(-58.3791);
    expect(rawPlace.rating).toBeGreaterThan(0);
    expect(rawPlace.businessStatus).toBe('OPERATIONAL');
  });
});
