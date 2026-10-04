import { IsISO8601 } from 'class-validator';

export class CheckSpecialistAvailabilityDto {
  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;
}
