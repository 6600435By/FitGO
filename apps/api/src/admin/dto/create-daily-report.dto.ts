import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateDailyReportDto {
  @IsDateString()
  date!: string;

  @IsNumber()
  @Min(0)
  revenue!: number;

  @IsOptional()
  @IsString()
  problems?: string;

  @IsOptional()
  @IsString()
  ideas?: string;
}
