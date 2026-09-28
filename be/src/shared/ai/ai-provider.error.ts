/**
 * Normalized typed provider error thrown at the AI provider boundary.
 * Captures HTTP status and provider-specific status codes (e.g. Gemini UNAVAILABLE)
 * while preserving message format for compatibility.
 */
export class AiProviderError extends Error {
  public readonly provider: string;
  public readonly httpStatus?: number;
  public readonly providerStatus?: string;
  public readonly cause?: unknown;

  constructor(options: {
    message: string;
    provider: string;
    httpStatus?: number;
    providerStatus?: string;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'AiProviderError';
    this.provider = options.provider;
    this.httpStatus = options.httpStatus;
    this.providerStatus = options.providerStatus;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}
