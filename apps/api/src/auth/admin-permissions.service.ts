import { Injectable } from '@nestjs/common';
import { AdminPermission, UserRole } from '@fitgo/shared-types';
import { AdminPermission as PrismaAdminPermission, Role } from '@prisma/client';
import type { JwtPayload } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

const ALL_PERMISSIONS = Object.values(AdminPermission);

@Injectable()
export class AdminPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissions(user: JwtPayload): Promise<AdminPermission[]> {
    if (user.roles.includes(UserRole.SUPER_ADMIN)) {
      return ALL_PERMISSIONS;
    }

    if (!user.roles.includes(UserRole.ADMIN)) {
      return [];
    }

    const grants = await this.prisma.adminPermissionGrant.findMany({
      where: { userId: user.sub },
    });

    if (grants.length === 0) {
      await this.setPermissions(user.sub, ALL_PERMISSIONS);
      return ALL_PERMISSIONS;
    }

    return grants.map((g) => g.permission as AdminPermission);
  }

  async hasAnyPermission(
    user: JwtPayload,
    required: AdminPermission[],
  ): Promise<boolean> {
    if (user.roles.includes(UserRole.SUPER_ADMIN)) {
      return true;
    }

    const permissions = await this.getPermissions(user);
    return required.some((p) => permissions.includes(p));
  }

  async setPermissions(userId: string, permissions: AdminPermission[]) {
    await this.prisma.$transaction([
      this.prisma.adminPermissionGrant.deleteMany({ where: { userId } }),
      this.prisma.adminPermissionGrant.createMany({
        data: permissions.map((permission) => ({
          userId,
          permission: permission as PrismaAdminPermission,
        })),
      }),
    ]);
  }

  async ensureIsClubAdmin(userId: string, clubId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        clubId,
        isActive: true,
        roles: { some: { role: Role.ADMIN } },
      },
    });
    return user;
  }
}
