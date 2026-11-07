import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DismissInsightDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  key!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;
}
