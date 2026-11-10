import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOfflineClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  phone?: string;

  /** Roster link note (trainer private). Pass empty string to clear. */
  @IsOptional()
  @IsString()
  notes?: string;
}
