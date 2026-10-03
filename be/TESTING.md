# Testing & Mocking Guide

This project supports cached external-service responses to enable deterministic
and offline testing/development. The Places cache wraps whichever backend
provider `PLACES_PROVIDER` explicitly selects.

## Environment Variables

Add these to your `.env` file:

```env
# Places provider and response cache
PLACES_PROVIDER=google      # google | geoapify
USE_MOCK_MAPS=true          # Enable the legacy-named cache wrapper
MOCK_MAPS_MODE=strict       # read | write | strict

# AI Service Mocking
AI_CACHE_MODE=read          # Modes: 'read' (use cache), 'write' (call API & save), 'off' (disable cache)
```

## Modes Explained

### `read`

- **Places**: Returns a cache hit when present. On a miss it calls the selected
  live provider and does not write the response.
- **AI**: Checks `storage/ai-cache/*.json`. If found, returns response.

### `write` (Recording mode)

- **Places**: Returns a cache hit when present. On a miss it calls the selected
  live provider and saves the response to `storage/maps-cache/`.
- **AI**: Calls real AI provider. Saves response to `storage/ai-cache/`.
- Use this mode when implementing new features to generate the initial cache.

### `strict` (Strict Offline)

- **Places**: Throws on a cache miss and never calls an external provider.

Places cache keys include provider, cache schema version, method, and normalized
parameters. A Google entry can never satisfy a Geoapify request.

## How to Record New Mocks

1. Set `MOCK_MAPS_MODE=write` and `AI_CACHE_MODE=write` in `.env`.
2. Run the feature or test case manually.
3. Verify that new JSON files appear in `be/storage/maps-cache/` and `be/storage/ai-cache/`.
4. Commit these files to the repository.
5. Switch back to `read` mode.

## Running Tests

Use `strict` for deterministic tests. `read` is not offline: it intentionally
calls the live provider on a miss.

```bash
# Example for CI
export USE_MOCK_MAPS=true
export MOCK_MAPS_MODE=strict
export AI_CACHE_MODE=read
npm run test:e2e
```
