import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainService } from './langchain.service';
import { ImageGenerationService } from './image-generation.service';
import { PrismaModule } from '../../core/database/database.module';
import aiConfig from './ai.config';
import { AiCacheService } from './services/ai-cache.service';
import { AiEmbeddingService } from './services/ai-embedding.service';
import { SemanticActivityDocumentBuilder } from './services/semantic-activity-document-builder.service';
import { VectorStoreService } from './services/vector-store.service';

@Module({
  imports: [ConfigModule.forFeature(aiConfig), PrismaModule],
  providers: [
    LangChainService,
    ImageGenerationService,
    AiCacheService,
    AiEmbeddingService,
    SemanticActivityDocumentBuilder,
    VectorStoreService,
  ],
  exports: [
    LangChainService,
    ImageGenerationService,
    AiCacheService,
    AiEmbeddingService,
    SemanticActivityDocumentBuilder,
    VectorStoreService,
  ],
})
export class AiModule {}
