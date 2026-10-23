import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AdminTaskStatus } from '@fitgo/shared-types';

export class CreateAdminTaskDto {
  /** Prefer multi-assign; single assigneeId kept for backwards compatibility */
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsIn(['SHARED', 'INDIVIDUAL'])
  completionMode?: 'SHARED' | 'INDIVIDUAL';

  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class UpdateAdminTaskDto {
  @IsOptional()
  @IsEnum(AdminTaskStatus)
  status?: AdminTaskStatus;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /** Assign to admin; empty string / null clears to pool. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  assigneeId?: string | null;

  /** Required when status = CANCELLED. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  comment?: string;
}

export class ReworkAdminTaskDto {
  @IsString()
  @MinLength(2)
  comment!: string;

  @ValidateIf((o: ReworkAdminTaskDto) => !o.pool)
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsBoolean()
  pool?: boolean;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class UpsertAdminTaskRuleDto {
  @IsString()
  source!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsIn(['POOL', 'USERS', 'ON_SHIFT'])
  assignMode!: 'POOL' | 'USERS' | 'ON_SHIFT';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsIn(['END_OF_DAY', 'HOURS_BEFORE_EVENT', 'HOURS_AFTER_CREATE'])
  duePolicy!: 'END_OF_DAY' | 'HOURS_BEFORE_EVENT' | 'HOURS_AFTER_CREATE';

  @IsOptional()
  @IsInt()
  @Min(0)
  dueHours?: number | null;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class PutAdminTaskRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertAdminTaskRuleDto)
  rules!: UpsertAdminTaskRuleDto[];
}
