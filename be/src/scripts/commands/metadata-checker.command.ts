import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivitiesService } from '../../activities/activities.service';

@Injectable()
@Command({
  name: 'check-metadata',
  description: 'Check and update metadata for all activities',
})
export class MetadataCheckerCommand extends CommandRunner {
  private readonly logger = new Logger(MetadataCheckerCommand.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
  ) {
    super();
  }

  async run(): Promise<void> {
    try {
      const activities = await this.prisma.activity.findMany({
        select: {
          id: true,
          name: true,
          metadata: true,
        },
      });

      this.logger.log(`Found ${activities.length} activities to process`);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const activity of activities) {
        try {
          this.logger.log(
            `Processing activity ${activity.id}: ${activity.name}`,
          );
          const newMetadata = await this.activitiesService.generateMetadata(
            activity.id,
          );

          if (newMetadata) {
            updated++;
            this.logger.log(
              `Successfully updated metadata for activity ${activity.id}`,
            );
          } else {
            skipped++;
            this.logger.warn(
              `No metadata generated for activity ${activity.id}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          failed++;
          this.logger.error(
            `Error processing activity ${activity.id}: ${error.message}`,
          );
        }
      }

      this.logger.log(`Summary:
        Total activities: ${activities.length}
        Updated: ${updated}
        Skipped: ${skipped}
        Failed: ${failed}
      `);
    } catch (error) {
      this.logger.error('Error during metadata check:', error);
      throw error;
    }
  }
}
