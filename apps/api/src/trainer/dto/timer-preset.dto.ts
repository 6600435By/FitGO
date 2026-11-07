import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TimerPhaseDto {
  @IsIn(['prep', 'work', 'rest', 'roundRest', 'cooldown'])
  kind!: 'prep' | 'work' | 'rest' | 'roundRest' | 'cooldown';

  /** null = open phase (stopwatch). */
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number | null;

  @IsString()
  @MaxLength(120)
  label!: string;
}

export class CreateTimerPresetDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TimerPhaseDto)
  phases!: TimerPhaseDto[];

  @IsOptional()
  @IsIn(['classic', 'gong', 'whistle'])
  soundPack?: 'classic' | 'gong' | 'whistle';

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateTimerPresetDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TimerPhaseDto)
  phases?: TimerPhaseDto[];

  @IsOptional()
  @IsIn(['classic', 'gong', 'whistle'])
  soundPack?: 'classic' | 'gong' | 'whistle';

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
