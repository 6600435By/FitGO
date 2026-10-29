import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  AdminPermission,
  AdminTaskPriority,
  AdminTaskStatus,
  UserRole,
} from '@fitgo/shared-types';
import {
  AdminTaskAssignMode,
  AdminTaskEventKind,
  AdminTaskPriority as PrismaAdminTaskPriority,
  AdminTaskRecurrence,
  AdminTaskStatus as PrismaAdminTaskStatus,
  Prisma,
  Role,
  StaffShiftTrack,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { adminTaskTopic } from '../admin/task-topic';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { AdminPermissionsService } from '../auth/admin-permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTasksSchedulerService } from './admin-tasks-scheduler.service';
import { ackDiscrepancyFromTask } from '../discrepancies/discrepancy-task-ack';
import type {
  BulkUpdateAdminTasksDto,
  CreateAdminTaskDto,
  CreateAdminTaskTemplateDto,
  ReworkAdminTaskDto,
  UpsertAdminTaskRuleDto,
} from './dto/task.dto';
import type { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { randomBytes } from 'crypto';
import {
  ADMIN_TASK_RULE_CATALOG,
  ADMIN_TASK_RULE_SOURCES,
  defaultRuleForSource,
  type AdminTaskRuleSourceKey,
} from './admin-task-rules.catalog';
import {
  allocateStaffAppPassword,
  isValidStaffAppPassword,
} from '../auth/staff-app-password';
import { allocateStaffLogin, isCodeStubEmail } from '../auth/staff-login';
import { PayrollService } from '../payroll/payroll.service';

const STAFF_ROLES: Role[] = [
  Role.ADMIN,
  Role.MANAGER,
  Role.TRAINER,
  Role.SPECIALIST,
  Role.TECH,
];

const APP_LOGIN_ROLES = new Set([
  'ADMIN',
  'MANAGER',
  'TRAINER',
  'SPECIALIST',
]);

type StaffRoleLabel =
  | 'ADMIN'
  | 'MANAGER'
  | 'TRAINER'
  | 'SPECIALIST'
  | 'TECH';

function needsAppLogin(roles: StaffRoleLabel[]): boolean {
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

function toStaffPrismaRole(r: StaffRoleLabel): Role {
  if (r === 'ADMIN') return Role.ADMIN;
  if (r === 'MANAGER') return Role.MANAGER;
  if (r === 'SPECIALIST') return Role.SPECIALIST;
  if (r === 'TECH') return Role.TECH;
  return Role.TRAINER;
}

function isStaffRoleLabel(r: string): r is StaffRoleLabel {
  return (
    r === 'ADMIN' ||
    r === 'MANAGER' ||
    r === 'TRAINER' ||
    r === 'SPECIALIST' ||
    r === 'TECH'
  );
}

@Injectable()
export class SuperAdminService implements OnModuleInit {
  private readonly logger = new Logger(SuperAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminPermissions: AdminPermissionsService,
    private readonly tasksScheduler: AdminTasksSchedulerService,
    private readonly payroll: PayrollService,
  ) {}

  async onModuleInit() {
    try {
      const clubs = await this.prisma.club.findMany({ select: { id: true } });
      for (const club of clubs) {
        await this.normalizeCodeLogins(club.id);
      }
    } catch (err) {
      this.logger.warn(
        `Staff login normalize skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Rewrites 1C-code logins (`000000173@staff.fitgo.local`, `1c-…@fitgo.local`) to the surname. */
  async normalizeCodeLogins(clubId: string) {
    const stubs = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: { in: STAFF_ROLES } } },
      },
      select: { id: true, email: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { createdAt: 'asc' }],
    });
    for (const member of stubs) {
      if (!isCodeStubEmail(member.email)) continue;
      const email = await allocateStaffLogin(
        this.prisma,
        member.lastName,
        member.id,
      );
      if (email.toLowerCase() === member.email.toLowerCase()) continue;
      await this.prisma.user.update({
        where: { id: member.id },
        data: { email },
      });
      this.logger.log(`Staff login ${member.email} → ${email}`);
    }
  }

  async listStaff(user: JwtPayload, opts: { archived?: boolean } = {}) {
    const clubId = requireClubId(user);
    await this.normalizeCodeLogins(clubId);
    const staff = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: { in: STAFF_ROLES } } },
        ...(opts.archived
          ? { archivedAt: { not: null } }
          : { archivedAt: null }),
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const pending = staff.filter(
      (member) =>
        !member.trainerGroupsSet &&
        member.roles.some((r) => r.role === Role.TRAINER),
    );
    if (pending.length) {
      const toStaff = pending.filter(
        (member) =>
          !member.groupPrograms &&
          !member.trainerStaff &&
          !member.trainerClub &&
          !member.trainerReformers,
      );
      const rest = pending.filter((member) => !toStaff.includes(member));
      if (toStaff.length) {
        await this.prisma.user.updateMany({
          where: { id: { in: toStaff.map((member) => member.id) } },
          data: { trainerStaff: true, trainerGroupsSet: true },
        });
        for (const member of toStaff) {
          member.trainerStaff = true;
          member.trainerGroupsSet = true;
        }
      }
      if (rest.length) {
        await this.prisma.user.updateMany({
          where: { id: { in: rest.map((member) => member.id) } },
          data: { trainerGroupsSet: true },
        });
        for (const member of rest) member.trainerGroupsSet = true;
      }
    }

    return staff.map((member) => this.mapStaff(member));
  }

  async archiveStaff(user: JwtPayload, staffId: string) {
    const clubId = requireClubId(user);
    const member = await this.getStaffMember(clubId, staffId);
    if (member.archivedAt) {
      return this.mapStaff(member);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: staffId },
        data: {
          archivedAt: new Date(),
          isActive: false,
          loginEnabled: false,
        },
      }),
      this.prisma.staffShift.deleteMany({
        where: { userId: staffId, clubId, date: { gte: today } },
      }),
      this.prisma.trainerShift.deleteMany({
        where: { trainerId: staffId, clubId, date: { gte: today } },
      }),
    ]);
    await this.logAudit(user, 'STAFF_ARCHIVED', staffId, {});
    const updated = await this.getStaffMember(clubId, staffId);
    return this.mapStaff(updated);
  }

  async restoreStaff(user: JwtPayload, staffId: string) {
    const clubId = requireClubId(user);
    const member = await this.getStaffMember(clubId, staffId);
    if (!member.archivedAt) {
      return this.mapStaff(member);
    }
    await this.prisma.user.update({
      where: { id: staffId },
      data: {
        archivedAt: null,
        isActive: true,
      },
    });
    await this.logAudit(user, 'STAFF_RESTORED', staffId, {});
    const updated = await this.getStaffMember(clubId, staffId);
    return this.mapStaff(updated);
  }

  async createStaff(user: JwtPayload, dto: CreateStaffDto) {
    const roleList = [
      ...new Set(
        (dto.roles?.length ? dto.roles : dto.role ? [dto.role] : []) as StaffRoleLabel[],
      ),
    ];
    if (roleList.length === 0) {
      throw new BadRequestException(
        'Укажите хотя бы одно подразделение: управляющий, админ, тренер, SPA или техперсонал',
      );
    }

    const needsLogin = needsAppLogin(roleList);
    const requested = (dto.email ?? '').trim();
    const email = needsLogin
      ? requested
        ? requested.includes('@')
          ? requested.toLowerCase()
          : requested
        : await allocateStaffLogin(this.prisma, dto.lastName)
      : techPlaceholderEmail(dto.firstName.trim(), dto.lastName.trim());
    const plainPassword = needsLogin
      ? await allocateStaffAppPassword(this.prisma, {
          preferred: dto.password,
        })
      : randomBytes(24).toString('hex');
    if (needsLogin && !isValidStaffAppPassword(plainPassword)) {
      throw new BadRequestException('Пароль не меньше 6 символов');
    }

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('Пользователь с таким логином уже существует');
    }

    const passwordHash = await bcrypt.hash(plainPassword!, 10);
    const clubId = requireClubId(user);
    const isTrainer = roleList.includes('TRAINER');
    const groupPrograms = isTrainer && !!dto.groupPrograms;
    const trainerClub = isTrainer && !!dto.trainerClub;
    const trainerReformers = isTrainer && !!dto.trainerReformers;
    const trainerStaff = isTrainer
      ? dto.trainerStaff !== undefined
        ? dto.trainerStaff
        : !groupPrograms && !trainerClub && !trainerReformers
      : false;

    const created = await this.prisma.user.create({
      data: {
        clubId,
        email,
        password: passwordHash,
        appPasswordPlain: needsLogin ? plainPassword! : null,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim() || null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        createdById: user.sub,
        loginEnabled: needsLogin,
        groupPrograms,
        trainerStaff,
        trainerClub,
        trainerReformers,
        trainerGroupsSet: isTrainer,
        roles: {
          create: roleList.map((r) => ({ role: toStaffPrismaRole(r) })),
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

    try {
      await this.payroll.applyPayTemplatesForNewUser(clubId, created.id);
    } catch (err) {
      this.logger.warn(
        `Pay template for new staff ${created.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
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
      appPasswordPlain?: string | null;
      loginEnabled?: boolean;
      employmentKind?: 'STAFF' | 'EXTERNAL';
      email?: string;
      groupPrograms?: boolean;
      trainerStaff?: boolean;
      trainerClub?: boolean;
      trainerReformers?: boolean;
      trainerGroupsSet?: boolean;
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
    if (
      dto.groupPrograms !== undefined ||
      dto.trainerStaff !== undefined ||
      dto.trainerClub !== undefined ||
      dto.trainerReformers !== undefined
    ) {
      if (dto.groupPrograms !== undefined) data.groupPrograms = dto.groupPrograms;
      if (dto.trainerStaff !== undefined) data.trainerStaff = dto.trainerStaff;
      if (dto.trainerClub !== undefined) data.trainerClub = dto.trainerClub;
      if (dto.trainerReformers !== undefined)
        data.trainerReformers = dto.trainerReformers;
      data.trainerGroupsSet = true;
    }
    if (dto.email !== undefined) {
      const raw = dto.email.trim();
      if (!raw || raw.length > 80) {
        throw new BadRequestException('Укажите логин');
      }
      const email = raw.includes('@') ? raw.toLowerCase() : raw;
      const taken = await this.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          NOT: { id: staffId },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException('Пользователь с таким логином уже существует');
      }
      data.email = email;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const rolesAfter = (dto.roles ??
      member.roles.map((r) => r.role).filter(isStaffRoleLabel)) as StaffRoleLabel[];
    const canHaveAppLogin = needsAppLogin(rolesAfter);

    let plainPasswordForResult: string | undefined;
    if (dto.password) {
      if (!canHaveAppLogin) {
        throw new BadRequestException(
          'У техперсонала нет входа в приложение — пароль не задаётся',
        );
      }
      const plain = await allocateStaffAppPassword(this.prisma, {
        excludeUserId: staffId,
        preferred: dto.password,
      });
      data.password = await bcrypt.hash(plain, 10);
      data.appPasswordPlain = plain;
      plainPasswordForResult = plain;
    }

    if (dto.loginEnabled === true) {
      if (!canHaveAppLogin) {
        throw new BadRequestException(
          'У техперсонала нет входа в приложение',
        );
      }
      if (!dto.password || !isValidStaffAppPassword(dto.password)) {
        throw new BadRequestException(
          'Чтобы открыть вход, задайте пароль не короче 6 символов',
        );
      }
      data.loginEnabled = true;
    } else if (dto.loginEnabled === false) {
      data.loginEnabled = false;
    }

    if (dto.roles) {
      const roleList = [...new Set(dto.roles)] as StaffRoleLabel[];
      if (roleList.length === 0) {
        throw new BadRequestException('Оставьте хотя бы одно подразделение');
      }
      const wanted = new Set(roleList.map(toStaffPrismaRole));
      const current = member.roles
        .map((r) => r.role)
        .filter(isStaffRoleLabel);
      for (const role of current) {
        if (!wanted.has(role as Role)) {
          await this.prisma.userRole.delete({
            where: { userId_role: { userId: staffId, role: role as Role } },
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
      // TECH-only → force close login. App roles do not auto-open access.
      if (!needsAppLogin(roleList)) {
        data.loginEnabled = false;
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: member.id },
      data,
      include: { roles: true },
    });

    const openingLogin = dto.loginEnabled === true;
    const action = dto.isActive === false
      ? 'STAFF_DEACTIVATED'
      : openingLogin
        ? 'STAFF_LOGIN_OPENED'
        : dto.loginEnabled === false
          ? 'STAFF_LOGIN_CLOSED'
          : dto.password
            ? 'STAFF_PASSWORD_RESET'
            : 'STAFF_UPDATED';

    await this.logAudit(user, action, staffId, {
      ...(dto.password ? { passwordReset: true } : {}),
      ...(dto.loginEnabled !== undefined
        ? { loginEnabled: dto.loginEnabled }
        : {}),
      ...(dto.roles ? { roles: dto.roles } : {}),
    });

    const result: ReturnType<typeof this.mapStaff> & {
      credentials?: { email: string; password: string };
    } = this.mapStaff(updated);

    if (plainPasswordForResult) {
      result.credentials = {
        email: updated.email,
        password: plainPasswordForResult,
      };
    }

    return result;
  }

  async suggestStaffPassword(_user: JwtPayload) {
    const password = await allocateStaffAppPassword(this.prisma);
    return { password };
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

  async listTasks(
    user: JwtPayload,
    status?: AdminTaskStatus,
    opts?: { assigneeId?: string; onShift?: boolean },
  ) {
    const clubId = requireClubId(user);
    // Same merge path as admin queue: cancel legacy per-sale debt:* rows.
    try {
      await this.tasksScheduler.refreshDebtors(clubId);
    } catch {
      // non-fatal
    }
    this.tasksScheduler.refreshBirthdaysNonBlocking(clubId);

    // Hide legacy per-sale debt tasks; keep aggregated debtor:* only.
    const hideLegacy = {
      NOT: {
        OR: [
          { source: 'DEBT_OVERDUE' },
          {
            source: { in: ['STAFF_DEBT', 'CLIENT_DEBT'] },
            dedupeKey: { startsWith: 'debt:' },
          },
        ],
      },
    };
    const taskInclude = {
      assignee: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    } as const;

    let onShiftIds: Set<string> | null = null;
    if (opts?.onShift) {
      const now = new Date();
      const shifts = await this.prisma.staffShift.findMany({
        where: {
          clubId,
          track: StaffShiftTrack.ADMIN,
          startAt: { lte: now },
          endAt: { gte: now },
        },
        select: { userId: true },
      });
      onShiftIds = new Set(shifts.map((s) => s.userId));
    }

    const assigneeFilter = opts?.assigneeId
      ? { assigneeId: opts.assigneeId }
      : {};

    // OPEN is the first enum value, so a single take ordered by status
    // drops IN_PROGRESS once the open queue is large. Load them separately.
    // DONE for last 7 days — manager can send older closes for rework.
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - 7);
    dayStart.setHours(0, 0, 0, 0);

    const tasks = status
      ? await this.prisma.adminTask.findMany({
          where: {
            clubId,
            status: status as PrismaAdminTaskStatus,
            ...hideLegacy,
            ...assigneeFilter,
          },
          include: taskInclude,
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
          take: 500,
        })
      : (
          await Promise.all([
            this.prisma.adminTask.findMany({
              where: {
                clubId,
                status: PrismaAdminTaskStatus.IN_PROGRESS,
                ...hideLegacy,
                ...assigneeFilter,
              },
              include: taskInclude,
              orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
              take: 300,
            }),
            this.prisma.adminTask.findMany({
              where: {
                clubId,
                status: PrismaAdminTaskStatus.OPEN,
                ...hideLegacy,
                ...assigneeFilter,
              },
              include: taskInclude,
              orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
              take: 400,
            }),
            this.prisma.adminTask.findMany({
              where: {
                clubId,
                status: PrismaAdminTaskStatus.DONE,
                completedAt: { gte: dayStart },
                ...hideLegacy,
                ...assigneeFilter,
              },
              include: taskInclude,
              orderBy: [{ completedAt: 'desc' }],
              take: 100,
            }),
          ])
        ).flat();

    const filtered =
      onShiftIds == null
        ? tasks
        : tasks.filter(
            (t) =>
              !t.assigneeId ||
              onShiftIds!.has(t.assigneeId) ||
              t.status === PrismaAdminTaskStatus.OPEN,
          );

    const saleIds = filtered
      .map((task) => task.relatedSaleId)
      .filter((id): id is string => !!id);
    const sales = saleIds.length
      ? await this.prisma.saleTransaction.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, clientName: true },
        })
      : [];
    const clientBySale = new Map(sales.map((sale) => [sale.id, sale.clientName]));

    const groupIds = [
      ...new Set(
        filtered.map((t) => t.groupId).filter((id): id is string => !!id),
      ),
    ];
    const groupStats = new Map<
      string,
      { total: number; done: number; assignees: string[] }
    >();
    if (groupIds.length) {
      const siblings = await this.prisma.adminTask.findMany({
        where: { clubId, groupId: { in: groupIds } },
        include: {
          assignee: { select: { firstName: true, lastName: true } },
        },
      });
      for (const g of groupIds) {
        const rows = siblings.filter((s) => s.groupId === g);
        groupStats.set(g, {
          total: rows.length,
          done: rows.filter(
            (r) =>
              r.status === PrismaAdminTaskStatus.DONE ||
              r.status === PrismaAdminTaskStatus.CANCELLED,
          ).length,
          assignees: rows
            .map((r) =>
              r.assignee
                ? `${r.assignee.firstName} ${r.assignee.lastName}`.trim()
                : '',
            )
            .filter(Boolean),
        });
      }
    }

    const reworkMeta = await this.loadLatestReworkMeta(
      filtered.filter((t) => t.reworkCount > 0).map((t) => t.id),
    );

    return filtered.map((task) => {
      const item = this.mapTask(
        task,
        clientBySale.get(task.relatedSaleId ?? '') ?? null,
      );
      if (task.groupId) {
        const stats = groupStats.get(task.groupId);
        if (stats) {
          item.groupProgress = {
            done: stats.done,
            total: stats.total,
            assignees: stats.assignees,
          };
        }
      }
      const rw = reworkMeta.get(task.id);
      if (rw) {
        item.reworkComment = rw.comment;
        item.reworkAt = rw.createdAt;
      }
      return item;
    });
  }

  async reworkTask(
    user: JwtPayload,
    taskId: string,
    dto: ReworkAdminTaskDto,
  ) {
    const clubId = requireClubId(user);
    const comment = dto.comment.trim();
    if (comment.length < 2) {
      throw new BadRequestException('Укажите комментарий для доработки');
    }
    const pool = dto.pool === true;
    if (!pool && !dto.assigneeId?.trim()) {
      throw new BadRequestException(
        'Выберите сотрудника или всё подразделение',
      );
    }

    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    if (task.status !== PrismaAdminTaskStatus.DONE) {
      throw new BadRequestException(
        'На доработку можно вернуть только выполненную задачу',
      );
    }

    let assigneeId: string | null = null;
    if (!pool) {
      assigneeId = dto.assigneeId!.trim();
      await this.ensureClubAdmin(clubId, assigneeId);
    }

    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : (() => {
          const d = new Date();
          d.setHours(23, 59, 0, 0);
          return d;
        })();

    const needsSuppress = ![
      'MANAGER',
      'MANUAL',
      'DISCREPANCY',
    ].includes(task.source);

    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        status: pool
          ? PrismaAdminTaskStatus.OPEN
          : PrismaAdminTaskStatus.IN_PROGRESS,
        assigneeId,
        completedAt: null,
        dueAt,
        nextActionAt: null,
        reworkCount: { increment: 1 },
        suppressAutoClose: needsSuppress ? true : false,
      },
      include: {
        assignee: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const targetLabel = pool
      ? 'общая очередь'
      : updated.assignee
        ? `${updated.assignee.firstName} ${updated.assignee.lastName}`.trim()
        : assigneeId;

    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        kind: AdminTaskEventKind.REWORK,
        comment: `Доработка → ${targetLabel}: ${comment}`,
      },
    });

    if (assigneeId) {
      await this.prisma.notification.create({
        data: {
          userId: assigneeId,
          type: 'GENERAL',
          title: 'Задача на доработку',
          body: `${updated.title}: ${comment}`,
          senderId: user.sub,
        },
      });
    } else {
      const admins = await this.prisma.user.findMany({
        where: {
          clubId,
          isActive: true,
          archivedAt: null,
          roles: { some: { role: Role.ADMIN } },
        },
        select: { id: true },
        take: 40,
      });
      for (const a of admins) {
        await this.prisma.notification.create({
          data: {
            userId: a.id,
            type: 'GENERAL',
            title: 'Задача на доработку (очередь)',
            body: `${updated.title}: ${comment}`,
            senderId: user.sub,
          },
        });
      }
    }

    await this.logAudit(user, 'TASK_REWORK', taskId, {
      pool,
      assigneeId,
      comment,
    });

    const item = this.mapTask(updated);
    item.reworkComment = comment;
    item.reworkAt = new Date().toISOString();
    return item;
  }

  async listTaskRules(user: JwtPayload) {
    const clubId = requireClubId(user);
    const rows = await this.prisma.adminTaskRule.findMany({
      where: { clubId },
    });
    const bySource = new Map(rows.map((r) => [r.source, r]));
    return ADMIN_TASK_RULE_CATALOG.map((cat) => {
      const row = bySource.get(cat.source);
      if (!row) return defaultRuleForSource(cat.source);
      return {
        source: cat.source,
        label: cat.label,
        enabled: row.enabled,
        assignMode: row.assignMode as 'POOL' | 'USERS' | 'ON_SHIFT',
        assigneeIds: row.assigneeIds,
        duePolicy: row.duePolicy as
          | 'END_OF_DAY'
          | 'HOURS_BEFORE_EVENT'
          | 'HOURS_AFTER_CREATE',
        dueHours: row.dueHours,
        params: {
          ...cat.defaultParams,
          ...((row.params as Record<string, unknown> | null) ?? {}),
        },
      };
    });
  }

  async putTaskRules(user: JwtPayload, rules: UpsertAdminTaskRuleDto[]) {
    const clubId = requireClubId(user);
    for (const rule of rules) {
      if (!ADMIN_TASK_RULE_SOURCES.has(rule.source as AdminTaskRuleSourceKey)) {
        throw new BadRequestException(`Неизвестный тип: ${rule.source}`);
      }
      if (rule.assignMode === 'USERS') {
        const ids = rule.assigneeIds ?? [];
        if (!ids.length) {
          throw new BadRequestException(
            `${rule.source}: выберите сотрудников`,
          );
        }
        for (const id of ids) {
          await this.ensureClubAdmin(clubId, id);
        }
      }
      const paramsJson = (rule.params ?? {}) as Prisma.InputJsonValue;
      await this.prisma.adminTaskRule.upsert({
        where: {
          clubId_source: { clubId, source: rule.source },
        },
        create: {
          clubId,
          source: rule.source,
          enabled: rule.enabled,
          assignMode: rule.assignMode,
          assigneeIds: rule.assigneeIds ?? [],
          duePolicy: rule.duePolicy,
          dueHours: rule.dueHours ?? null,
          params: paramsJson,
        },
        update: {
          enabled: rule.enabled,
          assignMode: rule.assignMode,
          assigneeIds: rule.assigneeIds ?? [],
          duePolicy: rule.duePolicy,
          dueHours: rule.dueHours ?? null,
          params: paramsJson,
        },
      });
    }
    await this.logAudit(user, 'TASK_RULES_UPDATED', clubId, {
      count: rules.length,
    });
    return this.listTaskRules(user);
  }

  private async loadLatestReworkMeta(taskIds: string[]) {
    const map = new Map<string, { comment: string; createdAt: string }>();
    if (!taskIds.length) return map;
    const events = await this.prisma.adminTaskEvent.findMany({
      where: {
        taskId: { in: taskIds },
        kind: AdminTaskEventKind.REWORK,
      },
      orderBy: { createdAt: 'desc' },
      select: { taskId: true, comment: true, createdAt: true },
    });
    for (const e of events) {
      if (map.has(e.taskId)) continue;
      map.set(e.taskId, {
        comment: e.comment ?? '',
        createdAt: e.createdAt.toISOString(),
      });
    }
    return map;
  }

  async createTask(user: JwtPayload, dto: CreateAdminTaskDto) {
    const clubId = requireClubId(user);
    let assigneeIds = [
      ...new Set(
        (dto.assigneeIds?.length
          ? dto.assigneeIds
          : dto.assigneeId
            ? [dto.assigneeId]
            : []
        )
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];

    if (dto.onShift) {
      const now = new Date();
      const shifts = await this.prisma.staffShift.findMany({
        where: {
          clubId,
          track: StaffShiftTrack.ADMIN,
          startAt: { lte: now },
          endAt: { gte: now },
        },
        select: { userId: true },
      });
      assigneeIds = [...new Set(shifts.map((s) => s.userId))];
      if (!assigneeIds.length) {
        throw new BadRequestException('Сейчас никто не на смене');
      }
    }

    const pool = dto.pool === true && !dto.onShift && assigneeIds.length === 0;
    if (!pool && !assigneeIds.length) {
      throw new BadRequestException(
        'Выберите администратора, смену или общую очередь',
      );
    }
    for (const id of assigneeIds) {
      await this.ensureClubAdmin(clubId, id);
    }

    const completionMode =
      dto.completionMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL';
    const groupId =
      assigneeIds.length > 1 || completionMode === 'SHARED'
        ? `mgr_${randomBytes(8).toString('hex')}`
        : null;
    const title = dto.title.trim();
    const description = dto.description?.trim() || null;
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    const priority =
      (dto.priority as PrismaAdminTaskPriority | undefined) ??
      PrismaAdminTaskPriority.NORMAL;
    const checklist =
      dto.checklist?.filter((x) => x.trim()).map((x) => x.trim()) ?? [];

    const targets = pool ? [null as string | null] : assigneeIds;
    const created = [];
    for (const assigneeId of targets) {
      const task = await this.prisma.adminTask.create({
        data: {
          clubId,
          assigneeId,
          createdById: user.sub,
          title,
          description,
          dueAt,
          source: 'MANAGER',
          groupId,
          completionMode,
          priority,
          checklist: checklist.length ? checklist : undefined,
        },
        include: {
          assignee: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      created.push(task);
      if (assigneeId) {
        await this.prisma.notification.create({
          data: {
            userId: assigneeId,
            type: 'GENERAL',
            title: 'Новая задача от руководителя',
            body: title,
            senderId: user.sub,
          },
        });
      }
    }

    await this.logAudit(user, 'TASK_CREATED', created[0]?.id ?? '', {
      assigneeIds,
      pool,
      groupId,
      completionMode,
      priority,
    });

    return created.map((task) => this.mapTask(task));
  }

  async bulkUpdateTasks(user: JwtPayload, dto: BulkUpdateAdminTasksDto) {
    const results = [];
    for (const id of dto.ids) {
      results.push(
        await this.updateTask(user, id, {
          status: dto.status,
          dueAt: dto.dueAt,
          assigneeId: dto.assigneeId,
          priority: dto.priority,
          comment: dto.comment,
        }),
      );
    }
    return results;
  }

  async getTaskEvents(user: JwtPayload, taskId: string) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    const events = await this.prisma.adminTaskEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        actor: { select: { firstName: true, lastName: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      kind: e.kind,
      stage: e.stage ?? undefined,
      comment: e.comment ?? undefined,
      actorName: e.actor
        ? `${e.actor.firstName} ${e.actor.lastName}`.trim()
        : undefined,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async listTaskTemplates(user: JwtPayload) {
    const clubId = requireClubId(user);
    const rows = await this.prisma.adminTaskTemplate.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.mapTemplate(r));
  }

  async createTaskTemplate(user: JwtPayload, dto: CreateAdminTaskTemplateDto) {
    const clubId = requireClubId(user);
    const row = await this.prisma.adminTaskTemplate.create({
      data: {
        clubId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority:
          (dto.priority as PrismaAdminTaskPriority | undefined) ??
          PrismaAdminTaskPriority.NORMAL,
        checklist: dto.checklist?.filter(Boolean) ?? [],
        assignMode: (dto.assignMode as AdminTaskAssignMode) ?? 'USERS',
        assigneeIds: dto.assigneeIds ?? [],
        recurrence: (dto.recurrence as AdminTaskRecurrence) ?? 'NONE',
        generateHour: dto.generateHour ?? 9,
        recurrenceDay: dto.recurrenceDay ?? null,
        enabled: dto.enabled !== false,
        createdById: user.sub,
      },
    });
    return this.mapTemplate(row);
  }

  async deleteTaskTemplate(user: JwtPayload, id: string) {
    const clubId = requireClubId(user);
    const row = await this.prisma.adminTaskTemplate.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException('Шаблон не найден');
    await this.prisma.adminTaskTemplate.delete({ where: { id } });
    return { ok: true };
  }

  private mapTemplate(r: {
    id: string;
    clubId: string;
    title: string;
    description: string | null;
    priority: PrismaAdminTaskPriority;
    checklist: unknown;
    assignMode: AdminTaskAssignMode;
    assigneeIds: string[];
    recurrence: AdminTaskRecurrence;
    generateHour: number | null;
    recurrenceDay: number | null;
    enabled: boolean;
    lastGeneratedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      clubId: r.clubId,
      title: r.title,
      description: r.description ?? undefined,
      priority: r.priority as AdminTaskPriority,
      checklist: Array.isArray(r.checklist)
        ? (r.checklist as string[])
        : undefined,
      assignMode: r.assignMode,
      assigneeIds: r.assigneeIds,
      recurrence: r.recurrence,
      generateHour: r.generateHour,
      recurrenceDay: r.recurrenceDay,
      enabled: r.enabled,
      lastGeneratedAt: r.lastGeneratedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async updateTask(
    user: JwtPayload,
    taskId: string,
    data: {
      status?: AdminTaskStatus;
      title?: string;
      description?: string;
      dueAt?: string;
      assigneeId?: string | null;
      priority?: AdminTaskPriority;
      comment?: string;
    },
  ) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId },
      include: {
        assignee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    if (data.status === AdminTaskStatus.CANCELLED) {
      const c = data.comment?.trim() ?? '';
      if (c.length < 2) {
        throw new BadRequestException('Укажите причину отмены');
      }
    }

    let nextAssigneeId: string | null | undefined = undefined;
    if (data.assigneeId !== undefined) {
      const raw = data.assigneeId?.trim() || null;
      if (raw) {
        await this.ensureClubAdmin(clubId, raw);
        nextAssigneeId = raw;
      } else {
        nextAssigneeId = null;
      }
    }

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
        ...(data.priority
          ? { priority: data.priority as PrismaAdminTaskPriority }
          : {}),
        ...(nextAssigneeId !== undefined
          ? {
              assigneeId: nextAssigneeId,
              ...(nextAssigneeId
                ? { status: PrismaAdminTaskStatus.IN_PROGRESS }
                : !data.status
                  ? { status: PrismaAdminTaskStatus.OPEN }
                  : {}),
            }
          : {}),
        ...(data.status
          ? {
              status: data.status as PrismaAdminTaskStatus,
              completedAt:
                data.status === AdminTaskStatus.DONE ? new Date() : null,
              ...(data.status === AdminTaskStatus.DONE
                ? { suppressAutoClose: false, blockedReason: null }
                : {}),
            }
          : {}),
      },
      include: {
        assignee: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (nextAssigneeId !== undefined && nextAssigneeId !== task.assigneeId) {
      const label = updated.assignee
        ? `${updated.assignee.firstName} ${updated.assignee.lastName}`.trim()
        : 'общая очередь';
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId,
          actorId: user.sub,
          kind: AdminTaskEventKind.ASSIGN,
          comment: `Назначен: ${label}`,
        },
      });
      if (nextAssigneeId) {
        await this.prisma.notification.create({
          data: {
            userId: nextAssigneeId,
            type: 'GENERAL',
            title: 'Назначена задача',
            body: updated.title,
            senderId: user.sub,
          },
        });
      }
    }

    if (data.status === AdminTaskStatus.CANCELLED && data.comment?.trim()) {
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId,
          actorId: user.sub,
          kind: AdminTaskEventKind.STATUS,
          comment: `Отмена: ${data.comment.trim()}`,
        },
      });
    }

    if (
      data.status === AdminTaskStatus.DONE &&
      task.groupId &&
      task.completionMode === 'SHARED'
    ) {
      const actorName = task.assignee
        ? `${task.assignee.firstName} ${task.assignee.lastName}`.trim()
        : 'админ';
      const siblings = await this.prisma.adminTask.findMany({
        where: {
          clubId,
          groupId: task.groupId,
          id: { not: taskId },
          status: {
            in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS],
          },
        },
      });
      for (const sib of siblings) {
        await this.prisma.adminTask.update({
          where: { id: sib.id },
          data: {
            status: PrismaAdminTaskStatus.DONE,
            completedAt: new Date(),
            suppressAutoClose: false,
          },
        });
        await this.prisma.adminTaskEvent.create({
          data: {
            taskId: sib.id,
            actorId: user.sub,
            kind: AdminTaskEventKind.STATUS,
            comment: `Выполнил: ${actorName} (общее задание)`,
          },
        });
      }
    }

    if (data.status === AdminTaskStatus.DONE) {
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId,
          actorId: user.sub,
          kind: AdminTaskEventKind.STATUS,
          comment: 'Выполнена',
        },
      });
      await ackDiscrepancyFromTask(this.prisma, task, user.sub);
    }

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
    appPasswordPlain?: string | null;
    groupPrograms?: boolean;
    trainerStaff?: boolean;
    trainerClub?: boolean;
    trainerReformers?: boolean;
    isActive: boolean;
    archivedAt?: Date | null;
    employmentKind?: 'STAFF' | 'EXTERNAL' | string;
    excludeFromPayrollMotivation?: boolean;
    createdAt: Date;
    roles: Array<{ role: Role }>;
  }) {
    const roleMap: Record<Role, UserRole> = {
      [Role.CLIENT]: UserRole.CLIENT,
      [Role.TRAINER]: UserRole.TRAINER,
      [Role.SPECIALIST]: UserRole.SPECIALIST,
      [Role.TECH]: UserRole.TECH,
      [Role.ADMIN]: UserRole.ADMIN,
      [Role.MANAGER]: UserRole.MANAGER,
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
      appPassword: member.appPasswordPlain ?? null,
      groupPrograms: member.groupPrograms ?? false,
      trainerStaff: member.trainerStaff ?? false,
      trainerClub: member.trainerClub ?? false,
      trainerReformers: member.trainerReformers ?? false,
      roles: member.roles.map((r) => roleMap[r.role]),
      isActive: member.isActive,
      archivedAt: member.archivedAt?.toISOString() ?? null,
      employmentKind:
        member.employmentKind === 'EXTERNAL' ? 'EXTERNAL' : 'STAFF',
      excludeFromPayrollMotivation:
        member.excludeFromPayrollMotivation ?? false,
      createdAt: member.createdAt.toISOString(),
    };
  }

  private mapTask(
    task: {
      id: string;
      title: string;
      description: string | null;
      status: PrismaAdminTaskStatus;
      dueAt: Date | null;
      completedAt: Date | null;
      createdAt: Date;
      source?: string | null;
      dedupeKey?: string | null;
      stage?: string | null;
      nextActionAt?: Date | null;
      attempts?: number;
      lostReason?: string | null;
      doNotCall?: boolean;
      clientExternalId?: string | null;
      meta?: unknown;
      groupId?: string | null;
      completionMode?: string | null;
      reworkCount?: number;
      suppressAutoClose?: boolean;
      assignee: { id: string; firstName: string; lastName: string } | null;
      createdBy?: { id: string; firstName: string; lastName: string } | null;
    },
    clientName?: string | null,
  ) {
    const meta = (task.meta ?? {}) as Record<string, unknown>;
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status as AdminTaskStatus,
      dueAt: task.dueAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
      source: task.source ?? 'MANUAL',
      topic: adminTaskTopic({
        source: task.source,
        title: task.title,
        clientName,
      }),
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            firstName: task.assignee.firstName,
            lastName: task.assignee.lastName,
          }
        : undefined,
      createdBy: task.createdBy
        ? {
            id: task.createdBy.id,
            firstName: task.createdBy.firstName,
            lastName: task.createdBy.lastName,
          }
        : undefined,
      createdAt: task.createdAt.toISOString(),
      groupId: task.groupId ?? undefined,
      completionMode:
        (task.completionMode as 'SHARED' | 'INDIVIDUAL') || undefined,
      groupProgress: undefined as
        | { done: number; total: number; assignees: string[] }
        | undefined,
      stage: task.stage ?? undefined,
      nextActionAt: task.nextActionAt?.toISOString(),
      attempts: task.attempts ?? 0,
      lostReason: task.lostReason ?? undefined,
      doNotCall: task.doNotCall ?? false,
      clientExternalId: task.clientExternalId ?? undefined,
      phone: typeof meta.phone === 'string' ? meta.phone : undefined,
      membershipName:
        typeof meta.membershipName === 'string'
          ? meta.membershipName
          : undefined,
      validUntil:
        typeof meta.validUntil === 'string' ? meta.validUntil : undefined,
      docId: typeof meta.docId === 'string' ? meta.docId : undefined,
      sessionKey:
        typeof meta.sessionKey === 'string' ? meta.sessionKey : undefined,
      reworkCount: task.reworkCount ?? 0,
      priority: String(
        (task as { priority?: string }).priority ?? 'NORMAL',
      ),
      outcome:
        typeof (task as { outcome?: string | null }).outcome === 'string'
          ? (task as { outcome: string }).outcome
          : undefined,
      checklist: Array.isArray((task as { checklist?: unknown }).checklist)
        ? ((task as { checklist: unknown[] }).checklist.filter(
            (x) => typeof x === 'string',
          ) as string[])
        : undefined,
      blockedReason:
        typeof (task as { blockedReason?: string | null }).blockedReason ===
        'string'
          ? (task as { blockedReason: string }).blockedReason
          : undefined,
      suppressAutoClose: task.suppressAutoClose ?? false,
      reworkComment: undefined as string | undefined,
      reworkAt: undefined as string | undefined,
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
