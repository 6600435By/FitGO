import { IsString, MinLength } from 'class-validator';

export class InviteClientDto {
  @IsString()
  @MinLength(5)
  phone!: string;
}
