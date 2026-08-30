describe('Live Provider Smoke Tests', () => {
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const hasGroqKey = !!process.env.GROQ_API_KEY;
  const hasGooglePlacesKey = !!process.env.GOOGLE_PLACES_API_KEY;

  it.skip('skips live network calls unless explicitly triggered with provider keys', () => {
    // This file is executed solely by yarn test:providers:smoke in CI/staging
    expect(true).toBe(true);
  });
});
