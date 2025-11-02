import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ToursService } from '../services/tours.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { UpdateTourDto } from '../dto/update-tour.dto';
import { CreateTourFromPromptDto } from '../dto/create-tour-from-prompt.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('tours')
@Controller('tours')
export class ToursController {
  constructor(private readonly toursService: ToursService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new tour' })
  @ApiResponse({
    status: 201,
    description: 'The tour has been successfully created.',
  })
  @ApiBody({ type: CreateTourDto })
  create(@Body(ValidationPipe) createTourDto: CreateTourDto) {
    return this.toursService.create(createTourDto);
  }

  @Post('from-prompt')
  @ApiOperation({
    summary: 'Generate a tour from a natural language prompt using AI',
    description:
      'Uses LangChain and OpenAI to generate a structured tour from a natural language prompt. Optionally searches for existing activities based on location.',
  })
  @ApiResponse({
    status: 201,
    description: 'The tour has been successfully generated and created.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or AI generation failed.',
  })
  @ApiBody({ type: CreateTourFromPromptDto })
  createFromPrompt(
    @Body(ValidationPipe) createTourFromPromptDto: CreateTourFromPromptDto,
  ) {
    return this.toursService.createFromPrompt(createTourFromPromptDto.prompt, {
      latitude: createTourFromPromptDto.latitude,
      longitude: createTourFromPromptDto.longitude,
      radius: createTourFromPromptDto.radius,
      includeExistingActivities:
        createTourFromPromptDto.includeExistingActivities !== false, // default true
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all tours' })
  @ApiResponse({
    status: 200,
    description: 'The tours have been successfully retrieved.',
  })
  findAll(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.toursService.findAll(+page, +limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tour by ID' })
  @ApiResponse({
    status: 200,
    description: 'The tour has been successfully retrieved.',
  })
  findOne(@Param('id') id: string) {
    return this.toursService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tour' })
  @ApiResponse({
    status: 200,
    description: 'The tour has been successfully updated.',
  })
  update(@Param('id') id: string, @Body() updateTourDto: UpdateTourDto) {
    return this.toursService.update(id, updateTourDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a tour' })
  @ApiResponse({
    status: 200,
    description: 'The tour has been successfully deleted.',
  })
  remove(@Param('id') id: string) {
    return this.toursService.remove(id);
  }
}
