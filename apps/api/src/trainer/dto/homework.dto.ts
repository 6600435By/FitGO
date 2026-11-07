import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class HomeworkItemDto {
  @IsOptional()
  @IsIn(['exercise', 'cardio', 'nutrition', 'habit'])
  kind?: 'exercise' | 'cardio' | 'nutrition' | 'habit';

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  target?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  timesRequired?: number;
}

export class CreateHomeworkDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HomeworkItemDto)
  items?: HomeworkItemDto[];
}

export class CheckHomeworkItemDto {
  @IsString()
  /** YYYY-MM-DD */
  dayKey!: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class UpsertGroupClassNoteDto {
  @IsString()
  @MaxLength(200)
  sessionKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  groupRpe?: number;
}
