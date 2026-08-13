import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { VectorStoreService } from 'src/shared/ai/services/vector-store.service';

interface EmbeddingCheckerOptions {
  searchPrompt?: string;
}

@Injectable()
@Command({
  name: 'match-activities',
  description: 'Rebuild pgvector embeddings for all activities',
})
export class EmbeddingCheckerCommand extends CommandRunner {
  private readonly logger = new Logger(EmbeddingCheckerCommand.name);

  constructor(private readonly vectorStoreService: VectorStoreService) {
    super();
  }

  async run(
    _inputs: string[],
    options: EmbeddingCheckerOptions,
  ): Promise<void> {
    try {
      const { count } = await this.vectorStoreService.rebuildVectorStore();
      this.logger.log(`Rebuilt embeddings for ${count} activities`);

      const searchPrompt = options.searchPrompt || 'outdoor activities';
      this.logger.log(`Performing test search: "${searchPrompt}"...`);
      const testResults = await this.vectorStoreService.findSimilarActivities(
        searchPrompt,
        5,
      );
      this.logger.log(`Test search found ${testResults.length} results`);
      testResults.forEach((result, i) => {
        this.logger.log(
          `  ${i + 1}. ${result.metadata.activityName} (distance: ${result.metadata.distance})`,
        );
      });

      this.logger.log('');
      this.logger.log('Usage:');
      this.logger.log(
        '  yarn script match-activities                          # rebuild all embeddings',
      );
      this.logger.log(
        '  yarn script match-activities --search-prompt "museums" # rebuild, then test-search with a custom prompt',
      );
    } catch (error) {
      this.logger.error('Error during embedding check:', error);
      throw error;
    }
  }

  @Option({
    flags: '-s, --search-prompt <prompt>',
    description:
      'Run the post-rebuild test search with this prompt instead of the default "outdoor activities"',
  })
  parseSearchPrompt(val: string): string {
    return val;
  }
}
