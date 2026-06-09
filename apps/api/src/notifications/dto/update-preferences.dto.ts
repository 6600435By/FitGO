import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  bookingReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  membershipAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  inactivityAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  milestoneAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  marketingAlerts?: boolean;
}
