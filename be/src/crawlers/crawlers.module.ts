import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { GoogleMapsController } from './google-maps/google-maps.controller';
import { GoogleMapsService } from './google-maps/google-maps.service';
import { CommandsModule } from './commands/commands.module';
import { ActivitiesModule } from 'src/activities/activities.module';
import { AiModule } from 'src/shared/ai/ai.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    forwardRef(() => CommandsModule),
    ActivitiesModule,
    AiModule,
  ],
  controllers: [GoogleMapsController],
  providers: [GoogleMapsService],
  exports: [GoogleMapsService],
})
export class CrawlersModule {}
