import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** Email or staff login (surname, without a domain). */
  @IsString()
  @MinLength(1)
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
