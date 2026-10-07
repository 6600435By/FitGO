import { IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateSpaWaitlistDto {
  @IsOptional()
  @IsString()
  specialistId?: string;

  @IsString()
  serviceId!: string;

  @IsISO8601()
  desiredStartAt!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;
}

export class BookFromSpaWaitlistDto {
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsIn(['QUOTA', 'PAID'])
  paymentType?: 'QUOTA' | 'PAID';

  @IsOptional()
  @IsString()
  membershipServiceName?: string;
}
