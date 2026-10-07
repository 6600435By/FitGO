import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
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

  /** Time-of-day from the first booking; applied to each date. */
  @IsISO8601()
  startAt!: string;

  /** ISO date-times for each occurrence. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  dates!: string[];
}
