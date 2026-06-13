import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateConversationDto {
  @IsEnum(['admin', 'trainer'])
  kind!: 'admin' | 'trainer';

  @IsOptional()
  @IsString()
  trainerId?: string;
}
