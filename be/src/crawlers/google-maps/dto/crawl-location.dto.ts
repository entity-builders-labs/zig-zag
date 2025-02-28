import { PlacesNearbyRanking } from '@googlemaps/google-maps-services-js';
import { IsNumber, IsOptional, IsString, IsBoolean } from 'class-validator';

export class CrawlLocationDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsNumber()
  @IsOptional()
  radius: number = 50000; // Default 50km radius

  @IsString()
  @IsOptional()
  query?: string;

  @IsString()
  @IsOptional()
  type?: string = 'tourist_attraction';

  @IsString()
  @IsOptional()
  pageToken?: string;

  @IsString()
  @IsOptional()
  rankBy?: PlacesNearbyRanking = 'prominence' as PlacesNearbyRanking;

  @IsBoolean()
  @IsOptional()
  openNow?: boolean = true;

  @IsNumber()
  @IsOptional()
  maxPrice?: number;

  @IsNumber()
  @IsOptional()
  minPrice?: number;

  @IsString()
  @IsOptional()
  keyword?: string = 'tourist_attraction';

  @IsString()
  @IsOptional()
  language?: string = 'en';

  @IsBoolean()
  @IsOptional()
  fetchDetails?: boolean = true;

  @IsString()
  @IsOptional()
  placeId?: string;
}
