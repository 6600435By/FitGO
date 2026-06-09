import { IsOptional, IsString } from 'class-validator';

export class SendReminderDto {
  @IsOptional()
  @IsString()
  message?: string;
}
