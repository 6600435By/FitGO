import {
  IsBoolean,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AssignSpaBookingDto {
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

  @IsISO8601()
  startAt!: string;

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

  /** Staff confirmed intentional overlap ≤ 15 min with a neighbor. */
  @IsOptional()
  @IsBoolean()
  overlapConfirmed?: boolean;
}
