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
});
