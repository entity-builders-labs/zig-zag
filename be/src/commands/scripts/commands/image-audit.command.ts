import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { ActivityMetadataService } from '../../../modules/activities/services/activity-metadata.service';
import { ToursService } from '../../../modules/tours/services/tours.service';

interface ImageAuditOptions {
  fix?: boolean;
}

@Injectable()
@Command({
  name: 'audit-images',
  description: 'Check for missing images in tours and activities',
})
export class ImageAuditCommand extends CommandRunner {
  private readonly logger = new Logger(ImageAuditCommand.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityMetadataService: ActivityMetadataService,
    private readonly toursService: ToursService,
  ) {
    super();
  }

  async run(inputs: string[], options: ImageAuditOptions): Promise<void> {
    // Use console.log to ensure it's always visible
    console.log('\n🔍 ========================================');
    console.log('🔍 Starting image audit...');
    console.log(`🔍 Options received: ${JSON.stringify(options)}`);
    console.log(`🔍 Fix mode: ${options.fix ? 'ENABLED ✅' : 'DISABLED ❌'}`);
    console.log('🔍 ========================================\n');

    this.logger.log('Starting image audit...');
    this.logger.log(`Options received: ${JSON.stringify(options)}`);
    this.logger.log(`Fix mode: ${options.fix ? 'ENABLED' : 'DISABLED'}`);

    try {
      // 1. Check Tours
      const toursWithoutCover = await this.prisma.tour.findMany({
        where: {
          OR: [{ coverImage: null }, { coverImage: '' }],
        },
        select: { id: true, name: true, coverImage: true },
      });

      this.logger.log(
        `Found ${toursWithoutCover.length} tours without cover image.`,
      );
      if (toursWithoutCover.length > 0) {
        toursWithoutCover
          .slice(0, 20)
          .forEach((t) => this.logger.warn(`- Tour [${t.id}]: ${t.name}`));
        if (toursWithoutCover.length > 20) {
          this.logger.warn(
            `...and ${toursWithoutCover.length - 20} more tours.`,
          );
        }
      }

      // 2. Check Activities
      // Fetch activities to check for missing photos (empty array or null)
      const allActivities = await this.prisma.activity.findMany({
        select: {
          id: true,
          name: true,
          photos: true,
          type: true,
          description: true,
        },
      });

      const missingPhotoActivities = allActivities.filter((a) => {
        if (!a.photos) return true;
        if (a.photos === null) return true;
        if (Array.isArray(a.photos) && a.photos.length === 0) return true;
        return false;
      });

      this.logger.log(
        `Found ${missingPhotoActivities.length} activities without photos.`,
      );
      if (missingPhotoActivities.length > 0) {
        missingPhotoActivities
          .slice(0, 10)
          .forEach((a) =>
            this.logger.warn(
              `- Activity [${a.id}]: ${a.name} (showing first 10)`,
            ),
          );
        if (missingPhotoActivities.length > 10) {
          this.logger.warn(
            `...and ${missingPhotoActivities.length - 10} more.`,
          );
        }
      }

      // Fix if requested
      this.logger.log(`Checking if fix is enabled: ${options.fix}`);
      if (options.fix) {
        this.logger.log('✅ Fix mode enabled - Starting image generation...');

        // Fix Tours
        if (toursWithoutCover.length > 0) {
          this.logger.log(
            `Attempting to generate cover images for ${toursWithoutCover.length} tours...`,
          );
          let toursFixed = 0;
          let toursFailed = 0;
          for (const tour of toursWithoutCover) {
            try {
              this.logger.log(
                `Generating cover image for Tour ${tour.id} (${tour.name})...`,
              );
              const result = await this.toursService.generateTourCoverImage(
                tour.id,
              );
              if (result) {
                toursFixed++;
                this.logger.log(`✓ Generated cover image for Tour ${tour.id}`);
                // Add delay to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 2000));
              } else {
                toursFailed++;
                this.logger.warn(
                  `✗ Failed to generate (null result) for Tour ${tour.id}`,
                );
              }
            } catch (e: any) {
              toursFailed++;
              this.logger.error(
                `Error generating image for Tour ${tour.id}: ${e.message}`,
              );
            }
          }
          this.logger.log(
            `Tour images: ${toursFixed} fixed, ${toursFailed} failed`,
          );
        }

        // Fix Activities
        if (missingPhotoActivities.length > 0) {
          this.logger.log(
            `Attempting to generate images for ${missingPhotoActivities.length} activities...`,
          );
          let activitiesFixed = 0;
          let activitiesFailed = 0;
          for (const activity of missingPhotoActivities) {
            try {
              this.logger.log(
                `\n🔄 [${activitiesFixed + activitiesFailed + 1}/${missingPhotoActivities.length}] Generating image for Activity ${activity.id} (${activity.name})...`,
              );
              const imageUrl =
                await this.activityMetadataService.generateActivityImage(
                  activity,
                );
              if (imageUrl) {
                this.logger.log(`💾 Saving image URL to database...`);
                await this.prisma.activity.update({
                  where: { id: activity.id },
                  data: { photos: [imageUrl] },
                });
                activitiesFixed++;
                this.logger.log(
                  `✅ Saved image for Activity ${activity.id} (${activity.name})`,
                );
                // Add delay to avoid rate limiting
                this.logger.log(
                  `⏳ Waiting 2 seconds before next generation...`,
                );
                await new Promise((resolve) => setTimeout(resolve, 2000));
              } else {
                activitiesFailed++;
                this.logger.warn(
                  `❌ Failed to generate (null result) for Activity ${activity.id} (${activity.name})`,
                );
              }
            } catch (e: any) {
              activitiesFailed++;
              this.logger.error(
                `❌ Error generating image for Activity ${activity.id}: ${e.message}`,
              );
              this.logger.error(e.stack);
            }
          }
          this.logger.log(
            `Activity images: ${activitiesFixed} fixed, ${activitiesFailed} failed`,
          );
        }

        // Summary
        this.logger.log('\n=== Summary ===');
        this.logger.log(`Tours processed: ${toursWithoutCover.length}`);
        this.logger.log(
          `Activities processed: ${missingPhotoActivities.length}`,
        );
      } else {
        this.logger.log(`Fix mode is ${options.fix ? 'ENABLED' : 'DISABLED'}`);
        if (toursWithoutCover.length > 0 || missingPhotoActivities.length > 0) {
          this.logger.log(
            '\n💡 To fix these issues, run: yarn script audit-images -- --fix',
          );
        } else {
          this.logger.log('✅ All clean! No missing images found.');
        }
      }
    } catch (error: any) {
      this.logger.error(`Error during image audit: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  @Option({
    flags: '-f, --fix',
    description: 'Attempt to generate missing images',
  })
  parseFix(): boolean {
    return true;
  }
}
