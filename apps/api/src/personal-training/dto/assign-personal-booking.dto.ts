import { IsISO8601, IsString } from 'class-validator';

export class AssignPersonalBookingDto {
  @IsString()
  clientId!: string;

  @IsISO8601()
  startAt!: string;
}
