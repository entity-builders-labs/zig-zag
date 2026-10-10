import {
  DiscoveryStructuredCompletion,
  ExperienceDiscoveryExtractor,
  ExperienceDiscoveryRequest,
} from '../interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from '../interfaces/experience-grounding.interface';
import { recoverComponentLocalities } from '../utils/component-locality-recovery.util';

/**
 * The discovery extractor the application uses: the configured provider's
 * extraction followed by source locality recovery (§19.1) on the same
 * provider and the same evidence. This is the only place the step runs, so
 * every provider gets the same semantics and none carries its own copy.
 */
export class LocalityRecoveringDiscoveryExtractor
  implements ExperienceDiscoveryExtractor
{
  constructor(
    private readonly extractor: ExperienceDiscoveryExtractor &
      DiscoveryStructuredCompletion,
  ) {}

  async extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: ExperienceGroundedSearchResult,
    options?: { bypassCache?: boolean },
  ): ReturnType<ExperienceDiscoveryExtractor['extractExperiences']> {
    const extraction = await this.extractor.extractExperiences(
      request,
      searchResult,
      options,
    );
    if (extraction.extractionFailures.length > 0) return extraction;
    const recovered = await recoverComponentLocalities(
      extraction,
      (searchResult.evidence ?? []).map((item) => ({
        key: item.key,
        title: item.title,
        text: item.snippet,
      })),
      (completion) => this.extractor.completeStructured(completion),
    );
    return { ...extraction, ...recovered };
  }
}
