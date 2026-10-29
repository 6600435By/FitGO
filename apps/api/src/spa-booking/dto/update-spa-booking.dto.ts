import {
  IsBoolean,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateSpaBookingDto {
  @IsOptional()
  @IsString()
  specialistId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsISO8601()
  startAt?: string;

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

  /**
   * When linking phone on a one-word guest name, pass true to also update
   * sibling bookings with the same typed name.
   */
  @IsOptional()
  @IsBoolean()
  cascadeClientLink?: boolean;

  @IsOptional()
  @IsIn(['QUOTA', 'PAID'])
  paymentType?: 'QUOTA' | 'PAID';

  @IsOptional()
  @IsString()
  membershipServiceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  visitNote?: string;

  /** Staff confirmed intentional overlap ≤ 15 min with a neighbor. */
  @IsOptional()
  @IsBoolean()
  overlapConfirmed?: boolean;
}
