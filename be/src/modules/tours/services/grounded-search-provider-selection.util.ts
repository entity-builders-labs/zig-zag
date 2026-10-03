import { ExperienceGroundedSearchProvider } from '../interfaces/experience-grounding.interface';

export type GroundedSearchProviderName =
  | 'serpapi'
  | 'serper'
  | 'groq'
  | 'tavily'
  | 'gemini';

/**
 * Resolve the grounded search provider from its already-resolved name only.
 * Exactly one implementation is returned; there is no fallback chain between
 * providers (in particular none between SerpApi and Serper), so a selected
 * provider's failure is reported as that provider's failure and never spends
 * another provider's quota.
 */
export function selectGroundedSearchProvider(
  provider: string,
  impls: Record<GroundedSearchProviderName, ExperienceGroundedSearchProvider>,
): ExperienceGroundedSearchProvider {
  switch (provider) {
    case 'serpapi':
    case 'serper':
    case 'groq':
    case 'tavily':
    case 'gemini':
      return impls[provider];
    default:
      throw new Error(`Unsupported GROUNDED_SEARCH_PROVIDER: ${provider}`);
  }
}
