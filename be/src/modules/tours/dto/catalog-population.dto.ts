import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CatalogPopulationScopeDto {
  @IsString()
  label!: string;

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsInt()
  @Min(100)
  @Max(25000)
  radiusMeters!: number;
}

export class CreateCatalogPopulationJobDto {
  @IsString()
  idempotencyKey!: string;

  @ValidateNested()
  @Type(() => CatalogPopulationScopeDto)
  scope!: CatalogPopulationScopeDto;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  themes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  intents?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(250)
  maxCandidates?: number;
}
