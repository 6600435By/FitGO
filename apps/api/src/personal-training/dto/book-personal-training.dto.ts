import { IsISO8601, IsString } from 'class-validator';

export class BookPersonalTrainingDto {
  @IsString()
  trainerId!: string;

  @IsISO8601()
  startAt!: string;
}
