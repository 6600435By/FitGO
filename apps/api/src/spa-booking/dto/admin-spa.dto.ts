import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpsertSpaServiceDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;

  @IsIn(['MASSAGE', 'BODY_COMPOSITION', 'WRAP'])
  kind!: 'MASSAGE' | 'BODY_COMPOSITION' | 'WRAP';

  @IsInt()
  @Min(5)
  durationMin!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMin?: number;

  @IsInt()
  @Min(0)
  priceMinor!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class QuotaRuleDto {
  @IsString()
  membershipServiceName!: string;

  @IsArray()
  @IsString({ each: true })
  allowedServiceIds!: string[];

  @IsArray()
  @IsString({ each: true })
  allowedSpecialistIds!: string[];
}

export class SetSpaQuotaRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaRuleDto)
  rules!: QuotaRuleDto[];
}

export class SetSpecialistServicesDto {
  @IsArray()
  @IsString({ each: true })
  serviceIds!: string[];
}
