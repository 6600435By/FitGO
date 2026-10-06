import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminTaskStatus,
  MembershipStatus,
  type AdminRenewalActionBody,
  type AdminDashboard,
  type RenewalStage,
} from '@fitgo/shared-types';
import { AdminTaskStatus as PrismaAdminTaskStatus } from '@prisma/client';
import { adminTaskTopic } from './task-topic';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { BookingControlService } from '../booking-control/booking-control.service';
import { ClubScheduleService } from '../club-schedule/club-schedule.service';
import { ClubRevenueService } from '../admin-sales/club-revenue.service';
import { ClubRevenueSyncService } from '../admin-sales/club-revenue-sync.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTasksSchedulerService, MAX_NO_ANSWER, NO_ANSWER_RETRY_DAYS } from '../super-admin/admin-tasks-scheduler.service';
import { localDayKey } from '../club-schedule/trainer-schedule.helpers';
import { CreateDailyReportDto } from './dto/create-daily-report.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly notifications: NotificationsService,
    private readonly bookingControl: BookingControlService,
    private readonly clubSchedule: ClubScheduleService,
    private readonly clubRevenue: ClubRevenueService,
    private readonly clubRevenueSync: ClubRevenueSyncService,
    private readonly tasksScheduler: AdminTasksSchedulerService,
  ) {}

  async getDashboard(user: JwtPayload): Promise<AdminDashboard> {
    const clubId = requireClubId(user);
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
    });

    const today = localDayKey();
    const from30 = new Date();
    from30.setDate(from30.getDate() - 30);
    const from30Str = localDayKey(from30);
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const in7Str = localDayKey(in7);

    const [
      reviewItems,
      scheduleEvents,
      revenueBlock,
      pendingCrmCount,
      expiringSoon,
      callTodayTasks,
    ] = await Promise.all([
      this.bookingControl
        .list(clubId, {
          from: from30Str,
          to: today,
          needsReview: true,
        })
        .catch(() => []),
      this.clubSchedule
        .list(clubId, { from: today, to: today, types: ['GROUP', 'PT', 'SPA'] })
        .catch(() => []),
      this.loadRevenueToday(clubId, today),
      this.prisma.userClubMembership.count({
        where: { clubId, leftAt: null, crmStatus: 'PENDING_CRM' },
      }),
      this.prisma.adminTask
        .findMany({
          where: {
            clubId,
            source: 'MEMBERSHIP_EXPIRING',
            status: {
              in: [
                PrismaAdminTaskStatus.OPEN,
                PrismaAdminTaskStatus.IN_PROGRESS,
              ],
            },
          },
          select: { dueAt: true, meta: true },
        })
        .then((open) =>
          open.filter((t) => {
            const meta = (t.meta ?? {}) as Record<string, unknown>;
            const vu =
              typeof meta.validUntil === 'string'
                ? meta.validUntil.slice(0, 10)
                : t.dueAt
                  ? localDayKey(t.dueAt)
                  : null;
            return vu != null && vu <= in7Str;
          }).length,
        ),
      this.prisma.adminTask.findMany({
        where: {
          clubId,
          source: 'MEMBERSHIP_EXPIRING',
          status: {
            in: [
              PrismaAdminTaskStatus.OPEN,
              PrismaAdminTaskStatus.IN_PROGRESS,
            ],
          },
          nextActionAt: { lte: new Date() },
          AND: [
            {
              OR: [
                { stage: null },
                { stage: { notIn: ['RENEWED', 'LOST', 'WILL_RENEW'] } },
              ],
            },
          ],
        },
        orderBy: { nextActionAt: 'asc' },
        take: 5,
      }),
    ]);

    let group = 0;
    let spa = 0;
    let pt = 0;
    for (const ev of scheduleEvents) {
      if (ev.status === 'cancelled') continue;
      if (ev.type === 'GROUP') group += ev.booked ?? 0;
      else if (ev.type === 'SPA') spa += 1;
      else if (ev.type === 'PT') pt += 1;
    }

    const callToday = callTodayTasks.map((task) => {
      const meta = (task.meta ?? {}) as Record<string, unknown>;
      const validUntil =
        typeof meta.validUntil === 'string'
          ? meta.validUntil
          : task.dueAt?.toISOString().slice(0, 10) ?? today;
      const daysLeft = Math.floor(
        (new Date(validUntil).getTime() - Date.now()) / 86400000,
      );
      const firstName = typeof meta.firstName === 'string' ? meta.firstName : '';
      const lastName = typeof meta.lastName === 'string' ? meta.lastName : '';
      const clientName =
        `${lastName} ${firstName}`.trim() ||
        task.title.replace(/^Абонемент истекает:\s*/i, '');
      return {
        taskId: task.id,
        clientName,
        phone: typeof meta.phone === 'string' ? meta.phone : undefined,
        membership:
          typeof meta.membershipName === 'string'
            ? meta.membershipName
            : 'Абонемент',
        validUntil,
        daysLeft,
        stage: (task.stage as RenewalStage) || 'NEW',
      };
    });

    return {
      club: club
        ? {
            id: club.id,
            name: club.name,
            slug: club.slug,
            address: club.address ?? undefined,
            currency: club.currency,
          }
        : null,
      stats: {
        needsReviewCount: reviewItems.length,
        sessionsToday: {
          total: group + spa + pt,
          group,
          spa,
          pt,
        },
        revenueToday: revenueBlock,
        expiringSoon,
        pendingCrmCount,
      },
      callToday,
    };
  }

  private async loadRevenueToday(clubId: string, today: string) {
    const currency =
      (
        await this.prisma.club.findUnique({
          where: { id: clubId },
          select: { currency: true },
        })
      )?.currency ?? 'BYN';

    try {
      let report = await this.clubRevenue.report(clubId, {
        from: today,
        to: today,
      });
      const syncedAt = report.lastSyncedAt
        ? new Date(report.lastSyncedAt).getTime()
        : 0;
      const stale = !syncedAt || Date.now() - syncedAt > 15 * 60 * 1000;
      if (stale) {
        await Promise.race([
          this.clubRevenueSync.syncClub(clubId, 'incremental').catch(() => null),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
        report = await this.clubRevenue.report(clubId, {
          from: today,
          to: today,
        });
      }
      const cash = (report.summary.revenue.cashMinor ?? 0) / 100;
      const card = (report.summary.revenue.cardMinor ?? 0) / 100;
      const total = (report.summary.revenue.totalMinor ?? 0) / 100;
      const other = Math.max(0, Math.round((total - cash - card) * 100) / 100);
      return {
        total,
        cash,
        card,
        other,
        currency,
        syncedAt: report.lastSyncedAt ?? undefined,
      };
    } catch {
      return { total: 0, cash: 0, card: 0, other: 0, currency };
    }
  }

  async getFunnel(user: JwtPayload) {
    return { funnel: await this.buildFunnel(requireClubId(user)) };
  }

  async getReports(user: JwtPayload) {
    const recentReports = await this.prisma.dailyReport.findMany({
      where: { clubId: requireClubId(user) },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return { recentReports };
  }

  private async buildFunnel(clubId: string) {
    const totalClients = await this.prisma.user.count({
      where: { clubId, roles: { some: { role: 'CLIENT' } } },
    });

    const provider = this.fitness.getProvider();
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    let withMembership = 0;
    let active = 0;

    if (club?.externalId && provider.getAllClientsMemberships) {
      const data = await provider.getAllClientsMemberships(club.externalId);
      withMembership = data.filter((c: { membershipName?: string }) => c.membershipName).length;
      active = data.filter(
        (c: { membershipStatus?: string }) =>
          c.membershipStatus === MembershipStatus.ACTIVE,
      ).length;
    }

    const trials = Math.max(1, Math.floor(totalClients * 0.6));
    const offers = Math.max(1, Math.floor(withMembership * 0.5));

    return [
      { stage: 'Новый лид', count: totalClients },
      { stage: 'Пробное занятие', count: trials },
      { stage: 'Предложение', count: offers },
      { stage: 'Оплата', count: active || withMembership },
    ];
  }

  async getAtRiskClients(user: JwtPayload) {
    const clients = await this.prisma.user.findMany({
      where: {
        clubId: requireClubId(user),
        roles: { some: { role: 'CLIENT' } },
      },
    });

    const provider = this.fitness.getProvider();
    const atRisk: Array<{
      id: string;
      userId: string;
      name: string;
      email: string;
      reason: string;
      daysInactive?: number;
      daysUntilExpiry?: number;
      membership?: string;
    }> = [];

    const today = new Date();

    for (const client of clients) {
      if (!client.externalId) continue;

      const [membership, visits] = await Promise.all([
        provider.getMembership(client.externalId),
        provider.getVisits(client.externalId),
      ]);

      const lastVisit = visits[0]?.date ? new Date(visits[0].date) : null;
      if (lastVisit) {
        const daysInactive = Math.floor(
          (today.getTime() - lastVisit.getTime()) / 86400000,
        );
        if (daysInactive >= 3) {
          atRisk.push({
            id: client.externalId,
            userId: client.id,
            name: `${client.firstName} ${client.lastName}`,
            email: client.email,
            reason: 'Давно не был',
            daysInactive,
            membership: membership?.name,
          });
          continue;
        }
      }

      if (membership?.status === MembershipStatus.ACTIVE) {
        const daysUntilExpiry = Math.floor(
          (new Date(membership.validUntil).getTime() - today.getTime()) /
            86400000,
        );
        if (daysUntilExpiry <= 14 && daysUntilExpiry >= 0) {
          atRisk.push({
            id: client.externalId,
            userId: client.id,
            name: `${client.firstName} ${client.lastName}`,
            email: client.email,
            reason: 'Абонемент истекает',
            daysUntilExpiry,
            membership: membership.name,
          });
        }
      }
    }

    return atRisk;
  }

  async getAllClubs() {
    return this.prisma.club.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        address: true,
        currency: true,
        theme: { select: { primaryColor: true } },
      },
      orderBy: { name: 'asc' },
    }).then((clubs) =>
      clubs.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        address: c.address ?? undefined,
        currency: c.currency,
        primaryColor: c.theme?.primaryColor ?? '#14b88a',
      })),
    );
  }

  async sendReminder(user: JwtPayload, clientUserId: string, message?: string) {
    const clubId = requireClubId(user);
    const client = await this.prisma.user.findFirst({
      where: { id: clientUserId, clubId },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    const text =
      message?.trim() ||
      'Мы заметили, что вы давно не были в клубе. Запишитесь на тренировку!';
    return this.notifications.sendReminderToClient(clientUserId, text);
  }

  async createDailyReport(user: JwtPayload, dto: CreateDailyReportDto) {
    const clubId = requireClubId(user);
    const date = new Date(dto.date);

    return this.prisma.dailyReport.upsert({
      where: {
        clubId_date: {
          clubId,
          date,
        },
      },
      update: {
        revenue: dto.revenue,
        problems: dto.problems,
        ideas: dto.ideas,
        createdBy: user.sub,
      },
      create: {
        clubId,
        date,
        revenue: dto.revenue,
        problems: dto.problems,
        ideas: dto.ideas,
        createdBy: user.sub,
      },
    });
  }

  async getMyTasks(user: JwtPayload) {
    const clubId = requireClubId(user);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const tasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        OR: [
          { assigneeId: user.sub },
          {
            source: 'MEMBERSHIP_EXPIRING',
            status: {
              in: [
                PrismaAdminTaskStatus.OPEN,
                PrismaAdminTaskStatus.IN_PROGRESS,
              ],
            },
          },
          {
            source: 'MEMBERSHIP_EXPIRING',
            status: PrismaAdminTaskStatus.DONE,
            completedAt: { gte: weekAgo },
          },
        ],
      },
      include: { assignee: true },
      orderBy: [{ status: 'asc' }, { nextActionAt: 'asc' }, { dueAt: 'asc' }],
      take: 200,
    });

    const saleIds = tasks
      .map((task) => task.relatedSaleId)
      .filter((id): id is string => !!id);
    const sales = saleIds.length
      ? await this.prisma.saleTransaction.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, clientName: true },
        })
      : [];
    const clientBySale = new Map(sales.map((sale) => [sale.id, sale.clientName]));

    return tasks.map((task) =>
      this.mapTaskItem(task, clientBySale.get(task.relatedSaleId ?? '') ?? null),
    );
  }

  async getRenewalCounters(user: JwtPayload) {
    const clubId = requireClubId(user);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [callToday, inProgress, renewed, lost] = await Promise.all([
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'MEMBERSHIP_EXPIRING',
          status: { in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS] },
          nextActionAt: { lte: now },
          AND: [
            {
              OR: [
                { stage: null },
                { stage: { notIn: ['RENEWED', 'LOST', 'WILL_RENEW'] } },
              ],
            },
          ],
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'MEMBERSHIP_EXPIRING',
          status: { in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS] },
          stage: { in: ['THINKING', 'WILL_RENEW', 'NO_ANSWER'] },
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'MEMBERSHIP_EXPIRING',
          stage: 'RENEWED',
          completedAt: { gte: monthStart },
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'MEMBERSHIP_EXPIRING',
          stage: 'LOST',
          completedAt: { gte: monthStart },
        },
      }),
    ]);

    return { callToday, inProgress, renewed, lost };
  }

  async getTaskDetail(user: JwtPayload, taskId: string) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId },
      include: {
        assignee: true,
        events: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            actor: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    if (
      task.source === 'MEMBERSHIP_EXPIRING' &&
      task.status !== PrismaAdminTaskStatus.DONE &&
      task.status !== PrismaAdminTaskStatus.CANCELLED &&
      task.clientExternalId
    ) {
      // Point check only — no full club refresh
      try {
        const live = await this.fitness
          .getProvider()
          .getMembership(task.clientExternalId);
        const meta = (task.meta ?? {}) as Record<string, unknown>;
        const docId = typeof meta.docId === 'string' ? meta.docId : null;
        const oldUntil =
          typeof meta.validUntil === 'string'
            ? meta.validUntil.slice(0, 10)
            : null;
        const newUntil = live?.validUntil?.slice(0, 10);
        if (
          live &&
          live.id &&
          docId &&
          live.id !== docId &&
          newUntil &&
          oldUntil &&
          newUntil > oldUntil
        ) {
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: {
              stage: 'RENEWED',
              status: PrismaAdminTaskStatus.DONE,
              completedAt: new Date(),
              nextActionAt: null,
            },
          });
          await this.prisma.adminTaskEvent.create({
            data: {
              taskId: task.id,
              actorId: user.sub,
              stage: 'RENEWED',
              comment: 'Авто при открытии: новый абонемент в 1С',
            },
          });
        }
      } catch {
        // ignore 1C probe errors
      }
      const refreshed = await this.prisma.adminTask.findFirst({
        where: { id: taskId, clubId },
        include: {
          assignee: true,
          events: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
              actor: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });
      if (refreshed) {
        return {
          ...this.mapTaskItem(refreshed),
          events: refreshed.events.map((e) => ({
            id: e.id,
            stage: e.stage ?? undefined,
            comment: e.comment ?? undefined,
            actorName: e.actor
              ? `${e.actor.firstName} ${e.actor.lastName}`.trim()
              : undefined,
            createdAt: e.createdAt.toISOString(),
          })),
        };
      }
    }

    return {
      ...this.mapTaskItem(task),
      events: task.events.map((e) => ({
        id: e.id,
        stage: e.stage ?? undefined,
        comment: e.comment ?? undefined,
        actorName: e.actor
          ? `${e.actor.firstName} ${e.actor.lastName}`.trim()
          : undefined,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async claimTask(user: JwtPayload, taskId: string) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId, source: 'MEMBERSHIP_EXPIRING' },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        assigneeId: user.sub,
        status:
          task.status === PrismaAdminTaskStatus.OPEN
            ? PrismaAdminTaskStatus.IN_PROGRESS
            : task.status,
      },
      include: { assignee: true },
    });
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        stage: updated.stage,
        comment: 'Взял в работу',
      },
    });
    return this.mapTaskItem(updated);
  }

  async applyRenewalAction(
    user: JwtPayload,
    taskId: string,
    body: AdminRenewalActionBody,
  ) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId, source: 'MEMBERSHIP_EXPIRING' },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    if (task.stage === 'RENEWED') {
      throw new BadRequestException('Кейс уже закрыт как продлённый');
    }

    const stage = body.stage;
    const allowed: RenewalStage[] = [
      'NEW',
      'NO_ANSWER',
      'THINKING',
      'WILL_RENEW',
      'LOST',
    ];
    if (!allowed.includes(stage)) {
      throw new BadRequestException('Недопустимый статус');
    }
    if (stage === 'LOST' && !body.lostReason && !body.doNotCall) {
      throw new BadRequestException('Укажите причину отказа');
    }

    let attempts = task.attempts;
    let nextActionAt: Date | null = task.nextActionAt;
    let status: PrismaAdminTaskStatus = task.status;
    let completedAt: Date | null = task.completedAt;
    let lostReason = task.lostReason;
    let doNotCall = task.doNotCall;
    let finalStage: RenewalStage = stage;

    if (body.doNotCall) {
      doNotCall = true;
      lostReason = 'do_not_call';
      status = PrismaAdminTaskStatus.DONE;
      completedAt = new Date();
      nextActionAt = null;
      finalStage = 'LOST';
    } else if (stage === 'NO_ANSWER') {
      attempts += 1;
      if (attempts >= MAX_NO_ANSWER) {
        finalStage = 'LOST';
        status = PrismaAdminTaskStatus.DONE;
        completedAt = new Date();
        lostReason = 'no_answer';
        nextActionAt = null;
      } else {
        const retry = new Date();
        retry.setDate(retry.getDate() + NO_ANSWER_RETRY_DAYS);
        retry.setHours(10, 0, 0, 0);
        nextActionAt = retry;
        status = PrismaAdminTaskStatus.IN_PROGRESS;
        void this.tasksScheduler.sendNoAnswerMessage(
          clubId,
          task.clientExternalId,
        );
      }
    } else if (stage === 'THINKING') {
      if (body.nextActionAt) {
        nextActionAt = new Date(body.nextActionAt);
      } else {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        d.setHours(10, 0, 0, 0);
        nextActionAt = d;
      }
      status = PrismaAdminTaskStatus.IN_PROGRESS;
    } else if (stage === 'WILL_RENEW') {
      // No call queue — wait for 1C purchase
      nextActionAt = null;
      status = PrismaAdminTaskStatus.IN_PROGRESS;
    } else if (stage === 'LOST') {
      lostReason = body.lostReason ?? null;
      status = PrismaAdminTaskStatus.DONE;
      completedAt = new Date();
      nextActionAt = null;
    }

    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        stage: finalStage,
        attempts,
        nextActionAt,
        status,
        completedAt,
        lostReason,
        doNotCall,
        assigneeId: task.assigneeId ?? user.sub,
      },
      include: { assignee: true },
    });
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        stage: finalStage,
        comment:
          body.comment?.trim() ||
          (finalStage === 'LOST' && attempts >= MAX_NO_ANSWER
            ? `Не дозвонились (${MAX_NO_ANSWER} попытки)`
            : null),
      },
    });
    return this.mapTaskItem(updated);
  }

  async refreshRenewals(user: JwtPayload) {
    const clubId = requireClubId(user);
    return this.tasksScheduler.refreshMembershipRenewals(clubId);
  }

  async updateMyTask(user: JwtPayload, taskId: string, status: AdminTaskStatus) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: {
        id: taskId,
        clubId,
        OR: [
          { assigneeId: user.sub },
          { source: 'MEMBERSHIP_EXPIRING' },
        ],
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    return this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        status: status as PrismaAdminTaskStatus,
        completedAt: status === AdminTaskStatus.DONE ? new Date() : null,
      },
    });
  }

  private mapTaskItem(
    task: {
      id: string;
      title: string;
      description: string | null;
      status: PrismaAdminTaskStatus;
      dueAt: Date | null;
      completedAt: Date | null;
      createdAt: Date;
      source?: string | null;
      stage?: string | null;
      nextActionAt?: Date | null;
      attempts?: number;
      lostReason?: string | null;
      doNotCall?: boolean;
      clientExternalId?: string | null;
      meta?: unknown;
      relatedSaleId?: string | null;
      assignee?: { id: string; firstName: string; lastName: string } | null;
    },
    clientName?: string | null,
  ) {
    const meta = (task.meta ?? {}) as Record<string, unknown>;
    const validUntil =
      typeof meta.validUntil === 'string' ? meta.validUntil : undefined;
    const daysLeft = validUntil
      ? Math.floor(
          (new Date(validUntil).getTime() - Date.now()) / 86400000,
        )
      : undefined;

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
        clientName: clientName ?? null,
      }),
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            firstName: task.assignee.firstName,
            lastName: task.assignee.lastName,
          }
        : undefined,
      createdAt: task.createdAt.toISOString(),
      stage: (task.stage as RenewalStage) || undefined,
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
      validUntil,
      daysLeft,
      docId: typeof meta.docId === 'string' ? meta.docId : undefined,
      kind: typeof meta.kind === 'string' ? meta.kind : undefined,
      termDays:
        typeof meta.termDays === 'number' ? meta.termDays : undefined,
    };
  }

  async getPendingCrmClients(user: JwtPayload) {
    const clubId = requireClubId(user);
    const rows = await this.prisma.userClubMembership.findMany({
      where: {
        clubId,
        leftAt: null,
        crmStatus: 'PENDING_CRM',
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            createdAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      phone: row.user.phone ?? undefined,
      email: row.user.email,
      joinedAt: row.joinedAt.toISOString(),
      lastCrmSyncAt: row.lastCrmSyncAt?.toISOString(),
      crmStatus: row.crmStatus,
    }));
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

    return this.getClubProfile(user);
  }
}
