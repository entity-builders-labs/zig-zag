import { classifyGenerationFailure } from './generation-failure-classifier.util';

describe('classifyGenerationFailure', () => {
  it.each([
    [new Error('429 Too Many Requests'), 'RATE_LIMITED'],
    [new Error('provider timed out after 10000ms'), 'TIMEOUT'],
    [
      Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
      'NETWORK_TRANSIENT',
    ],
    [{ message: 'unavailable', response: { status: 503 } }, 'HTTP_TRANSIENT'],
  ])(
    'classifies transient infrastructure failures as retryable',
    (error, reasonCode) => {
      expect(classifyGenerationFailure(error)).toEqual(
        expect.objectContaining({ retryable: true, reasonCode }),
      );
    },
  );

  it('uses persisted provider-error trace as retry evidence when the wrapper message lost the original cause', () => {
    const classification = classifyGenerationFailure(
      new Error('Coverage insuficiente después de adquisición acotada'),
      {
        generationTrace: {
          steps: [
            {
              stage: 'discovery',
              providerStatus: 'failed',
              degradedReason: 'provider_timeout',
            },
          ],
        },
      },
    );

    expect(classification).toEqual(
      expect.objectContaining({
        retryable: true,
        reasonCode: 'PROVIDER_TRANSIENT',
      }),
    );
  });

  it.each([
    'No feasible itinerary',
    'Missing canonical generation request',
    'Coverage insufficient because requested trait does not exist',
  ])('keeps deterministic/domain failure terminal: %s', (message) => {
    expect(classifyGenerationFailure(new Error(message))).toEqual(
      expect.objectContaining({ retryable: false, reasonCode: 'TERMINAL' }),
    );
  });

  it('honors an explicit retryable:false on the error even when an unrelated earlier trace step looks provider-caused', () => {
    // Real bug reproduction: a Groq 429 during preference_interpretation
    // (already handled gracefully via deterministic fallback, unrelated to
    // why generation ultimately failed) used to poison the whole-trace scan
    // and make a genuinely empty/permanent coverage gap (e.g. a destination
    // with zero catalog Experiences) retry forever instead of terminating.
    const coverageError = Object.assign(
      new Error(
        'Coverage insuficiente después de catálogo, discovery enfocado y adquisición acotada: insufficient_usable_candidates',
      ),
      { retryable: false },
    );

    const classification = classifyGenerationFailure(coverageError, {
      generationTrace: {
        steps: [
          {
            stage: 'preference_interpretation',
            error: 'Groq error 429: rate_limit_exceeded',
          },
        ],
      },
    });

    expect(classification).toEqual(
      expect.objectContaining({ retryable: false, reasonCode: 'TERMINAL' }),
    );
  });

  it('honors an explicit retryable:true on the error even with no trace evidence at all', () => {
    const providerDegradedError = Object.assign(
      new Error('Coverage insuficiente después de catálogo...'),
      { retryable: true },
    );

    expect(classifyGenerationFailure(providerDegradedError)).toEqual(
      expect.objectContaining({
        retryable: true,
        reasonCode: 'PROVIDER_TRANSIENT',
      }),
    );
  });
});
