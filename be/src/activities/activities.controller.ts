import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  ValidationPipe,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { FindNearbyDto } from './dto/find-nearby.dto';
import { ActivityRelationshipService } from './activity-relationship.service';
import { ToursService } from '../tours/tours.service';

@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  private readonly logger = new Logger(ActivitiesController.name);

  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly prisma: PrismaService,
    private readonly activityRelationshipService: ActivityRelationshipService,
    private readonly toursService: ToursService,
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

  @Get()
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
  @ApiOperation({ summary: 'Get an activity by id' })
  @ApiResponse({
    status: 200,
    description: 'Return the activity.',
  })
  @ApiResponse({ status: 404, description: 'Activity not found.' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.activitiesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an activity' })
  @ApiResponse({
    status: 200,
    description: 'The activity has been successfully updated.',
  })
  @ApiResponse({ status: 404, description: 'Activity not found.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(ValidationPipe) updateActivityDto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(id, updateActivityDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an activity' })
  @ApiResponse({
    status: 200,
    description: 'The activity has been successfully deleted.',
  })
  @ApiResponse({ status: 404, description: 'Activity not found.' })
  remove(@Param('id', ParseIntPipe) id: number) {
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
  async getActivityMetadata(@Param('id', ParseIntPipe) id: number) {
    return this.activitiesService.getActivityMetadata(id);
  }

  @Post(':id/refresh-metadata')
  @ApiOperation({ summary: 'Refresh metadata for an activity' })
  @ApiResponse({
    status: 200,
    description: 'The metadata has been successfully refreshed',
  })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async refreshMetadata(@Param('id', ParseIntPipe) id: number) {
    return this.activitiesService.refreshMetadata(id);
  }

  @Post(':id/generate-relationships')
  @ApiOperation({ summary: 'Generate relationships for an activity' })
  @ApiResponse({
    status: 200,
    description: 'The relationships have been successfully generated',
  })
  async generateRelationships(@Param('id', ParseIntPipe) id: number) {
    return this.activityRelationshipService.analyzeRelationship(id.toString());
  }

  @Post(':id/metadata')
  @ApiOperation({ summary: 'Generate metadata for an activity' })
  @ApiResponse({
    status: 200,
    description: 'The metadata has been successfully generated',
  })
  async generateMetadata(@Param('id', ParseIntPipe) id: number) {
    return this.activitiesService.generateMetadata(id);
  }

  @Post('batch-metadata')
  @ApiOperation({ summary: 'Batch generate metadata for multiple activities' })
  @ApiResponse({
    status: 200,
    description: 'Metadata has been generated for the provided activities',
  })
  async batchGenerateMetadata(@Body() data: { activityIds: number[] }) {
    if (!data.activityIds || !Array.isArray(data.activityIds)) {
      throw new BadRequestException(
        'activityIds must be an array of activity IDs',
      );
    }
    return this.activitiesService.batchGenerateMetadata(data.activityIds);
  }

  @Get(':id/tour-suggestion')
  @ApiOperation({ summary: 'Generate a tour suggestion for an activity' })
  @ApiResponse({
    status: 200,
    description: 'The tour suggestion has been successfully generated',
  })
  async generateTourSuggestion(
    @Param('id', ParseIntPipe) id: number,
    @Query('numberOfActivities', new ParseIntPipe({ optional: true }))
    numberOfActivities = 5,
  ) {
    return this.toursService.generateTourSuggestion(id, numberOfActivities);
  }

  @Get(':id/next')
  @ApiOperation({ summary: 'Generate a next activity for an activity' })
  @ApiResponse({
    status: 200,
    description: 'The next activity has been successfully generated',
  })
  async generateNextActivity(
    @Param('id', ParseIntPipe) id: number,
    @Query('numberOfActivities', new ParseIntPipe({ optional: true }))
    numberOfActivities = 5,
  ) {
    return this.toursService.getNextActivity(id);
  }
}
