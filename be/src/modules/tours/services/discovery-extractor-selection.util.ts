import { DiscoveryExtractorProvider } from '@shared/ai/ai.config';
import {
  DiscoveryStructuredCompletion,
  ExperienceDiscoveryExtractor,
} from '../interfaces/experience-discovery.interface';

type DiscoveryExtractorImpl = ExperienceDiscoveryExtractor &
  DiscoveryStructuredCompletion;

/**
 * Resolve the grounded discovery extractor purely from
 * `DISCOVERY_EXTRACTOR_PROVIDER`. This function deliberately takes **only** the
 * discovery-extractor provider string and the four implementations — it never
 * reads `AI_PROVIDER` or any other global — so the extractor's transport and
 * model cannot be silently switched by the general chat provider setting.
 */
export function selectDiscoveryExtractor(
  provider: DiscoveryExtractorProvider,
  impls: {
    gemini: DiscoveryExtractorImpl;
    groq: DiscoveryExtractorImpl;
    ollama: DiscoveryExtractorImpl;
    cloudflare: DiscoveryExtractorImpl;
  },
): DiscoveryExtractorImpl {
  switch (provider) {
    case 'gemini':
      return impls.gemini;
    case 'groq':
      return impls.groq;
    case 'ollama':
      return impls.ollama;
    case 'cloudflare':
      return impls.cloudflare;
    default:
      throw new Error(
        `Unsupported DISCOVERY_EXTRACTOR_PROVIDER: ${provider as string}`,
      );
  }
}
