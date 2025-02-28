import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LangChainService } from '../../shared/ai/langchain.service';

@Injectable()
@Command({
  name: 'check-embeddings',
  description: 'Check and update embeddings for all activities',
})
export class EmbeddingCheckerCommand extends CommandRunner {
  private readonly logger = new Logger(EmbeddingCheckerCommand.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly langchainService: LangChainService,
  ) {
    super();
  }

  async run(): Promise<void> {
    try {
      const activities = await this.prisma.activity.findMany();
      this.logger.log(`Found ${activities.length} activities to process`);

      let updated = 0;
      let failed = 0;

      for (const activity of activities) {
        try {
          this.logger.log(
            `Processing embeddings for activity ${activity.id}: ${activity.name}`,
          );
          await this.langchainService.addActivityToVectorStore(activity);
          updated++;
          this.logger.log(
            `Successfully updated embeddings for activity ${activity.id}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          failed++;
          this.logger.error(
            `Error processing embeddings for activity ${activity.id}: ${error.message}`,
          );
        }
      }

      this.logger.log(`Summary:
        Total activities: ${activities.length}
        Updated: ${updated}
        Failed: ${failed}
      `);

      // Verify embeddings
      try {
        this.logger.log('Performing test search to verify embeddings...');
        const testResults = await this.langchainService.findSimilarActivities(
          'outdoor activities',
          5,
        );
        this.logger.log(
          `Test search successful! Found ${testResults.length} results`,
        );
      } catch (error) {
        this.logger.error('Error performing test search:', error);
      }
    } catch (error) {
      this.logger.error('Error during embedding check:', error);
      throw error;
    }
  }
}
