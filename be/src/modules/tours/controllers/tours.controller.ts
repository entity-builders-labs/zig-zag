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
import { TourGenerationService } from '../services/tour-generation.service';
import { TourActivityGenerationService } from '../services/tour-activity-generation.service';
import { TourLocationService } from '../services/tour-location.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { UpdateTourDto } from '../dto/update-tour.dto';
import { CreateTourFromPromptDto } from '../dto/create-tour-from-prompt.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { appConfig } from 'src/core/config/app.config';

@ApiTags('tours')
@Controller('tours')
export class ToursController {
  constructor(
    private readonly toursService: ToursService,
    private readonly tourGenerationService: TourGenerationService,
    private readonly tourActivityGenerationService: TourActivityGenerationService,
    private readonly tourLocationService: TourLocationService,
  ) {}

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

  @Post('generate-tour')
  @ApiOperation({
    summary: 'Create a tour from wizard preferences',
    description:
      'Creates a basic tour structure from wizard preferences and automatically starts generating activities in the background.',
  })
  @ApiResponse({
    status: 201,
    description:
      'The tour has been successfully created. Activities are being generated in the background.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data.',
  })
  @ApiBody({ type: CreateTourFromPromptDto })
  generateTour(
    @Body(ValidationPipe) createTourFromPromptDto: CreateTourFromPromptDto,
  ) {
    return this.tourGenerationService.createTourFromWizard({
      latitude: createTourFromPromptDto.latitude,
      longitude: createTourFromPromptDto.longitude,
      radius: createTourFromPromptDto.radius,
      includeExistingActivities:
        createTourFromPromptDto.includeExistingActivities !== false, // default true
      days: createTourFromPromptDto.days,
      budgetLevel: createTourFromPromptDto.budgetLevel,
      interests: createTourFromPromptDto.interests,
      transportationMode: createTourFromPromptDto.transportationMode,
      groupType: createTourFromPromptDto.groupType,
      travelPace: createTourFromPromptDto.travelPace,
      dietaryRestrictions: createTourFromPromptDto.dietaryRestrictions,
      destination: createTourFromPromptDto.destination,
      destinationLatitude: createTourFromPromptDto.destinationLatitude,
      destinationLongitude: createTourFromPromptDto.destinationLongitude,
      skipImageGeneration:
        createTourFromPromptDto.skipImageGeneration !== false, // default true
      // New fields for auto-prompt generation
      name: createTourFromPromptDto.name,
      description: createTourFromPromptDto.description,
      totalDistance: createTourFromPromptDto.totalDistance,
      price: createTourFromPromptDto.price,
      estimatedBudget: createTourFromPromptDto.estimatedBudget,
      maxGroupSize: createTourFromPromptDto.maxGroupSize,
      recommendedGroupSize: createTourFromPromptDto.recommendedGroupSize,
      startDates: createTourFromPromptDto.startDates,
      categories: createTourFromPromptDto.categories,
      excludeTours: createTourFromPromptDto.excludeTours,
    });
  }

  @Post(':id/generate-activities')
  @ApiOperation({
    summary: 'Generate activities for an existing tour',
    description:
      'Generates activities in the background for a tour that was created with skipActivities=true',
  })
  @ApiResponse({
    status: 200,
    description: 'Activities have been successfully generated.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or activities already generated.',
  })
  @ApiResponse({
    status: 404,
    description: 'Tour not found.',
  })
  generateActivities(@Param('id') id: string) {
    return this.tourActivityGenerationService.generateTourActivities(id);
  }

  @Get('nearby')
  @ApiOperation({
    summary: 'Get nearby tours by category',
    description:
      'Finds existing tours or generates new ones near a location matching a category (e.g. walking)',
  })
  @ApiQuery({
    name: 'lat',
    required: true,
    type: Number,
    description: 'Latitude',
    example: appConfig().defaults.location.latitude,
  })
  @ApiQuery({
    name: 'lng',
    required: true,
    type: Number,
    description: 'Longitude',
    example: appConfig().defaults.location.longitude,
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Tour category (e.g. history, food)',
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    type: Number,
    description: 'Search radius in meters',
    schema: { default: 5000 },
  })
  getNearby(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('category') category?: string,
    @Query('radius') radius?: number,
  ) {
    return this.tourLocationService.getNearbyTours(
      +lat,
      +lng,
      category,
      radius ? +radius : undefined,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all tours' })
  @ApiResponse({
    status: 200,
    description: 'The tours have been successfully retrieved.',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Filter tours by category (e.g., walking, history, food)',
  })
  @ApiQuery({
    name: 'latitude',
    required: false,
    type: Number,
    description: 'Filter tours by latitude',
  })
  @ApiQuery({
    name: 'longitude',
    required: false,
    type: Number,
    description: 'Filter tours by longitude',
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    type: Number,
    description: 'Search radius in meters',
  })
  findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('category') category?: string,
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
    @Query('radius') radius?: number,
  ) {
    return this.toursService.findAll(
      +page,
      +limit,
      category,
      latitude ? +latitude : undefined,
      longitude ? +longitude : undefined,
      radius ? +radius : undefined,
    );
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
