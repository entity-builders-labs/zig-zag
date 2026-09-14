import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { databaseConfig } from './database.config';
import { appConfig } from './app.config';
import aiConfig from '../../shared/ai/ai.config';
import authConfig from './auth.config';
import dailyPlanningPolicyConfig from '../../modules/tours/config/daily-planning-policy.config';
import * as path from 'path';

const runningFromBackend = path.basename(process.cwd()) === 'be';
const rootEnvPath = runningFromBackend
  ? path.resolve(process.cwd(), '..', '.env')
  : path.resolve(process.cwd(), '.env');
const backendEnvPath = runningFromBackend
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'be', '.env');

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Resolve from the process working directory so compiled dist code does
      // not accidentally look for an env file under be/dist. Root .env owns
      // shared provider credentials; an optional be/.env remains supported.
      envFilePath: [rootEnvPath, backendEnvPath],
      load: [
        appConfig,
        databaseConfig,
        aiConfig,
        authConfig,
        dailyPlanningPolicyConfig,
      ],
    }),
  ],
})
export class ConfigModule {}
