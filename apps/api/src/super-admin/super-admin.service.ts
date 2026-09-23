import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminPermission,
  AdminTaskStatus,
  UserRole,
} from '@fitgo/shared-types';
import {
  AdminTaskStatus as PrismaAdminTaskStatus,
  Prisma,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { AdminPermissionsService } from '../auth/admin-permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAdminTaskDto } from './dto/task.dto';
import type { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { randomBytes } from 'crypto';

const STAFF_ROLES: Role[] = [
  Role.ADMIN,
  Role.TRAINER,
  Role.SPECIALIST,
  Role.TECH,
];

const APP_LOGIN_ROLES = new Set(['ADMIN', 'TRAINER', 'SPECIALIST']);

function needsAppLogin(
  roles: Array<'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH'>,
): boolean {
  return roles.some((r) => APP_LOGIN_ROLES.has(r));
}

function techPlaceholderEmail(firstName: string, lastName: string): string {
  const base = `${lastName}.${firstName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(3).toString('hex');
  return `tech.${base || 'worker'}.${suffix}@staff.fitgo.local`;
}

function toStaffPrismaRole(r: 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH') {
  if (r === 'ADMIN') return Role.ADMIN;
  if (r === 'SPECIALIST') return Role.SPECIALIST;
  if (r === 'TECH') return Role.TECH;
  return Role.TRAINER;
}

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminPermissions: AdminPermissionsService,
  ) {}

  async listStaff(user: JwtPayload) {
    const staff = await this.prisma.user.findMany({
      where: {
        clubId: requireClubId(user),
        roles: { some: { role: { in: STAFF_ROLES } } },
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return staff.map((member) => this.mapStaff(member));
  }

  async createStaff(user: JwtPayload, dto: CreateStaffDto) {
    const roleList = [
      ...new Set(
        (dto.roles?.length ? dto.roles : dto.role ? [dto.role] : []) as Array<
          'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH'
        >,
      ),
    ];
    if (roleList.length === 0) {
      throw new BadRequestException(
        'Укажите хотя бы одно подразделение: админ, тренер, SPA или техперсонал',
      );
    }

    const needsLogin = needsAppLogin(roleList);
    const email = needsLogin
      ? (dto.email ?? '').trim().toLowerCase()
      : techPlaceholderEmail(dto.firstName.trim(), dto.lastName.trim());
    if (needsLogin && !email) {
      throw new BadRequestException('Укажите логин (email) для входа в приложение');
    }
    const plainPassword = needsLogin
      ? dto.password
      : randomBytes(24).toString('hex');
    if (needsLogin && (!plainPassword || plainPassword.length < 6)) {
      throw new BadRequestException('Пароль не меньше 6 символов');
    }

    const existing = await this.prisma.user.findFirst({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('Пользователь с таким логином уже существует');
    }

    const passwordHash = await bcrypt.hash(plainPassword!, 10);
    const toPrisma = (r: 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH') => {
      if (r === 'ADMIN') return Role.ADMIN;
      if (r === 'SPECIALIST') return Role.SPECIALIST;
      if (r === 'TECH') return Role.TECH;
      return Role.TRAINER;
    };
    const clubId = requireClubId(user);

    const created = await this.prisma.user.create({
      data: {
        clubId,
        email,
        password: passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim() || null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        createdById: user.sub,
        loginEnabled: needsLogin,
        roles: {
          create: roleList.map((r) => ({ role: toPrisma(r) })),
        },
      },
      include: { roles: true },
    });

    if (roleList.includes('ADMIN')) {
      await this.adminPermissions.setPermissions(created.id, [
        AdminPermission.DASHBOARD_VIEW,
        AdminPermission.CLIENTS_VIEW,
      ]);
    }

    await this.logAudit(user, 'STAFF_CREATED', created.id, {
      roles: roleList,
      email,
      loginEnabled: needsLogin,
    });

    return {
      user: this.mapStaff(created),
      ...(needsLogin
        ? { credentials: { email, password: plainPassword! } }
        : {}),
    };
  }

  async updateStaff(user: JwtPayload, staffId: string, dto: UpdateStaffDto) {
    const member = await this.getStaffMember(requireClubId(user), staffId);

    const data: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      dateOfBirth?: Date | null;
      isActive?: boolean;
      password?: string;
      loginEnabled?: boolean;
      employmentKind?: 'STAFF' | 'EXTERNAL';
    } = {};

    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    }
    if (dto.employmentKind !== undefined) {
      data.employmentKind = dto.employmentKind;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) {
      const rolesAfter = dto.roles ?? member.roles
        .map((r) => r.role)
        .filter((r) =>
          ['ADMIN', 'TRAINER', 'SPECIALIST', 'TECH'].includes(r),
        ) as Array<'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH'>;
      if (!needsAppLogin(rolesAfter)) {
        throw new BadRequestException(
          'У техперсонала нет входа в приложение — пароль не задаётся',
        );
      }
      data.password = await bcrypt.hash(dto.password, 10);
    }

    if (dto.roles) {
      const roleList = [...new Set(dto.roles)];
      if (roleList.length === 0) {
        throw new BadRequestException('Оставьте хотя бы одно подразделение');
      }
      const toPrisma = (r: 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH') => {
        if (r === 'ADMIN') return Role.ADMIN;
        if (r === 'SPECIALIST') return Role.SPECIALIST;
        if (r === 'TECH') return Role.TECH;
        return Role.TRAINER;
      };
      const wanted = new Set(roleList.map(toPrisma));
      const current = member.roles
        .map((r) => r.role)
        .filter(
          (r): r is 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH' =>
            r === 'ADMIN' ||
            r === 'TRAINER' ||
            r === 'SPECIALIST' ||
            r === 'TECH',
        );
      for (const role of current) {
        if (!wanted.has(role)) {
          await this.prisma.userRole.delete({
            where: { userId_role: { userId: staffId, role } },
          });
        }
      }
      for (const role of wanted) {
        await this.prisma.userRole.upsert({
          where: { userId_role: { userId: staffId, role } },
          update: {},
          create: { userId: staffId, role },
        });
      }
      if (wanted.has(Role.ADMIN)) {
        const grantCount = await this.prisma.adminPermissionGrant.count({
          where: { userId: staffId },
        });
        if (grantCount === 0) {
          await this.adminPermissions.setPermissions(staffId, [
            AdminPermission.DASHBOARD_VIEW,
            AdminPermission.CLIENTS_VIEW,
          ]);
        }
      }
      // TECH-only → no app login; any app role → allow login.
      data.loginEnabled = needsAppLogin(roleList);
    }

    const updated = await this.prisma.user.update({
      where: { id: member.id },
      data,
      include: { roles: true },
    });

    const action = dto.isActive === false
      ? 'STAFF_DEACTIVATED'
      : dto.password
        ? 'STAFF_PASSWORD_RESET'
        : 'STAFF_UPDATED';

    await this.logAudit(user, action, staffId, {
      ...(dto.password ? { passwordReset: true } : {}),
      ...(dto.roles ? { roles: dto.roles } : {}),
    });

    const result: ReturnType<typeof this.mapStaff> & {
      credentials?: { email: string; password: string };
    } = this.mapStaff(updated);

    if (dto.password) {
      result.credentials = { email: updated.email, password: dto.password };
    }

    return result;
  }

  async getAdminPermissions(user: JwtPayload, adminId: string) {
    await this.ensureClubAdmin(requireClubId(user), adminId);
    const permissions = await this.adminPermissions.getPermissions({
      ...user,
      sub: adminId,
      roles: [UserRole.ADMIN],
    });
    return { permissions };
  }

  async setAdminPermissions(
    user: JwtPayload,
    adminId: string,
    permissions: AdminPermission[],
  ) {
    await this.ensureClubAdmin(requireClubId(user), adminId);
    await this.adminPermissions.setPermissions(adminId, permissions);
    await this.logAudit(user, 'PERMISSIONS_UPDATED', adminId, { permissions });
    return { permissions };
  }

  async listTasks(user: JwtPayload, status?: AdminTaskStatus) {
    const tasks = await this.prisma.adminTask.findMany({
      where: {
        clubId: requireClubId(user),
        ...(status ? { status: status as PrismaAdminTaskStatus } : {}),
      },
      include: { assignee: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });

    return tasks.map((task) => this.mapTask(task));
  }

  async createTask(user: JwtPayload, dto: CreateAdminTaskDto) {
    const clubId = requireClubId(user);
    await this.ensureClubAdmin(clubId, dto.assigneeId);

    const task = await this.prisma.adminTask.create({
      data: {
        clubId,
        assigneeId: dto.assigneeId,
        createdById: user.sub,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
      include: { assignee: true },
    });

    await this.prisma.notification.create({
      data: {
        userId: dto.assigneeId,
        type: 'GENERAL',
        title: 'Новая задача',
        body: dto.title,
        senderId: user.sub,
      },
    });

    await this.logAudit(user, 'TASK_CREATED', task.id, { assigneeId: dto.assigneeId });

    return this.mapTask(task);
  }

  async updateTask(
    user: JwtPayload,
    taskId: string,
    data: {
      status?: AdminTaskStatus;
      title?: string;
      description?: string;
      dueAt?: string;
    },
  ) {
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId: requireClubId(user) },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description.trim() || null }
          : {}),
        ...(data.dueAt !== undefined
          ? { dueAt: data.dueAt ? new Date(data.dueAt) : null }
          : {}),
        ...(data.status
          ? {
              status: data.status as PrismaAdminTaskStatus,
              completedAt:
                data.status === AdminTaskStatus.DONE ? new Date() : null,
            }
          : {}),
      },
      include: { assignee: true },
    });

    return this.mapTask(updated);
  }

  async listAuditLog(user: JwtPayload, limit = 50) {
    const logs = await this.prisma.staffAuditLog.findMany({
      where: { clubId: requireClubId(user) },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      targetId: log.targetId ?? undefined,
      actorName: `${log.actor.firstName} ${log.actor.lastName}`.trim(),
      meta: (log.meta as Record<string, unknown> | null) ?? undefined,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  exportStaffCsv(user: JwtPayload) {
    return this.listStaff(user).then((staff) => {
      const header = 'email,firstName,lastName,phone,roles,isActive,createdAt';
      const rows = staff.map(
        (s) =>
          `${s.email},${s.firstName},${s.lastName},${s.phone ?? ''},${s.roles.join('|')},${s.isActive},${s.createdAt}`,
      );
      return `${header}\n${rows.join('\n')}`;
    });
  }

  private async getStaffMember(clubId: string, staffId: string) {
    const member = await this.prisma.user.findFirst({
      where: {
        id: staffId,
        clubId,
        roles: { some: { role: { in: STAFF_ROLES } } },
      },
      include: { roles: true },
    });
    if (!member) throw new NotFoundException('Сотрудник не найден');
    return member;
  }

  private async ensureClubAdmin(clubId: string, userId: string) {
    const admin = await this.adminPermissions.ensureIsClubAdmin(userId, clubId);
    if (!admin) {
      throw new BadRequestException('Исполнитель должен быть администратором клуба');
    }
    return admin;
  }

  private mapStaff(member: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    dateOfBirth: Date | null;
    employeeCode: string | null;
    loginEnabled: boolean;
    isActive: boolean;
    employmentKind?: 'STAFF' | 'EXTERNAL' | string;
    createdAt: Date;
    roles: Array<{ role: Role }>;
  }) {
    const roleMap: Record<Role, UserRole> = {
      [Role.CLIENT]: UserRole.CLIENT,
      [Role.TRAINER]: UserRole.TRAINER,
      [Role.SPECIALIST]: UserRole.SPECIALIST,
      [Role.TECH]: UserRole.TECH,
      [Role.ADMIN]: UserRole.ADMIN,
      [Role.SUPER_ADMIN]: UserRole.SUPER_ADMIN,
    };

    return {
      id: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone ?? undefined,
      dateOfBirth: member.dateOfBirth?.toISOString().slice(0, 10),
      employeeCode: member.employeeCode ?? undefined,
      loginEnabled: member.loginEnabled,
      roles: member.roles.map((r) => roleMap[r.role]),
      isActive: member.isActive,
      employmentKind:
        member.employmentKind === 'EXTERNAL' ? 'EXTERNAL' : 'STAFF',
      createdAt: member.createdAt.toISOString(),
    };
  }

  private mapTask(task: {
    id: string;
    title: string;
    description: string | null;
    status: PrismaAdminTaskStatus;
    dueAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    assignee: { id: string; firstName: string; lastName: string };
  }) {
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status as AdminTaskStatus,
      dueAt: task.dueAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
      assignee: {
        id: task.assignee.id,
        firstName: task.assignee.firstName,
        lastName: task.assignee.lastName,
      },
      createdAt: task.createdAt.toISOString(),
    };
  }

  async getClubProfile(user: JwtPayload) {
    const club = await this.prisma.club.findUnique({
      where: { id: requireClubId(user) },
      include: { theme: true },
    });
    if (!club) throw new NotFoundException('Клуб не найден');
    return {
      id: club.id,
      name: club.name,
      slug: club.slug,
      address: club.address ?? undefined,
      phone: club.phone ?? undefined,
      website: club.website ?? undefined,
      currency: club.currency,
      externalId: club.externalId ?? undefined,
      workingHours: club.workingHours ?? undefined,
      theme: {
        clubName: club.name,
        logoUrl: club.theme?.logoUrl ?? undefined,
        primaryColor: club.theme?.primaryColor ?? '#14b88a',
        address: club.address ?? undefined,
        phone: club.phone ?? undefined,
        website: club.website ?? undefined,
      },
    };
  }

  async updateClubProfile(
    user: JwtPayload,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      website?: string;
      logoUrl?: string;
      primaryColor?: string;
      workingHours?: Record<string, unknown>;
    },
  ) {
    const clubId = requireClubId(user);
    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.address !== undefined
          ? { address: data.address.trim() || null }
          : {}),
        ...(data.phone !== undefined ? { phone: data.phone.trim() || null } : {}),
        ...(data.website !== undefined
          ? { website: data.website.trim() || null }
          : {}),
        ...(data.workingHours !== undefined
          ? { workingHours: data.workingHours as Prisma.InputJsonValue }
          : {}),
      },
    });

    if (data.logoUrl !== undefined || data.primaryColor !== undefined) {
      await this.prisma.clubTheme.upsert({
        where: { clubId },
        update: {
          ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl || null } : {}),
          ...(data.primaryColor !== undefined
            ? { primaryColor: data.primaryColor }
            : {}),
        },
        create: {
          clubId,
          logoUrl: data.logoUrl || null,
          primaryColor: data.primaryColor ?? '#14b88a',
        },
      });
    }

    await this.logAudit(user, 'CLUB_PROFILE_UPDATED', clubId, {
      fields: Object.keys(data),
    });
    return this.getClubProfile(user);
  }

  private async logAudit(
    user: JwtPayload,
    action: string,
    targetId?: string,
    meta?: Record<string, unknown>,
  ) {
    await this.prisma.staffAuditLog.create({
      data: {
        clubId: requireClubId(user),
        actorId: user.sub,
        action,
        targetId: targetId ?? null,
        meta: meta ? (meta as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
