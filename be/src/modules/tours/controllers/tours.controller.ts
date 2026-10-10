import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ValidationPipe,
  NotFoundException,
} from '@nestjs/common';
import { ToursService } from '../services/tours.service';
import { TourGenerationService } from '../services/tour-generation.service';
import { TourLocationService } from '../services/tour-location.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { UpdateTourDto } from '../dto/update-tour.dto';
import { CreateTourFromWizardDto } from '../dto/create-tour-from-wizard.dto';
import { buildTourGenerationRequest } from '../utils/tour-generation-request.util';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { appConfig } from 'src/core/config/app.config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';
import { ExperienceCatalogService } from '../services/experience-catalog.service';

const NEARBY_EXPERIENCES_PAGE_SIZE = 100;

@ApiTags('tours')
@Controller('tours')
export class ToursController {
  constructor(
    private readonly toursService: ToursService,
    private readonly tourGenerationService: TourGenerationService,
    private readonly tourLocationService: TourLocationService,
    private readonly experienceCatalog: ExperienceCatalogService,
  ) {}

  @Get('experiences/nearby')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get verified Experiences near a coordinate' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number })
  async getNearbyExperiences(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 5000,
  ) {
    // The canonical PostGIS boundary, nearest first; the endpoint returns
    // one page of the nearest rows (a response size, not catalog scope).
    const experiences =
      await this.experienceCatalog.findVerifiedWithinForMatching(
        +lat,
        +lng,
        +radius,
      );
    return experiences.slice(0, NEARBY_EXPERIENCES_PAGE_SIZE);
  }

  @Get('experiences/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single verified Experience by id' })
  @ApiResponse({
    status: 404,
    description: 'Experience not found or not verified.',
  })
  async getExperienceById(@Param('id') id: string) {
    const experience = await this.experienceCatalog.findById(id);
    if (!experience) {
      throw new NotFoundException(`Experience with ID ${id} not found`);
    }
    return experience;
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new tour' })
  @ApiResponse({
    status: 201,
    description: 'The tour has been successfully created.',
  })
  @ApiBody({ type: CreateTourDto })
  create(
    @Body(ValidationPipe) createTourDto: CreateTourDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.toursService.create({ ...createTourDto, ownerId: user.id });
  }

  @Post('generate-tour')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a tour from wizard preferences',
    description:
      'Creates a basic tour structure from wizard preferences and automatically starts generating Experiences in the background.',
  })
  @ApiResponse({
    status: 201,
    description:
      'The tour has been successfully created. Experiences are being generated in the background.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data.',
  })
  @ApiBody({ type: CreateTourFromWizardDto })
  generateTour(
    @Body(ValidationPipe) createTourFromWizardDto: CreateTourFromWizardDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tourGenerationService.createTourFromWizard(
      buildTourGenerationRequest(createTourFromWizardDto),
      user.id,
    );
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get the current user's tours",
    description:
      "Tours are private per owner — this always returns only the authenticated user's own tours.",
  })
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
    @CurrentUser() user: RequestUser,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('category') category?: string,
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
    @Query('radius') radius?: number,
  ) {
    return this.toursService.findAll(
      user.id,
      +page,
      +limit,
      category,
      latitude ? +latitude : undefined,
      longitude ? +longitude : undefined,
      radius ? +radius : undefined,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a tour by ID' })
  @ApiResponse({
    status: 200,
    description: 'The tour has been successfully retrieved.',
  })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.toursService.findOne(id, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a tour' })
  @ApiResponse({
    status: 200,
    description: 'The tour has been successfully updated.',
  })
  update(
    @Param('id') id: string,
    @Body() updateTourDto: UpdateTourDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.toursService.update(id, updateTourDto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a tour' })
  @ApiResponse({
    status: 200,
    description: 'The tour has been successfully deleted.',
  })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.toursService.remove(id, user.id);
  }
}
