import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class SessionTaskInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

class SessionGoalInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionTaskInputDto)
  tasks?: SessionTaskInputDto[];
}

export class UpdateSessionPlanDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionGoalInputDto)
  goals!: SessionGoalInputDto[];

  @IsOptional()
  workoutSheet?: Record<string, unknown>;
}
