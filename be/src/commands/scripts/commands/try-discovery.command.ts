import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityDiscoveryService } from '@tours/services/activity-discovery.service';

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

  constructor(private readonly discoveryService: ActivityDiscoveryService) {
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

    const response = await this.discoveryService.discoverBootstrap(
      destination,
      country,
      themes,
    );

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
