import { IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';

export class AssignSpaBookingDto {
  @IsString()
  clientId!: string;

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
}
