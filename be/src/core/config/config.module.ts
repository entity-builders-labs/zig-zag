import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { databaseConfig } from './database.config';
import { appConfig } from './app.config';
import aiConfig from '../../shared/ai/ai.config';
import authConfig from './auth.config';
import * as path from 'path';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Try .env in be/ directory first, then root monorepo directory
      envFilePath: [
        path.join(__dirname, '../../..', '.env'), // Root monorepo .env
        '.env', // Local .env in be/ directory
      ],
      load: [appConfig, databaseConfig, aiConfig, authConfig],
    }),
  ],
})
export class ConfigModule {}
