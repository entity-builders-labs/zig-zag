import {
  WebSourceContentProvider,
  WebSourceContentProviderName,
} from '../interfaces/web-source-content.interface';

/**
 * Resolve the web source content provider from its already-resolved name
 * only (`WEB_SOURCE_CONTENT_PROVIDER`). Exactly one implementation is
 * returned; there is NO fallback chain, racing, fanout, health scoring, or
 * provider priority between Tavily and Cloudflare Browser Run. A selected
 * provider's failure is that provider's failure, reported per URL, and the
 * affected evidence simply keeps its original search snippet — it never
 * spends another vendor's quota.
 *
 * This switch is also the only enforcement point for the name union: an
 * unknown/misspelled `WEB_SOURCE_CONTENT_PROVIDER` fails loudly here (at
 * module wiring) instead of silently disabling evidence-depth retrieval.
 */
export function selectWebSourceContentProvider(
  provider: string | undefined | null,
  impls: Record<WebSourceContentProviderName, WebSourceContentProvider>,
): WebSourceContentProvider | undefined {
  if (!provider) {
    return undefined;
  }
  switch (provider) {
    case 'tavily':
    case 'cloudflare':
      return impls[provider];
    default:
      throw new Error(`Unsupported WEB_SOURCE_CONTENT_PROVIDER: ${provider}`);
  }
}
