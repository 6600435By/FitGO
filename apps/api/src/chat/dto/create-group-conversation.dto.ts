import { ArrayMinSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGroupConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  memberIds!: string[];
}
