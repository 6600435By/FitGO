import { IsISO8601, IsIn, IsOptional } from 'class-validator';

export class UpdateTrainerBookingDto {
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsIn(['cancel'])
  action?: 'cancel';
}
