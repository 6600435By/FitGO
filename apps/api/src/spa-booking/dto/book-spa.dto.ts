import { IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';

export class BookSpaDto {
  @IsString()
  serviceId!: string;

  @IsString()
  specialistId!: string;

  @IsISO8601()
  startAt!: string;

  @IsIn(['QUOTA', 'PAID'])
  paymentType!: 'QUOTA' | 'PAID';

  @IsOptional()
  @IsString()
  membershipServiceName?: string;

  /** UUID ЧленствоПакетУслуг — списать квоту из этого пакета. */
  @IsOptional()
  @IsString()
  membershipPackageId?: string;
}
