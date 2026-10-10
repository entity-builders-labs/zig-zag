import { Module } from '@nestjs/common';
import { PrismaModule } from '@core/database/database.module';
import { OverturePlacesIndexService } from './overture-places-index.service';

@Module({
  imports: [PrismaModule],
  providers: [OverturePlacesIndexService],
  exports: [OverturePlacesIndexService],
})
export class OvertureModule {}
