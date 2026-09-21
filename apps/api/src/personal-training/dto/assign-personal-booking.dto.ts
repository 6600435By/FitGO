import { IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';

export class AssignPersonalBookingDto {
  @IsString()
  clientId!: string;

  @IsISO8601()
  startAt!: string;

  /** Подарочная ПТ — не идёт в общий % мотивации */
  @IsOptional()
  @IsBoolean()
  isComplimentary?: boolean;
}
