import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ValidationPipe,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ActivitiesService } from '../services/activities.service';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { UpdateActivityDto } from '../dto/update-activity.dto';
import { FindNearbyDto } from '../dto/find-nearby.dto';
import { ActivityRelationshipService } from '../services/activity-relationship.service';
import { HybridSearchService } from '../services/hybrid-search.service';
import { HybridSearchDto } from '../dto/hybrid-search.dto';

@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  private readonly logger = new Logger(ActivitiesController.name);

  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly activityRelationshipService: ActivityRelationshipService,
    private readonly hybridSearchService: HybridSearchService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new activity' })
  @ApiResponse({
    status: 201,
    description: 'The activity has been successfully created.',
  })
  create(@Body(ValidationPipe) createActivityDto: CreateActivityDto) {
    return this.activitiesService.create(createActivityDto);
  }

  @Get('/all')
  @ApiOperation({ summary: 'Get all activities' })
  @ApiResponse({ status: 200, description: 'Return all activities.' })
  findAll(
    @Query('latitude') latitude = '40.7128',
    @Query('longitude') longitude = '-74.006',
    @Query('radius') radius = 50000,
    @Query('limit') limit = 100,
  ) {
    return this.activitiesService.findAll(latitude, longitude, radius, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an activity by ID' })
  @ApiResponse({ status: 200, description: 'Returns the activity' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async findOne(@Param('id') id: string) {
    return this.activitiesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an activity' })
  @ApiResponse({ status: 200, description: 'Activity has been updated' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async update(
    @Param('id') id: string,
    @Body() updateActivityDto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(id, updateActivityDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an activity' })
  @ApiResponse({ status: 200, description: 'Activity has been deleted' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async remove(@Param('id') id: string) {
    return this.activitiesService.remove(id);
  }

  @Post('nearby')
  @ApiOperation({ summary: 'Find activities near a location' })
  @ApiResponse({ status: 200, description: 'Returns nearby activities' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async findNearby(@Body() findNearbyDto: FindNearbyDto) {
    try {
      const activities =
        await this.activitiesService.findNearbyActivities(findNearbyDto);
      this.logger.debug(`Found ${activities.length} nearby activities`);
      return activities;
    } catch (error) {
      this.logger.error('Error finding nearby activities:', error);
      throw new BadRequestException(error.message);
    }
  }

  @Get(':id/metadata')
  @ApiOperation({ summary: 'Get metadata for an activity' })
  @ApiResponse({
    status: 200,
    description: 'Returns the metadata for the activity',
  })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async getActivityMetadata(@Param('id') id: string) {
    return this.activitiesService.getActivityMetadata(id);
  }

  @Post(':id/refresh-metadata')
  @ApiOperation({ summary: 'Refresh metadata for an activity' })
  @ApiResponse({
    status: 200,
    description: 'Metadata has been refreshed',
  })
  async refreshMetadata(@Param('id') id: string) {
    return this.activitiesService.refreshMetadata(id);
  }

  @Post(':id/generate-relationships')
  @ApiOperation({ summary: 'Generate relationships for an activity' })
  @ApiResponse({
    status: 200,
    description: 'The relationships have been successfully generated',
  })
  async generateRelationships(@Param('id') id: string) {
    return this.activityRelationshipService.analyzeRelationship(id);
  }

  @Post(':id/generate-metadata')
  @ApiOperation({ summary: 'Generate metadata for an activity' })
  @ApiResponse({
    status: 200,
    description: 'Metadata has been generated',
  })
  async generateMetadata(@Param('id') id: string) {
    return this.activitiesService.generateMetadata(id);
  }

  @Post('batch-metadata')
  @ApiOperation({ summary: 'Batch generate metadata for multiple activities' })
  @ApiResponse({
    status: 200,
    description: 'Metadata has been generated for the provided activities',
  })
  async batchGenerateMetadata(@Body() data: { activityIds: string[] }) {
    if (!data.activityIds || !Array.isArray(data.activityIds)) {
      throw new BadRequestException(
        'activityIds must be an array of activity IDs',
      );
    }
    return this.activitiesService.batchGenerateMetadata(data.activityIds);
  }

  @Get(':id/similar')
  @ApiOperation({ summary: 'Get similar activities by vector similarity' })
  @ApiResponse({ status: 200, description: 'Returns similar activities' })
  async getSimilar(
    @Param('id') id: string,
    @Query('limit') limit: number = 10,
  ) {
    return this.activitiesService.findSimilar(id, Number(limit));
  }

  @Post('search-hybrid')
  @ApiOperation({ summary: 'Search activities with background crawling' })
  @ApiResponse({
    status: 200,
    description: 'Returns activities with crawling status',
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async searchWithCrawling(@Body(ValidationPipe) searchDto: HybridSearchDto) {
    return this.hybridSearchService.searchActivitiesWithCrawling(searchDto);
  }

  @Post('search-updated')
  @ApiOperation({ summary: 'Get updated results after crawling' })
  @ApiResponse({ status: 200, description: 'Returns updated activities' })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async getUpdatedResults(@Body(ValidationPipe) searchDto: HybridSearchDto) {
    const { latitude, longitude, radius, limit } = searchDto;
    return this.hybridSearchService.getUpdatedResults({
      latitude,
      longitude,
      radius,
      limit,
    });
  }
}
