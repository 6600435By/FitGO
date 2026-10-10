import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
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
}
