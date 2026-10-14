import { IsString, MinLength } from 'class-validator';

export class CreateStaffConversationDto {
  @IsString()
  @MinLength(1)
  peerId!: string;
}
