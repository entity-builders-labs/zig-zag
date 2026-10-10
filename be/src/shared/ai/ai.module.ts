import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainService } from './langchain.service';
import { ImageGenerationService } from './image-generation.service';
import { PrismaModule } from '../../core/database/database.module';
import aiConfig from './ai.config';
import { AiCacheService } from './services/ai-cache.service';
import { AiEmbeddingService } from './services/ai-embedding.service';
import { ExperienceVectorStoreService } from './services/experience-vector-store.service';
import { ExperienceEmbeddingIndexerService } from './services/experience-embedding-indexer.service';

@Module({
  imports: [ConfigModule.forFeature(aiConfig), PrismaModule],
  providers: [
    LangChainService,
    ImageGenerationService,
    AiCacheService,
    AiEmbeddingService,
    ExperienceVectorStoreService,
    ExperienceEmbeddingIndexerService,
  ],
  exports: [
    LangChainService,
    ImageGenerationService,
    AiCacheService,
    AiEmbeddingService,
    ExperienceVectorStoreService,
    ExperienceEmbeddingIndexerService,
  ],
})
export class AiModule {}
