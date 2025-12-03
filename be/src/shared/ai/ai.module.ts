import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainService } from './langchain.service';
import { ImageGenerationService } from './image-generation.service';
import { PrismaModule } from '../../core/database/database.module';
import aiConfig from './ai.config';
import { AiCacheService } from './services/ai-cache.service';

@Module({
  imports: [ConfigModule.forFeature(aiConfig), PrismaModule],
  providers: [LangChainService, ImageGenerationService, AiCacheService],
  exports: [LangChainService, ImageGenerationService, AiCacheService],
})
export class AiModule {}
