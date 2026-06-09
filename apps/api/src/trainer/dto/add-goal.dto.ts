import { IsOptional, IsString } from 'class-validator';

export class AddGoalDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  progress?: string;
}
