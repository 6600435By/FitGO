import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGroupConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addMemberIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeMemberIds?: string[];
}
