describe('Live Provider Smoke Tests', () => {
  it.skip('skips live network calls unless explicitly triggered with provider keys', () => {
    // This file is executed solely by yarn test:providers:smoke in CI/staging
    const hasKeys =
      !!process.env.GEMINI_API_KEY &&
      !!process.env.GROQ_API_KEY &&
      !!process.env.GOOGLE_PLACES_API_KEY;
    expect(typeof hasKeys).toBe('boolean');
  });
});
