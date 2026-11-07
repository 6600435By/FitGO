import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateTrainerBookingDto {
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsIn(['cancel', 'no_show'])
  action?: 'cancel' | 'no_show';

  @IsOptional()
  @IsString()
  cancelReason?: string;

  /** For PERSONAL («Тренер клуб»): charge package / raise debt on late cancel or no-show. */
  @IsOptional()
  @IsBoolean()
  debitPackage?: boolean;

  /** cancel / reschedule scope when booking belongs to a series. */
  @IsOptional()
  @IsIn(['one', 'future'])
  seriesScope?: 'one' | 'future';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  bufferBeforeMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  bufferAfterMin?: number;
}
