import { MediaPresentationResolver } from './media-presentation.resolver';

describe('MediaPresentationResolver', () => {
  const resolver = new MediaPresentationResolver();

  it('prefers persisted ExperienceMedia rows ordered by position', () => {
    const result = resolver.resolvePresentation({
      media: [
        {
          url: 'https://example.com/second.jpg',
          provider: 'wikimedia_commons',
          position: 2,
          caption: 'Second',
        },
        {
          url: 'https://example.com/first.jpg',
          provider: 'wikimedia_commons',
          position: 1,
          caption: 'First',
          author: 'Photographer',
          license: 'CC BY 4.0',
        },
      ],
      metadata: { category: 'museum' },
    });

    expect(result.source).toBe('DOCUMENTARY');
    expect(result.photos.map((photo) => photo.url)).toEqual([
      'https://example.com/first.jpg',
      'https://example.com/second.jpg',
    ]);
    expect(result.primaryPhoto).toEqual(
      expect.objectContaining({
        url: 'https://example.com/first.jpg',
        caption: 'First',
        author: 'Photographer',
        license: 'CC BY 4.0',
        isFallback: false,
      }),
    );
  });

  it('uses the curated fallback only when no persisted or compatibility photo exists', () => {
    const result = resolver.resolvePresentation({
      media: [],
      metadata: { category: 'tango' },
    });

    expect(result.source).toBe('CURATED_FALLBACK');
    expect(result.photos).toEqual([]);
    expect(result.primaryPhoto.isFallback).toBe(true);
  });
});
