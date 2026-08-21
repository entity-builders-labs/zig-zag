import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ActivitiesService } from '../services/activities.service';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { UpdateActivityDto } from '../dto/update-activity.dto';
import { FindNearbyDto } from '../dto/find-nearby.dto';
import { HybridSearchService } from '../services/hybrid-search.service';
import { HybridSearchDto } from '../dto/hybrid-search.dto';
import {
  ActivityResponseDto,
  ActivitySearchResponseDto,
} from '../dto/activity-response.dto';
import { FindAllActivitiesDto } from '../dto/find-all-activities.dto';
import { Activity } from '@prisma/client';

@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly hybridSearchService: HybridSearchService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new activity' })
  @ApiResponse({
    status: 201,
    description: 'The activity has been successfully created.',
    type: ActivityResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data.',
  })
  async create(
    @Body() createActivityDto: CreateActivityDto,
  ): Promise<Activity> {
    return this.activitiesService.create(createActivityDto);
  }

  @Get('all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all activities with optional filters' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of activities.',
    type: [ActivityResponseDto],
  })
  @ApiQuery({ name: 'latitude', required: false, type: Number })
  @ApiQuery({ name: 'longitude', required: false, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'types', required: false, type: [String] })
  async findAll(@Query() query: FindAllActivitiesDto) {
    return this.activitiesService.findAll(
      query.latitude ?? '-34.5748341',
      query.longitude ?? '-58.4084219',
      query.radius ?? 50000,
      query.limit ?? 100,
      query.types,
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get an activity by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the activity',
    type: ActivityResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async findOne(@Param('id') id: string) {
    return this.activitiesService.findOneWithWaypoints(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an activity' })
  @ApiResponse({
    status: 200,
    description: 'Activity has been updated',
    type: ActivityResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async update(
    @Param('id') id: string,
    @Body() updateActivityDto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(id, updateActivityDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an activity' })
  @ApiResponse({
    status: 200,
    description: 'Activity has been deleted',
    type: ActivityResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async remove(@Param('id') id: string) {
    return this.activitiesService.remove(id);
  }

  @Post('nearby')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find activities near a location' })
  @ApiResponse({
    status: 200,
    description: 'Returns nearby activities',
    type: [ActivityResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async findNearby(@Body() findNearbyDto: FindNearbyDto) {
    return this.activitiesService.findNearbyActivities(findNearbyDto);
  }

  @Get(':id/similar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get similar activities by vector similarity' })
  @ApiResponse({
    status: 200,
    description: 'Returns similar activities',
    type: [ActivityResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of similar activities to return',
  })
  async getSimilar(
    @Param('id') id: string,
    @Query('limit') limit: number = 10,
  ) {
    return this.activitiesService.findSimilar(id, Number(limit));
  }

  @Post('search-hybrid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search activities with background crawling' })
  @ApiResponse({
    status: 200,
    description: 'Returns activities with crawling status',
    type: ActivitySearchResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async searchWithCrawling(@Body() searchDto: HybridSearchDto) {
    return this.hybridSearchService.searchActivitiesWithCrawling(searchDto);
  }
}
