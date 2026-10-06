import { IsOptional, IsString, IsUUID } from 'class-validator';

export class BookSessionDto {
  @IsString()
  sessionId!: string;

  /** Client-generated UUID — retries return the same booking. */
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
