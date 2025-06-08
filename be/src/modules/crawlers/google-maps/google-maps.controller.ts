import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { GoogleMapsService } from './google-maps.service';
import { CrawlLocationDto } from './dto/crawl-location.dto';

@Controller('crawlers/google-maps')
export class GoogleMapsController {
  constructor(private readonly googleMapsService: GoogleMapsService) {}
  @Post('crawl')
  async crawlAndSaveActivities(@Body() dto: CrawlLocationDto): Promise<any> {
    try {
      return await this.googleMapsService.crawlAndSaveActivities(dto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error crawling and saving activities',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
