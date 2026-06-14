import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateGamificationDto {
  @IsBoolean()
  useRealNameInPublic!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  gamificationNickname?: string;
}

export class CheckInDto {
  @IsOptional()
  @IsString()
  qrToken?: string;
}

export class CreateWorkoutDto {
  @IsString()
  type!: string;

  @IsString()
  startedAt!: string;

  @IsNumber()
  durationMin!: number;

  @IsOptional()
  distanceKm?: number;

  @IsOptional()
  calories?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
