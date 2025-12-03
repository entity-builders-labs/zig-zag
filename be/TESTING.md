# Testing & Mocking Guide

This project supports mocking external services (Google Maps API and AI Providers) to enable cost-free, deterministic, and offline testing/development.

## Environment Variables

Add these to your `.env` file:

```env
# Google Maps Mocking
USE_MOCK_MAPS=true          # Enable mocking layer
MOCK_MAPS_MODE=read         # Modes: 'read' (use cache), 'write' (call API & save), 'strict' (error on miss)
ALLOW_API_FALLBACK=true     # If true, 'read' mode will call API on cache miss (like 'write' but without saving?) - Actually handled by logic

# AI Service Mocking
AI_CACHE_MODE=read          # Modes: 'read' (use cache), 'write' (call API & save), 'off' (disable cache)
```

## Modes Explained

### `read` (Default recommended for tests)

- **Google Maps**: Checks `storage/maps-cache/*.json`. If found, returns data. If missing, behavior depends on implementation (currently warns and may return empty or fail depending on config).
- **AI**: Checks `storage/ai-cache/*.json`. If found, returns response.

### `write` (Recording mode)

- **Google Maps**: Calls real Google API. Saves response to `storage/maps-cache/`.
- **AI**: Calls real AI provider. Saves response to `storage/ai-cache/`.
- Use this mode when implementing new features to generate the initial cache.

### `strict` (Strict Offline)

- **Google Maps**: Throws error if cache is missing. Ensures no accidental API calls.

## How to Record New Mocks

1. Set `MOCK_MAPS_MODE=write` and `AI_CACHE_MODE=write` in `.env`.
2. Run the feature or test case manually.
3. Verify that new JSON files appear in `be/storage/maps-cache/` and `be/storage/ai-cache/`.
4. Commit these files to the repository.
5. Switch back to `read` mode.

## Running Tests

Ensure your environment is set to `read` or `strict` before running tests to guarantee determinism.

```bash
# Example for CI
export USE_MOCK_MAPS=true
export MOCK_MAPS_MODE=strict
export AI_CACHE_MODE=read
npm run test:e2e
```
