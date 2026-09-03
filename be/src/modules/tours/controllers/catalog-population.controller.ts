import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';
import { CatalogAdminGuard } from '../guards/catalog-admin.guard';
import { CreateCatalogPopulationJobDto } from '../dto/catalog-population.dto';
import { CatalogPopulationService } from '../services/catalog-population.service';

@ApiTags('catalog-population')
@ApiBearerAuth()
@Controller('admin/catalog-population')
@UseGuards(JwtAuthGuard, CatalogAdminGuard)
export class CatalogPopulationController {
  constructor(private readonly population: CatalogPopulationService) {}

  @Post()
  create(
    @Body(ValidationPipe) dto: CreateCatalogPopulationJobDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.population.createJob({
      ...dto,
      requestedById: user.id,
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.population.getJob(id, user.id);
  }
}
