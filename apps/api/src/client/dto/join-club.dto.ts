import { IsOptional, IsString, MinLength } from 'class-validator';

export class JoinClubDto {
  @IsString()
  @MinLength(1)
  clubSlug!: string;

  @IsOptional()
  @IsString()
  externalId?: string;
}
