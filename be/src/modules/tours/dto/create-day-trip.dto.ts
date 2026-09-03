import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { OvernightPolicy } from '../interfaces/day-trip.interface';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class DayTripOriginDto {
  @ApiProperty({ example: 'Buenos Aires, Argentina' })
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  label: string;

  @ApiProperty({ example: -34.6037 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -58.3816 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsLongitude()
  longitude: number;
}

export class DayTripClockWindowDto {
  @ApiProperty({ minimum: 0, maximum: 2880, example: 420 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2880)
  earliestMinutesFromMidnight: number;

  @ApiProperty({ minimum: 0, maximum: 2880, example: 540 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2880)
  latestMinutesFromMidnight: number;
}

export class CreateDayTripDto {
  @ApiProperty({ type: DayTripOriginDto })
  @ValidateNested()
  @Type(() => DayTripOriginDto)
  origin: DayTripOriginDto;

  @ApiProperty({ minimum: 15, maximum: 360, example: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(15)
  @Max(360)
  maxOutboundTravelMinutes: number;

  @ApiProperty({ minimum: 15, maximum: 360, example: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(15)
  @Max(360)
  maxReturnTravelMinutes: number;

  @ApiProperty({ type: DayTripClockWindowDto })
  @ValidateNested()
  @Type(() => DayTripClockWindowDto)
  departureWindow: DayTripClockWindowDto;

  @ApiProperty({ type: DayTripClockWindowDto })
  @ValidateNested()
  @Type(() => DayTripClockWindowDto)
  returnWindow: DayTripClockWindowDto;

  @ApiProperty({ enum: ['same_day_only', 'allow_overnight'] })
  @IsEnum(['same_day_only', 'allow_overnight'])
  overnightPolicy: OvernightPolicy;

  @ApiProperty({ enum: TransportationMode, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(TransportationMode, { each: true })
  allowedTransportationModes: TransportationMode[];

  @ApiProperty({ type: [String], example: ['wine', 'nature'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  interests: string[];

  @ApiProperty({ required: false, maxLength: 500 })
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  additionalPreferences?: string;

  @ApiProperty({ example: '2026-09-12' })
  @IsDateString()
  startDate: string;
}
