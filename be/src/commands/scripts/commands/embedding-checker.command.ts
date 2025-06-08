import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { LangChainService } from '../../../shared/ai/langchain.service';

@Injectable()
@Command({
  name: 'match-activities',
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

      this.logger.log('📖 Activity Matcher - Usage Examples:');
      this.logger.log('');
      this.logger.log('🎯 Find compatible activities by ID:');
      this.logger.log(
        '   yarn script match-activities --activity-id 676c7df01234567890123456',
      );
      this.logger.log('');
      this.logger.log('🏷️  Find activities by name:');
      this.logger.log(
        '   yarn script match-activities --activity-name "Cinema"',
      );
      this.logger.log('');
      this.logger.log('🔍 Search with custom prompt:');
      this.logger.log(
        '   yarn script match-activities --search-prompt "outdoor activities perfect after visiting a museum"',
      );
      this.logger.log('');
      this.logger.log('📂 Find by category:');
      this.logger.log(
        '   yarn script match-activities --category "restaurants"',
      );
      this.logger.log('');
      this.logger.log('⚙️  Initialize vector store first:');
      this.logger.log('   yarn script match-activities --initialize-store');
      this.logger.log('');
      this.logger.log('🎛️  Advanced options:');
      this.logger.log(
        '   yarn script match-activities --activity-id ID --number-of-results 5 --max-distance 10',
      );
    } catch (error) {
      this.logger.error('Error during embedding check:', error);
      throw error;
    }
  }
}
