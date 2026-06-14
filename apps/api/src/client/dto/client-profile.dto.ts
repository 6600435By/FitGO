import { Gender } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

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
  heightCm?: number;

  @IsOptional()
  targetWeightKg?: number;
}

export class CreateBodyLogDto {
  @IsOptional()
  weightKg?: number;

  @IsOptional()
  chestCm?: number;

  @IsOptional()
  waistCm?: number;

  @IsOptional()
  hipsCm?: number;

  @IsOptional()
  bicepsCm?: number;

  @IsOptional()
  thighCm?: number;

  @IsOptional()
  bodyFatPct?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateGamificationSettingsDto {
  @IsOptional()
  useRealNameInPublic?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  gamificationNickname?: string;
}
