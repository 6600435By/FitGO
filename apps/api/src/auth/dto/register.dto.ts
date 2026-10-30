import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  /** 6-digit SMS OTP */
  @IsString()
  @Matches(/^\d{6}$/)
  verificationCode!: string;

  @IsString()
  @MinLength(1)
  privacyConsentVersion!: string;

  @IsString()
  @MinLength(1)
  termsConsentVersion!: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
