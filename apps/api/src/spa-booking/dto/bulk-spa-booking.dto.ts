import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class BulkSpaBookingDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsString()
  serviceId!: string;

  @IsIn(['QUOTA', 'PAID'])
  paymentType!: 'QUOTA' | 'PAID';

  @IsOptional()
  @IsString()
  specialistId?: string;

  @IsOptional()
  @IsString()
  membershipServiceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  visitNote?: string;

  /**
   * Fallback time-of-day when a dates[] entry has no time component.
   * Prefer embedding HH:mm in each dates[] ISO.
   */
  @IsISO8601()
  startAt!: string;

  /** ISO date-times for each occurrence (own time per entry). */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  dates!: string[];

  /** Staff confirmed intentional overlap ≤ 15 min with a neighbor. */
  @IsOptional()
  @IsBoolean()
  overlapConfirmed?: boolean;
}
