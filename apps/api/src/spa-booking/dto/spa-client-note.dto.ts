import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GetSpaClientNoteQueryDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientExternalId?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class UpsertSpaClientNoteDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientExternalId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MaxLength(280)
  text!: string;
}
