import { IsOptional, IsString, IsUUID } from 'class-validator';

export class BookSessionDto {
  @IsString()
  sessionId!: string;

  /** Client-generated UUID — retries return the same booking. */
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  /**
   * Pack line from home «Использовать» (?service=), e.g. «Групповые программы».
   * Used to pick ЧленствоПакетУслуг for ОснованиеОплаты in 1C.
   */
  @IsOptional()
  @IsString()
  membershipServiceName?: string;
}
