import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';

export class PublishScheduleDto {
  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  /** When set, publish only these DRAFT OPEN blocks (must belong to the trainer). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockIds?: string[];
}
