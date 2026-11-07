import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  TrainerPaymentKind,
  TrainerPaymentMethod,
} from '@prisma/client';

export class UpsertOwnPackageDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  title!: string;

  @IsInt()
  @Min(1)
  sessionsCount!: number;

  @IsInt()
  @Min(0)
  priceMinor!: number;

  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(1)
  validityDays?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetDefaultSessionPriceDto {
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  priceMinor?: number | null;
}

export class SellPackageDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sessionsCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  validityDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidMinor?: number;

  @IsOptional()
  @IsEnum(TrainerPaymentMethod)
  method?: TrainerPaymentMethod;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class RecordPaymentDto {
  @IsString()
  clientId!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsEnum(TrainerPaymentMethod)
  method!: TrainerPaymentMethod;

  @IsOptional()
  @IsEnum(TrainerPaymentKind)
  kind?: TrainerPaymentKind;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  packageId?: string;

  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsOptional()
  @IsBoolean()
  applyToDebt?: boolean;
}
