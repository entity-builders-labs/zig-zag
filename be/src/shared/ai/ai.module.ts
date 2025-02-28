import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainService } from './langchain.service';
import aiConfig from './ai.config';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [ConfigModule.forFeature(aiConfig), PrismaModule],
  providers: [LangChainService],
  exports: [LangChainService],
})
export class AiModule {}
