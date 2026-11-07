import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateAvailabilityHoldDto {
  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsIn(['HOLD_CLIENT', 'PERSONAL_BLOCK'])
  kind!: 'HOLD_CLIENT' | 'PERSONAL_BLOCK';

  @IsOptional()
  @IsString()
  holdClientId?: string;

  /** Hours until auto-release for HOLD_CLIENT (default 12). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  holdHours?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
