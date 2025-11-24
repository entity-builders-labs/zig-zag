import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainService } from './langchain.service';
import { ImageGenerationService } from './image-generation.service';
import aiConfig from './ai.config';
import { PrismaModule } from '../../core/database/database.module';

@Module({
  imports: [ConfigModule.forFeature(aiConfig), PrismaModule],
  providers: [LangChainService, ImageGenerationService],
  exports: [LangChainService, ImageGenerationService],
})
export class AiModule {}
