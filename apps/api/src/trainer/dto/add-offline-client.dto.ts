import { IsOptional, IsString, MinLength } from 'class-validator';

export class AddOfflineClientDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
