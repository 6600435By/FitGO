import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

/** HH:MM or HH:MM:SS from browser `<input type="time">`. */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export class SetSpecialistDayHoursDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day!: string;

  /** Omit both or send null → day off (clear hours for the day). */
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(TIME_RE)
  startTime?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(TIME_RE)
  endTime?: string | null;
}
