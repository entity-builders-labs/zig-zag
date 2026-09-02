import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { GROUNDED_SEARCH_PROVIDER, GroundedSearchProvider, DISCOVERY_PROVIDER, SearchGroundedDiscoveryProvider } from '@tours/interfaces/activity-discovery.interface';
import { ExperienceDiscoveryPlannerService } from '@tours/services/experience-discovery-planner.service';

interface TryDiscoveryOptions {
  destination?: string;
  country?: string;
  themes?: string;
}

/**
 * Manual smoke test for grounded Activity Discovery: runs the real two-step
 * flow (GROUNDED_SEARCH_PROVIDER for evidence, then GroqDiscoveryProvider for
 * structured extraction) against live APIs and prints the raw response for
 * manual inspection. Useful whenever the discovery contract, prompt, or
 * grounded-search provider changes and needs a real-API check beyond mocks.
 */
@Injectable()
@Command({
  name: 'try-discovery',
  description: 'Manually verify grounded Activity Discovery against real APIs',
})
export class TryDiscoveryCommand extends CommandRunner {
  private readonly logger = new Logger(TryDiscoveryCommand.name);

  constructor(
    @Inject(GROUNDED_SEARCH_PROVIDER) private readonly searchProvider: GroundedSearchProvider,
    @Inject(DISCOVERY_PROVIDER) private readonly discoveryProvider: SearchGroundedDiscoveryProvider,
    private readonly planner: ExperienceDiscoveryPlannerService,
  ) {
    super();
  }

  async run(_inputs: string[], options: TryDiscoveryOptions): Promise<void> {
    const { destination, country } = options;
    if (!destination) {
      throw new Error(
        'Usage: yarn script try-discovery --destination="Salta" [--country=Argentina] [--themes=history,nature]',
      );
    }
    const themes = options.themes
      ? options.themes.split(',').map((t) => t.trim())
      : ['history', 'culture'];

    this.logger.log(
      `Running discoverBootstrap for "${destination}"${country ? `, ${country}` : ''} — themes: ${themes.join(', ')}`,
    );

    const plan = this.planner.plan({ scope: { destinationName: destination }, requestedThemes: themes, breadth: 'broad', maxCandidates: 8 });
    const grounded = await this.searchProvider.search({ destinationName: destination, destinationCountry: country, requestedThemes: themes, query: plan.queries[0]?.query || `${destination} tourism` });
    const response = await this.discoveryProvider.discover({ destinationName: destination, destinationCountry: country, requestedThemes: themes, mode: { type: 'bootstrap', reason: 'new_destination' }, maxProposals: 8 }, grounded);

    console.log(JSON.stringify(response, null, 2));
  }

  @Option({
    flags: '--destination <destination>',
    description: 'Destination name (e.g. "Salta")',
  })
  parseDestination(val: string): string {
    return val;
  }

  @Option({
    flags: '--country <country>',
    description: 'Destination country (e.g. "Argentina")',
  })
  parseCountry(val: string): string {
    return val;
  }

  @Option({
    flags: '--themes <themes>',
    description: 'Comma-separated themes (default: history,culture)',
  })
  parseThemes(val: string): string {
    return val;
  }
}
