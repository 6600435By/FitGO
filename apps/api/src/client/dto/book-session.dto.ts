import { IsString } from 'class-validator';

export class BookSessionDto {
  @IsString()
  sessionId!: string;
}
