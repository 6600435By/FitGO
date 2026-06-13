import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class SendStaffMessageDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsEnum(['admin', 'trainer'])
  recipientType!: 'admin' | 'trainer';

  @IsOptional()
  @IsString()
  trainerId?: string;
}
