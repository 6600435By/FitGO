import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSpaWaitlistDto {
  @IsOptional()
  @IsString()
  specialistId?: string;

  @IsString()
  serviceId!: string;

  @IsOptional()
  @IsIn(['EXACT', 'WINDOW'])
  preference?: 'EXACT' | 'WINDOW';

  @ValidateIf((o: CreateSpaWaitlistDto) => (o.preference ?? 'EXACT') === 'EXACT')
  @IsISO8601()
  desiredStartAt?: string;

  @ValidateIf((o: CreateSpaWaitlistDto) => o.preference === 'WINDOW')
  @Matches(YMD)
  windowStart?: string;

  @ValidateIf((o: CreateSpaWaitlistDto) => o.preference === 'WINDOW')
  @Matches(YMD)
  windowEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  timeFromMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  timeToMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(127)
  weekdays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;
}

export class UpdateSpaWaitlistDto {
  @IsOptional()
  @Matches(YMD)
  windowStart?: string;

  @IsOptional()
  @Matches(YMD)
  windowEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  timeFromMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  timeToMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(127)
  weekdays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;

  @IsOptional()
  @IsISO8601()
  desiredStartAt?: string;
}

export class BookFromSpaWaitlistDto {
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsIn(['QUOTA', 'PAID'])
  paymentType?: 'QUOTA' | 'PAID';

  @IsOptional()
  @IsString()
  membershipServiceName?: string;
}
