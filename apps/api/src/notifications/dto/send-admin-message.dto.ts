import { IsString, MinLength } from 'class-validator';

export class SendAdminMessageDto {
  @IsString()
  @MinLength(1)
  message!: string;
}
