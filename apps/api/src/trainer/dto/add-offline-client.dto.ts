import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class AddOfflineClientDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  /** Optional — client can be added by name; phone linked later. */
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MinLength(5)
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** From phone lookup (1С / FitGO) — stored on User.externalId. */
  @IsOptional()
  @IsString()
  clientExternalId?: string;
}
