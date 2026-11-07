import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  Matches,
} from 'class-validator';

export class CreateBookingSeriesDto {
  @IsString()
  clientId!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  durationMin?: number;

  @IsISO8601()
  fromDate!: string;

  @IsOptional()
  @IsISO8601()
  toDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  occurrences?: number;

  @IsOptional()
  @IsIn(['CLUB', 'PERSONAL'])
  ptFlow?: 'CLUB' | 'PERSONAL';

  @IsOptional()
  @IsBoolean()
  isComplimentary?: boolean;
}
