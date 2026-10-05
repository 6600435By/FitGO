import { IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsIn(['QUOTA', 'PAID'])
  paymentType?: 'QUOTA' | 'PAID';

  @IsOptional()
  @IsString()
  membershipServiceName?: string;
}
