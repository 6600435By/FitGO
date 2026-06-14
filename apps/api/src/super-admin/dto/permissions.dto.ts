import { AdminPermission } from '@fitgo/shared-types';
import { IsArray, IsEnum, IsIn } from 'class-validator';

export class SetPermissionsDto {
  @IsArray()
  @IsEnum(AdminPermission, { each: true })
  permissions!: AdminPermission[];
}

export class ApplyPresetDto {
  @IsIn(['reception', 'marketing', 'floor'])
  preset!: 'reception' | 'marketing' | 'floor';
}
