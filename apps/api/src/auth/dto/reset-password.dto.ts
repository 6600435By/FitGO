import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(5)
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  verificationCode!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
