import { Module, Global } from '@nestjs/common';
import { NegativeCacheService } from './services/negative-cache.service';
import { WikimediaCommonsService } from './services/wikimedia-commons.service';
import { MediaPresentationResolver } from './services/media-presentation.resolver';
import { MediaEnrichmentProcessorService } from './services/media-enrichment-processor.service';
import { PrismaService } from '../../core/database/prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    NegativeCacheService,
    WikimediaCommonsService,
    MediaPresentationResolver,
    MediaEnrichmentProcessorService,
  ],
  exports: [
    NegativeCacheService,
    WikimediaCommonsService,
    MediaPresentationResolver,
    MediaEnrichmentProcessorService,
  ],
})
export class MediaModule {}
