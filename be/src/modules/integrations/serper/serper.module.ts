import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SerperApiService } from './services/serper-api.service';

@Module({
  imports: [ConfigModule],
  providers: [SerperApiService],
  exports: [SerperApiService],
})
export class SerperModule {}
