import { TourActivity } from '@prisma/client';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
} from 'class-validator';

export class CreateTourDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  price: number;

  @IsNumber()
  duration: number;

  @IsNumber()
  maxGroupSize: number;

  @IsArray()
  @IsDateString()
  startDates: Date[];

  @IsArray()
  @IsOptional()
  activities?: {
    activityId: string;
    duration: string;
    startTime: Date;
    notes: string;
  }[];

  @IsString()
  @IsOptional()
  type?: string;
}

export class CreateTourActivityDto {
  @IsNumber()
  activityId: string;

  @IsString()
  duration: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @IsOptional()
  startTime?: Date;

  @IsNumber()
  @IsOptional()
  order?: number; // Position in tour sequence
}
