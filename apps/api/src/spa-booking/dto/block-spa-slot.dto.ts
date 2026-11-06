import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class BlockSpaSlotDto {
  @IsISO8601()
  startAt!: string;

  /** Defaults to startAt + 30 min when omitted. */
  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsString()
  specialistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
