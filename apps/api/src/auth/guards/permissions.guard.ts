import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPermission } from '@fitgo/shared-types';
import { AdminPermissionsService } from '../admin-permissions.service';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import type { JwtPayload } from '../jwt.strategy';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminPermissions: AdminPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AdminPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const allowed = await this.adminPermissions.hasAnyPermission(
      request.user,
      required,
    );

    if (!allowed) {
      throw new ForbiddenException('Недостаточно прав для этого действия');
    }

    return true;
  }
}
