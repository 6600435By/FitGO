import { IsIn, IsString, MinLength } from 'class-validator';

export class SendPhoneCodeDto {
  @IsString()
  @MinLength(5)
  phone!: string;

  @IsIn(['register', 'reset_password'])
  purpose!: 'register' | 'reset_password';
}
