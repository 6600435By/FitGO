import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class AssignPersonalBookingDto {
  /** Existing roster client. Omit when booking a guest by phone + FIO. */
  @IsOptional()
  @IsString()
  clientId?: string;

  @ValidateIf((o: AssignPersonalBookingDto) => !o.clientId?.trim())
  @IsString()
  @MinLength(5)
  phone?: string;

  @ValidateIf((o: AssignPersonalBookingDto) => !o.clientId?.trim())
  @IsString()
  @MinLength(1)
  firstName?: string;

  @ValidateIf((o: AssignPersonalBookingDto) => !o.clientId?.trim())
  @IsString()
  @MinLength(1)
  lastName?: string;

  /** From phone lookup (1С / FitGO). */
  @IsOptional()
  @IsString()
  clientExternalId?: string;

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
