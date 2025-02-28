import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ToursService } from './tours.service';
import { CreateTourDto } from './dto/create-tour.dto';
import { UpdateTourDto } from './dto/update-tour.dto';

@Controller('tours')
export class ToursController {
  constructor(private readonly toursService: ToursService) {}

  @Post()
  create(
    @Body() { latitude, longitude }: { latitude: number; longitude: number },
  ) {
    return;
  }

  @Get()
  findAll(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.toursService.findAll(+page, +limit);
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.toursService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() updateTourDto: UpdateTourDto) {
    return this.toursService.update(id, updateTourDto);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.toursService.remove(id);
  }
}
