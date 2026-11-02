import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class BulkSpaBookingItemDto {
  @IsISO8601()
  startAt!: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsBoolean()
  overlapConfirmed?: boolean;
}

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

  /** 1C counterparty from specialist history suggestion (skip slow re-lookup). */
  @IsOptional()
  @IsString()
  clientExternalId?: string;

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

  /** Legacy: ISO date-times for each occurrence (own time per entry). */
  @ValidateIf((o: BulkSpaBookingDto) => !o.items?.length)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  dates?: string[];

  /** Preferred: per-occurrence start + optional service / overlap flag. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSpaBookingItemDto)
  items?: BulkSpaBookingItemDto[];

  /** Staff confirmed intentional overlap ≤ 15 min with a neighbor. */
  @IsOptional()
  @IsBoolean()
  overlapConfirmed?: boolean;
}
