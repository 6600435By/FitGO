import { SetMetadata } from '@nestjs/common';
import { AdminPermission } from '@fitgo/shared-types';

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermission = (...permissions: AdminPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
