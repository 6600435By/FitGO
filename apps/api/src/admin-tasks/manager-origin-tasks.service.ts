import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import {
  AdminTaskEventKind,
  AdminTaskStatus as PrismaAdminTaskStatus,
  Prisma,
  Role,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';

const STAFF_ASSIGN_ROLES: Role[] = [
  Role.ADMIN,
  Role.MANAGER,
  Role.TRAINER,
  Role.SPECIALIST,
];

export type ManagerOriginTaskMeta = {
  origin: 'booking_control' | 'sale';
  sessionKey?: string;
  clubRevenueEntryId?: string;
  externalId?: string;
  clientName?: string | null;
  title?: string | null;
  productName?: string | null;
  amountMinor?: number | null;
  occurredAt?: string | null;
};

@Injectable()
export class ManagerOriginTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listStaffAssignees(
    clubId: string,
    filter?: { roles?: Role[] },
  ): Promise<Array<{ id: string; name: string; roles: string[]; externalId: string | null }>> {
    const roles = filter?.roles?.length ? filter.roles : STAFF_ASSIGN_ROLES;
    const rows = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: { some: { role: { in: roles } } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        externalId: true,
        roles: { select: { role: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map((u) => ({
      id: u.id,
      name: `${u.lastName} ${u.firstName}`.trim(),
      roles: u.roles.map((r) => r.role),
      externalId: u.externalId,
    }));
  }

  async findUserByExternalId(
    clubId: string,
    externalId: string | null | undefined,
    roles?: Role[],
  ): Promise<{ id: string; name: string } | null> {
    const code = externalId?.trim();
    if (!code) return null;
    const user = await this.prisma.user.findFirst({
      where: {
        clubId,
        isActive: true,
        OR: [{ externalId: code }, { employeeCode: code }],
        ...(roles?.length
          ? { roles: { some: { role: { in: roles } } } }
          : { roles: { some: { role: { in: STAFF_ASSIGN_ROLES } } } }),
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      name: `${user.lastName} ${user.firstName}`.trim(),
    };
  }

  async ensureClubStaff(clubId: string, userId: string) {
    const member = await this.prisma.user.findFirst({
      where: {
        id: userId,
        clubId,
        isActive: true,
        roles: { some: { role: { in: STAFF_ASSIGN_ROLES } } },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!member) {
      throw new BadRequestException('Выберите сотрудника клуба');
    }
    return member;
  }

  defaultDueAt(dueAt?: string | null): Date {
    if (dueAt) return new Date(dueAt);
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return d;
  }

  async findOpenBySessionKey(
    clubId: string,
    sessionKey: string,
    assigneeId?: string,
  ) {
    const open = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'MANAGER',
        status: {
          in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS],
        },
        ...(assigneeId ? { assigneeId } : {}),
      },
      select: {
        id: true,
        title: true,
        assigneeId: true,
        meta: true,
        status: true,
        dueAt: true,
      },
      take: 50,
    });
    return open.filter((t) => {
      const meta = (t.meta ?? {}) as Record<string, unknown>;
      return meta.sessionKey === sessionKey;
    });
  }

  async findOpenBySaleEntry(clubId: string, entryId: string) {
    const open = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'MANAGER',
        status: {
          in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS],
        },
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
      take: 100,
    });
    return open
      .filter((t) => {
        const meta = (t.meta ?? {}) as Record<string, unknown>;
        return (
          meta.clubRevenueEntryId === entryId || meta.externalId === entryId
        );
      })
      .map((t) => this.mapAssigneeTask(t));
  }

  async createAssignedTask(input: {
    clubId: string;
    createdById: string;
    assigneeId: string;
    title: string;
    description: string;
    comment: string;
    dueAt?: string | null;
    meta: ManagerOriginTaskMeta;
  }) {
    const assignee = await this.ensureClubStaff(input.clubId, input.assigneeId);
    const dueAt = this.defaultDueAt(input.dueAt);
    const description = [
      input.description,
      `Комментарий руководителя: ${input.comment.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const task = await this.prisma.adminTask.create({
      data: {
        clubId: input.clubId,
        assigneeId: assignee.id,
        createdById: input.createdById,
        title: input.title.trim(),
        description,
        dueAt,
        status: PrismaAdminTaskStatus.IN_PROGRESS,
        source: 'MANAGER',
        meta: input.meta as unknown as Prisma.InputJsonValue,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.prisma.adminTaskEvent.create({
      data: {
        taskId: task.id,
        actorId: input.createdById,
        kind: AdminTaskEventKind.ASSIGN,
        comment: input.comment.trim(),
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: assignee.id,
        type: 'GENERAL',
        title: 'Задача от руководителя',
        body: `${task.title}: ${input.comment.trim()}`,
        senderId: input.createdById,
      },
    });

    return this.mapAssigneeTask(task);
  }

  async listForAssignee(user: JwtPayload) {
    const clubId = requireClubId(user);
    const rows = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        assigneeId: user.sub,
        source: 'MANAGER',
        status: {
          in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS],
        },
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((t) => this.mapAssigneeTask(t));
  }

  async completeByAssignee(
    user: JwtPayload,
    taskId: string,
    comment?: string,
  ) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: {
        id: taskId,
        clubId,
        assigneeId: user.sub,
        source: 'MANAGER',
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    if (
      task.status === PrismaAdminTaskStatus.DONE ||
      task.status === PrismaAdminTaskStatus.CANCELLED
    ) {
      throw new BadRequestException('Задача уже закрыта');
    }

    const note = comment?.trim() || 'Готово';
    const updated = await this.prisma.adminTask.update({
      where: { id: task.id },
      data: {
        status: PrismaAdminTaskStatus.DONE,
        completedAt: new Date(),
        outcome: 'done',
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.prisma.adminTaskEvent.create({
      data: {
        taskId: task.id,
        actorId: user.sub,
        kind: AdminTaskEventKind.OUTCOME,
        comment: note,
      },
    });

    if (task.createdById && task.createdById !== user.sub) {
      await this.prisma.notification.create({
        data: {
          userId: task.createdById,
          type: 'GENERAL',
          title: 'Задача выполнена',
          body: `${updated.title}: ${note}`,
          senderId: user.sub,
        },
      });
    }

    return this.mapAssigneeTask(updated);
  }

  async notifyUser(
    userId: string | null | undefined,
    senderId: string,
    title: string,
    body: string,
  ) {
    if (!userId || userId === senderId) return;
    await this.prisma.notification.create({
      data: {
        userId,
        type: 'GENERAL',
        title,
        body,
        senderId,
      },
    });
  }

  assertManagerLike(actor: JwtPayload) {
    const roles = actor.roles ?? [];
    const ok =
      roles.includes(UserRole.SUPER_ADMIN) || roles.includes(UserRole.MANAGER);
    if (!ok) {
      throw new ForbiddenException('Только управляющий или супер-админ');
    }
  }

  mapAssigneeTask(task: {
    id: string;
    title: string;
    description: string | null;
    status: PrismaAdminTaskStatus;
    dueAt: Date | null;
    completedAt?: Date | null;
    createdAt?: Date;
    meta?: unknown;
    assignee?: { id: string; firstName: string; lastName: string } | null;
    createdBy?: { id: string; firstName: string; lastName: string } | null;
  }) {
    const meta = (task.meta ?? {}) as Record<string, unknown>;
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status,
      dueAt: task.dueAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
      createdAt: task.createdAt?.toISOString(),
      source: 'MANAGER' as const,
      sessionKey:
        typeof meta.sessionKey === 'string' ? meta.sessionKey : undefined,
      clubRevenueEntryId:
        typeof meta.clubRevenueEntryId === 'string'
          ? meta.clubRevenueEntryId
          : undefined,
      externalId:
        typeof meta.externalId === 'string' ? meta.externalId : undefined,
      origin:
        meta.origin === 'sale' || meta.origin === 'booking_control'
          ? meta.origin
          : undefined,
      clientName:
        typeof meta.clientName === 'string' ? meta.clientName : undefined,
      productName:
        typeof meta.productName === 'string' ? meta.productName : undefined,
      amountMinor:
        typeof meta.amountMinor === 'number' ? meta.amountMinor : undefined,
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
    };
  }
}
