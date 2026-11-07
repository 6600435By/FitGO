import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';

export class AssignPersonalBookingDto {
  @IsString()
  clientId!: string;

  @IsISO8601()
  startAt!: string;

  /** Подарочная ПТ — не идёт в общий % мотивации */
  @IsOptional()
  @IsBoolean()
  isComplimentary?: boolean;

  /**
   * Dual trainerClub+trainerStaff only: CLUB = control/payroll, PERSONAL = Мои оплаты.
   * Ignored when trainer has a single scheme.
   */
  @IsOptional()
  @IsIn(['CLUB', 'PERSONAL'])
  ptFlow?: 'CLUB' | 'PERSONAL';
}
