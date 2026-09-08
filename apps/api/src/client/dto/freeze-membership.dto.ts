import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class FreezeMembershipDto {
  @IsInt()
  @Min(1)
  @Max(366)
  days!: number;

  /** ISO date YYYY-MM-DD */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string;
}
