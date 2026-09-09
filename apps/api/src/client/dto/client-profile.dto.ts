import { Gender } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

function nullableNumber({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return value === '' ? null : value;
  return Number(value);
}

export class UpdateClientProfileDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  @IsEnum(Gender)
  gender!: Gender;

  @IsDateString()
  dateOfBirth!: string;
}

export class UpdateBodyProfileDto {
  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  heightCm?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  targetWeightKg?: number | null;
}

export class CreateBodyLogDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  chestCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  waistCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  hipsCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bicepsCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  thighCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bodyFatPct?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBodyLogDto {
  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  weightKg?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  chestCm?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  waistCm?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  hipsCm?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  bicepsCm?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  thighCm?: number | null;

  @IsOptional()
  @Transform(nullableNumber)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  bodyFatPct?: number | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class UpdateGamificationSettingsDto {
  @IsOptional()
  useRealNameInPublic?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  gamificationNickname?: string;
}

export class UpdateTrainingProfileDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  primaryGoals?: string[];

  @IsOptional()
  @IsString()
  goalNotes?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(52)
  goalHorizonWeeks?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  experienceLevel?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(80)
  yearsTraining?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(14)
  sessionsPerWeek?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  preferredModalities?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  limitations?: string[];

  @IsOptional()
  @IsString()
  limitationNotes?: string;

  @IsOptional()
  @IsBoolean()
  pregnancyFlag?: boolean;

  @IsOptional()
  @IsBoolean()
  bloodPressureFlag?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(180)
  preferredSessionMin?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  homeEquipment?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  preferredTimeOfDay?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  preferredIntensity?: string | null;
}
