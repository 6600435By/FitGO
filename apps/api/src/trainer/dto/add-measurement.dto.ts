import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AddMeasurementDto {
  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
