import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class AvailabilityBlockDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;
}

export class SetAvailabilityBlocksDto {
  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityBlockDto)
  blocks!: AvailabilityBlockDto[];
}
