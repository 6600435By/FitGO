import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminTaskStatus,
  MembershipStatus,
  filterAdminHomePins,
  filterAdminHomeWidgets,
  isAdminHomePinId,
  isAdminHomeWidgetId,
  type AdminHomeLayoutValue,
  type AdminHomePinId,
  type AdminHomeWidgetId,
  type AdminRenewalActionBody,
  type AdminDashboard,
  type RenewalStage,
} from '@fitgo/shared-types';
import { AdminPermissionsService } from '../auth/admin-permissions.service';
import { FeaturesService } from '../features/features.service';
import {
  AdminTaskStatus as PrismaAdminTaskStatus,
  OnexClassStatus,
  PersonalBookingStatus,
  Prisma,
  SpaBookingStatus,
} from '@prisma/client';
import { adminTaskTopic } from './task-topic';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { BookingControlService } from '../booking-control/booking-control.service';
import {
  isCollectibleClientDebt,
  isStaffDebtorName,
} from '../admin-sales/club-revenue-debt';
import { ClubRevenueService } from '../admin-sales/club-revenue.service';
import { ClubRevenueSyncService } from '../admin-sales/club-revenue-sync.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTasksSchedulerService, MAX_NO_ANSWER, NO_ANSWER_RETRY_DAYS } from '../super-admin/admin-tasks-scheduler.service';
import { ackDiscrepancyFromTask } from '../discrepancies/discrepancy-task-ack';
import { localDayKey } from '../club-schedule/trainer-schedule.helpers';
import { CreateDailyReportDto } from './dto/create-daily-report.dto';
import {
  findSpaClientNotesByIdentities,
  resolveNoteFromMap,
  type SpaNoteIdentity,
} from '../spa-booking/spa-client-note.util';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly notifications: NotificationsService,
    private readonly bookingControl: BookingControlService,
    private readonly clubRevenue: ClubRevenueService,
    private readonly clubRevenueSync: ClubRevenueSyncService,
    private readonly tasksScheduler: AdminTasksSchedulerService,
    private readonly adminPermissions: AdminPermissionsService,
    private readonly features: FeaturesService,
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
    const dayStart = new Date(`${today}T00:00:00`);
    const dayEnd = new Date(`${today}T23:59:59.999`);

    // DB-only path: never await Forma/Analytics on dashboard GET (was stacking
    // WordpressUserAPI / Analytics sessions on every tab revisit).
    const now = new Date();
    const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const openTaskStatus = {
      in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS],
    };

    const [
      reviewItems,
      groupCount,
      spaCount,
      ptCount,
      revenueBlock,
      pendingCrmCount,
      expiringSoon,
      callTodayTasks,
      membershipDueCount,
      managerDueCount,
      groupApprovalCount,
      spaApprovalCount,
      ptApprovalCount,
      birthdayCount,
      clientDebtCount,
      staffDebtCount,
      installmentDueCount,
      confirmationCount,
    ] = await Promise.all([
      this.bookingControl
        .list(clubId, {
          from: from30Str,
          to: today,
          needsReview: true,
          skipExternal: true,
        })
        .catch(() => []),
      this.prisma.onexClassSession
        .count({
          where: {
            clubId,
            kind: 'GROUP',
            isActive: true,
            status: { not: OnexClassStatus.CANCELLED },
            startAt: { gte: dayStart, lte: dayEnd },
          },
        })
        .catch(() => 0),
      this.prisma.spaBooking
        .count({
          where: {
            clubId,
            status: { not: SpaBookingStatus.CANCELLED },
            startAt: { gte: dayStart, lte: dayEnd },
          },
        })
        .catch(() => 0),
      this.prisma.personalTrainingBooking
        .count({
          where: {
            trainer: { clubId },
            status: { not: PersonalBookingStatus.CANCELLED },
            startAt: { gte: dayStart, lte: dayEnd },
          },
        })
        .catch(() => 0),
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
        orderBy: { nextActionAt: 'asc' },
        take: 5,
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'MEMBERSHIP_EXPIRING',
          status: {
            in: [
              PrismaAdminTaskStatus.OPEN,
              PrismaAdminTaskStatus.IN_PROGRESS,
            ],
          },
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
          assigneeId: user.sub,
          source: { in: ['MANAGER', 'DISCREPANCY'] },
          status: {
            in: [
              PrismaAdminTaskStatus.OPEN,
              PrismaAdminTaskStatus.IN_PROGRESS,
            ],
          },
          OR: [
            { nextActionAt: null, dueAt: null },
            { nextActionAt: { lte: dueSoon } },
            { nextActionAt: null, dueAt: { lte: dueSoon } },
          ],
        },
      }),
      this.bookingControl
        .listPendingAdminApprovals(clubId, from30Str, today, 'GROUP')
        .then((rows) => rows.length)
        .catch(() => 0),
      this.bookingControl
        .listPendingAdminApprovals(clubId, from30Str, today, 'SPA')
        .then((rows) => rows.length)
        .catch(() => 0),
      this.bookingControl
        .listPendingAdminApprovals(clubId, from30Str, today, 'PT')
        .then((rows) => rows.length)
        .catch(() => 0),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'BIRTHDAY',
          status: openTaskStatus,
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'CLIENT_DEBT',
          status: openTaskStatus,
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'STAFF_DEBT',
          status: openTaskStatus,
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'INSTALLMENT_PAYMENT',
          status: openTaskStatus,
          OR: [
            { nextActionAt: null, dueAt: null },
            { nextActionAt: { lte: dueSoon } },
            { nextActionAt: null, dueAt: { lte: dueSoon } },
          ],
        },
      }),
      this.prisma.adminTask.count({
        where: {
          clubId,
          source: 'BOOKING_CONFIRM',
          status: openTaskStatus,
        },
      }),
    ]);

    const group = groupCount;
    const spa = spaCount;
    const pt = ptCount;
    const bookingControlTasks =
      groupApprovalCount + spaApprovalCount + ptApprovalCount;
    const clientsTotal =
      membershipDueCount +
      birthdayCount +
      clientDebtCount +
      installmentDueCount;
    const controlTotal = bookingControlTasks + confirmationCount;
    const tasksStats = {
      bookingControl: bookingControlTasks,
      membership: membershipDueCount,
      group: groupApprovalCount,
      spa: spaApprovalCount,
      pt: ptApprovalCount,
      manager: managerDueCount,
      birthday: birthdayCount,
      clientDebt: clientDebtCount,
      staffDebt: staffDebtCount,
      installment: installmentDueCount,
      confirmation: confirmationCount,
      clients: clientsTotal,
      control: controlTotal,
      total:
        bookingControlTasks +
        membershipDueCount +
        managerDueCount +
        birthdayCount +
        clientDebtCount +
        staffDebtCount +
        installmentDueCount +
        confirmationCount,
    };

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
        tasks: tasksStats,
        expiringSoon,
        pendingCrmCount,
      },
      callToday,
    };
  }

  async getHomeLayout(user: JwtPayload): Promise<AdminHomeLayoutValue> {
    requireClubId(user);
    const [row, permissions, modules] = await Promise.all([
      this.prisma.adminHomeLayout.findUnique({ where: { userId: user.sub } }),
      this.adminPermissions.getPermissions(user),
      this.features.getModules(),
    ]);
    const isEnabled = (m: string) =>
      modules[m as keyof typeof modules] !== false;
    const permStrs = permissions as string[];

    const widgetsRaw = this.parseWidgetIds(row?.widgets);
    const pinsRaw = this.parsePinIds(row?.pins);

    return {
      widgets: filterAdminHomeWidgets(widgetsRaw, permStrs, isEnabled),
      pins: filterAdminHomePins(pinsRaw, permStrs, isEnabled),
    };
  }

  async resetHomeLayout(user: JwtPayload): Promise<void> {
    requireClubId(user);
    await this.prisma.adminHomeLayout.deleteMany({
      where: { userId: user.sub },
    });
  }

  async putHomeLayout(
    user: JwtPayload,
    body: { widgets?: unknown; pins?: unknown },
  ): Promise<AdminHomeLayoutValue> {
    requireClubId(user);
    const [permissions, modules] = await Promise.all([
      this.adminPermissions.getPermissions(user),
      this.features.getModules(),
    ]);
    const isEnabled = (m: string) =>
      modules[m as keyof typeof modules] !== false;
    const permStrs = permissions as string[];

    const widgetsIn = Array.isArray(body.widgets)
      ? body.widgets.filter(
          (id): id is AdminHomeWidgetId =>
            typeof id === 'string' && isAdminHomeWidgetId(id),
        )
      : [];
    const pinsIn = Array.isArray(body.pins)
      ? body.pins.filter(
          (id): id is AdminHomePinId =>
            typeof id === 'string' && isAdminHomePinId(id),
        )
      : [];

    const widgets =
      filterAdminHomeWidgets(widgetsIn, permStrs, isEnabled) ?? [];
    const pins = filterAdminHomePins(pinsIn, permStrs, isEnabled) ?? [];

    await this.prisma.adminHomeLayout.upsert({
      where: { userId: user.sub },
      create: { userId: user.sub, widgets, pins },
      update: { widgets, pins },
    });

    return { widgets, pins };
  }

  private parseWidgetIds(raw: unknown): AdminHomeWidgetId[] | null {
    if (raw == null) return null;
    if (!Array.isArray(raw)) return null;
    return raw.filter(
      (id): id is AdminHomeWidgetId =>
        typeof id === 'string' && isAdminHomeWidgetId(id),
    );
  }

  private parsePinIds(raw: unknown): AdminHomePinId[] | null {
    if (raw == null) return null;
    if (!Array.isArray(raw)) return null;
    return raw.filter(
      (id): id is AdminHomePinId =>
        typeof id === 'string' && isAdminHomePinId(id),
    );
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
      const report = await this.clubRevenue.report(clubId, {
        from: today,
        to: today,
      });
      const syncedAt = report.lastSyncedAt
        ? new Date(report.lastSyncedAt).getTime()
        : 0;
      const stale = !syncedAt || Date.now() - syncedAt > 15 * 60 * 1000;
      // Fire-and-forget only — never await day-by-day Analytics on GET (was
      // stacking parallel syncs via Promise.race timeout without cancel).
      if (stale && !this.clubRevenueSync.isSyncing(clubId)) {
        void this.clubRevenueSync.syncClubQuick(clubId).catch(() => null);
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
    const clubId = requireClubId(user);
    const clients = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: 'CLIENT' } },
      },
      select: {
        id: true,
        externalId: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });

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
    const externalIds = clients
      .map((c) => c.externalId)
      .filter((id): id is string => Boolean(id));
    if (!externalIds.length) return atRisk;

    const [snapshots, hallVisits] = await Promise.all([
      this.prisma.clubMembershipSnapshot.findMany({
        where: { clubId, clientExternalId: { in: externalIds } },
        select: {
          clientExternalId: true,
          packageName: true,
          status: true,
          endDate: true,
        },
      }),
      this.prisma.clubHallVisit.findMany({
        where: {
          clubId,
          isActive: true,
          clientExternalId: { in: externalIds },
        },
        orderBy: { visitDate: 'desc' },
        distinct: ['clientExternalId'],
        select: { clientExternalId: true, visitDate: true },
      }),
    ]);
    const snapByExt = new Map(
      snapshots.map((s) => [s.clientExternalId, s]),
    );
    const visitByExt = new Map(
      hallVisits
        .filter((v) => v.clientExternalId)
        .map((v) => [v.clientExternalId!, v.visitDate]),
    );

    // Fallback last visit from ClubVisit for users without hall rows
    const needVisitUserIds = clients
      .filter((c) => c.externalId && !visitByExt.has(c.externalId))
      .map((c) => c.id);
    const clubVisits = needVisitUserIds.length
      ? await this.prisma.clubVisit.findMany({
          where: { clubId, userId: { in: needVisitUserIds } },
          orderBy: { visitedAt: 'desc' },
          distinct: ['userId'],
          select: { userId: true, visitDate: true },
        })
      : [];
    const visitByUser = new Map(clubVisits.map((v) => [v.userId, v.visitDate]));

    for (const client of clients) {
      if (!client.externalId) continue;
      const snap = snapByExt.get(client.externalId);
      const lastVisitDate =
        visitByExt.get(client.externalId) ?? visitByUser.get(client.id) ?? null;

      if (lastVisitDate) {
        const lastVisit = new Date(`${lastVisitDate}T00:00:00`);
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
            membership: snap?.packageName ?? undefined,
          });
          continue;
        }
      }

      const status = (snap?.status ?? '').toUpperCase();
      const endDate = snap?.endDate;
      if (
        endDate &&
        (status === 'ACTIVE' ||
          status === MembershipStatus.ACTIVE ||
          status === 'АКТИВНЫЙ' ||
          status === 'ДЕЙСТВУЕТ')
      ) {
        const daysUntilExpiry = Math.floor(
          (new Date(`${endDate}T00:00:00`).getTime() - today.getTime()) /
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
            membership: snap?.packageName ?? undefined,
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
    // Rebuild grouped debtor rows ASAP (legacy per-sale tasks still in DB until sync).
    try {
      await this.tasksScheduler.refreshDebtors(clubId);
    } catch {
      // non-fatal — list whatever we have
    }
    // Tomorrow confirmations (reformer hall / SPA) — local schedule, refresh every open.
    try {
      await this.tasksScheduler.refreshBookingConfirmations(clubId);
    } catch {
      // non-fatal
    }
    // Birthdays from 1C (throttled). Do not await: a 60s 1C timeout used to
    // hold the whole inbox, including tasks already in progress.
    this.tasksScheduler.refreshBirthdaysNonBlocking(clubId);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const sharedOpen = {
      in: [
        'MEMBERSHIP_EXPIRING',
        'CLIENT_DEBT',
        'STAFF_DEBT',
        'INSTALLMENT_PAYMENT',
        'BIRTHDAY',
        'BOOKING_CONFIRM',
      ] as string[],
    };

    const tasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        OR: [
          {
            assigneeId: user.sub,
            NOT: {
              OR: [
                { source: 'DEBT_OVERDUE' },
                {
                  source: { in: ['STAFF_DEBT', 'CLIENT_DEBT'] },
                  dedupeKey: { startsWith: 'debt:' },
                },
              ],
            },
          },
          {
            source: sharedOpen,
            status: {
              in: [
                PrismaAdminTaskStatus.OPEN,
                PrismaAdminTaskStatus.IN_PROGRESS,
              ],
            },
            // Debt queue: only aggregated debtor:* rows
            OR: [
              { source: { notIn: ['CLIENT_DEBT', 'STAFF_DEBT'] } },
              { dedupeKey: { startsWith: 'debtor:' } },
            ],
          },
          {
            source: 'MEMBERSHIP_EXPIRING',
            status: PrismaAdminTaskStatus.DONE,
            completedAt: { gte: weekAgo },
          },
        ],
      },
      include: {
        assignee: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ status: 'asc' }, { nextActionAt: 'asc' }, { dueAt: 'asc' }],
      take: 300,
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

    const groupIds = [
      ...new Set(
        tasks
          .map((t) => t.groupId)
          .filter((id): id is string => !!id),
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

    const mapped = tasks.map((task) => {
      const item = this.mapTaskItem(
        task,
        clientBySale.get(task.relatedSaleId ?? '') ?? null,
      ) as ReturnType<AdminService['mapTaskItem']> & {
        groupProgress?: {
          done: number;
          total: number;
          assignees: string[];
        };
      };
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
      return item;
    });

    return this.enrichConfirmTasksWithSpaNotes(clubId, mapped);
  }

  /** Attach live SPA client/visit notes to BOOKING_CONFIRM rows. */
  private async enrichConfirmTasksWithSpaNotes<
    T extends {
      source?: string;
      kind?: string;
      confirmClients?: Array<{
        externalId: string;
        phone?: string;
        clientNote?: string;
        visitNote?: string;
      }>;
      sessionKey?: string;
    },
  >(clubId: string, tasks: T[]): Promise<T[]> {
    const confirmTasks = tasks.filter((t) => t.source === 'BOOKING_CONFIRM');
    if (!confirmTasks.length) return tasks;

    const identities: SpaNoteIdentity[] = [];
    const spaBookingIds: string[] = [];
    for (const task of confirmTasks) {
      for (const c of task.confirmClients ?? []) {
        identities.push({
          clientExternalId: c.externalId.startsWith('guest:')
            ? null
            : c.externalId,
          phone: c.phone,
        });
      }
      if (task.kind === 'SPA' && task.sessionKey) {
        const m = /^fitgo:SPA:(.+)$/.exec(task.sessionKey);
        if (m?.[1]) spaBookingIds.push(m[1]);
      }
    }

    const [noteMap, spaBookings] = await Promise.all([
      findSpaClientNotesByIdentities(this.prisma, clubId, identities),
      spaBookingIds.length
        ? this.prisma.spaBooking.findMany({
            where: { clubId, id: { in: spaBookingIds } },
            select: { id: true, visitNote: true },
          })
        : Promise.resolve([]),
    ]);
    const visitByBooking = new Map(
      spaBookings.map((b) => [b.id, b.visitNote?.trim() || undefined]),
    );

    return tasks.map((task) => {
      if (task.source !== 'BOOKING_CONFIRM' || !task.confirmClients?.length) {
        return task;
      }
      let visitNote: string | undefined;
      if (task.kind === 'SPA' && task.sessionKey) {
        const m = /^fitgo:SPA:(.+)$/.exec(task.sessionKey);
        if (m?.[1]) visitNote = visitByBooking.get(m[1]);
      }
      return {
        ...task,
        confirmClients: task.confirmClients.map((c) => {
          const clientNote = resolveNoteFromMap(noteMap, {
            clientExternalId: c.externalId.startsWith('guest:')
              ? null
              : c.externalId,
            phone: c.phone,
          });
          return {
            ...c,
            ...(clientNote ? { clientNote } : {}),
            ...(visitNote ? { visitNote } : {}),
          };
        }),
      };
    });
  }

  async getDebtLines(user: JwtPayload, taskId: string) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: {
        id: taskId,
        clubId,
        source: { in: ['CLIENT_DEBT', 'STAFF_DEBT', 'DEBT_OVERDUE'] },
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const meta = (task.meta ?? {}) as Record<string, unknown>;
    const rawName =
      typeof meta.clientName === 'string'
        ? meta.clientName
        : task.title
            .replace(/^Долг (клиента|сотрудника):\s*/i, '')
            .replace(/\s*\([\d.,]+\s*BYN\)\s*$/i, '')
            .trim();
    const baseName = rawName
      .replace(/\(\s*сотрудник\s*\)/gi, '')
      .trim()
      .replace(/\s+/g, ' ');

    const clientExternalId = task.clientExternalId?.trim() || null;

    const staffDebt =
      task.source === 'STAFF_DEBT' || isStaffDebtorName(rawName, task.title);

    // Same source as syncDebtors: ClubRevenue unpaid (1C debt register).
    const lines = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        operationType: 'unpaid',
        ...(clientExternalId
          ? { clientExternalId }
          : baseName
            ? { clientName: { contains: baseName, mode: 'insensitive' } }
            : { id: '__none__' }),
      },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });

    const filtered = lines.filter((l) => {
      if (
        !isCollectibleClientDebt({
          externalId: l.externalId,
          productName: l.productName,
        })
      ) {
        return false;
      }
      const isStaff = isStaffDebtorName(l.clientName);
      return staffDebt ? isStaff : !isStaff;
    });

    return filtered.map((l) => ({
      id: l.id,
      soldAt: l.occurredAt.toISOString(),
      productName: l.productName ?? l.saleType,
      amount: Number(l.amount || l.saleAmount || 0),
      employeeName: l.employeeName ?? undefined,
      employeeExternalId: l.employeeExternalId ?? undefined,
      externalSaleId: l.externalId,
    }));
  }

  async snoozeTask(user: JwtPayload, taskId: string, days: number) {
    const clubId = requireClubId(user);
    const n = Math.min(30, Math.max(1, Math.floor(days) || 1));
    const task = await this.prisma.adminTask.findFirst({
      where: {
        id: taskId,
        clubId,
        source: {
          in: ['CLIENT_DEBT', 'STAFF_DEBT', 'INSTALLMENT_PAYMENT', 'MANAGER'],
        },
        OR: [
          { assigneeId: user.sub },
          { assigneeId: null },
          { source: { in: ['CLIENT_DEBT', 'STAFF_DEBT', 'INSTALLMENT_PAYMENT'] } },
        ],
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    const next = new Date();
    next.setDate(next.getDate() + n);
    next.setHours(10, 0, 0, 0);
    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        nextActionAt: next,
        status:
          task.status === PrismaAdminTaskStatus.OPEN
            ? PrismaAdminTaskStatus.IN_PROGRESS
            : task.status,
        assigneeId: task.assigneeId ?? user.sub,
      },
      include: { assignee: true },
    });
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        stage: task.stage,
        comment: `Напомнить через ${n} дн.`,
      },
    });
    return this.mapTaskItem(updated);
  }

  async addTaskComment(user: JwtPayload, taskId: string, comment: string) {
    const clubId = requireClubId(user);
    const text = comment?.trim();
    if (!text) throw new BadRequestException('Укажите комментарий');
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        stage: task.stage,
        comment: text,
      },
    });
    if (!task.assigneeId) {
      await this.prisma.adminTask.update({
        where: { id: taskId },
        data: {
          assigneeId: user.sub,
          status:
            task.status === PrismaAdminTaskStatus.OPEN
              ? PrismaAdminTaskStatus.IN_PROGRESS
              : task.status,
        },
      });
    }
    return this.getTaskDetail(user, taskId);
  }

  async getBirthdaySkipped(user: JwtPayload) {
    const clubId = requireClubId(user);
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    // Ensure a recent scan so scanError is current when the inbox opens.
    try {
      await this.tasksScheduler.refreshBirthdays(clubId);
    } catch {
      // non-fatal
    }
    const skipped = await this.prisma.adminTask.count({
      where: {
        clubId,
        source: 'BIRTHDAY',
        status: PrismaAdminTaskStatus.CANCELLED,
        dedupeKey: { startsWith: `birthday-skip:`, endsWith: `:${dayKey}` },
      },
    });
    const scanError = this.tasksScheduler.getBirthdayScanError(clubId);
    return {
      skipped,
      dayKey,
      scanError: scanError ?? undefined,
    };
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
      where: {
        id: taskId,
        clubId,
        source: {
          in: [
            'MEMBERSHIP_EXPIRING',
            'CLIENT_DEBT',
            'STAFF_DEBT',
            'INSTALLMENT_PAYMENT',
          ],
        },
      },
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

  async updateMyTask(
    user: JwtPayload,
    taskId: string,
    status: AdminTaskStatus,
    comment?: string,
  ) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: {
        id: taskId,
        clubId,
        OR: [
          { assigneeId: user.sub },
          {
            source: {
              in: [
                'MEMBERSHIP_EXPIRING',
                'CLIENT_DEBT',
                'STAFF_DEBT',
                'INSTALLMENT_PAYMENT',
                'BIRTHDAY',
                'BOOKING_CONFIRM',
              ],
            },
          },
        ],
      },
      include: {
        assignee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        status: status as PrismaAdminTaskStatus,
        completedAt: status === AdminTaskStatus.DONE ? new Date() : null,
        assigneeId: task.assigneeId ?? user.sub,
      },
    });

    if (
      status === AdminTaskStatus.DONE &&
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
          },
        });
        await this.prisma.adminTaskEvent.create({
          data: {
            taskId: sib.id,
            actorId: user.sub,
            comment: `Выполнил: ${actorName} (общее выполнение)`,
          },
        });
      }
    }

    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        comment:
          status === AdminTaskStatus.DONE
            ? comment?.trim()
              ? `Выполнена: ${comment.trim()}`
              : 'Выполнена'
            : status === AdminTaskStatus.IN_PROGRESS
              ? 'В работу'
              : String(status),
      },
    });

    if (status === AdminTaskStatus.DONE) {
      await ackDiscrepancyFromTask(this.prisma, task, user.sub, comment);
    }

    return updated;
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
      groupId?: string | null;
      completionMode?: string | null;
      assignee?: { id: string; firstName: string; lastName: string } | null;
      createdBy?: { id: string; firstName: string; lastName: string } | null;
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
    let debtTotal =
      typeof meta.total === 'number' ? meta.total : undefined;
    if (debtTotal == null) {
      const m = task.title.match(/\(([\d\s.,]+)\s*BYN\)\s*$/i);
      if (m) {
        const parsed = Number(m[1].replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(parsed)) debtTotal = parsed;
      }
    }
    const debtCount =
      typeof meta.count === 'number' ? meta.count : undefined;
    const oldestSoldAt =
      typeof meta.oldestSoldAt === 'string' ? meta.oldestSoldAt : undefined;
    const debtAgeDays = oldestSoldAt
      ? Math.floor(
          (Date.now() - new Date(oldestSoldAt).getTime()) / 86400000,
        )
      : undefined;
    const planDate =
      typeof meta.planDate === 'string' ? meta.planDate : undefined;
    const overdueDays = planDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(planDate).getTime()) / 86400000,
          ),
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
        clientName:
          clientName ??
          (typeof meta.clientName === 'string' ? meta.clientName : null),
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
      debtTotal,
      debtCount,
      oldestSoldAt,
      debtAgeDays,
      sellers: Array.isArray(meta.sellers)
        ? (meta.sellers as string[])
        : undefined,
      installmentPaymentN:
        typeof meta.paymentN === 'number' ? meta.paymentN : undefined,
      installmentPaymentTotal:
        typeof meta.paymentTotal === 'number' ? meta.paymentTotal : undefined,
      planAmount:
        typeof meta.planAmount === 'number' ? meta.planAmount : undefined,
      planDate,
      overdueDays,
      templateName:
        typeof meta.templateName === 'string' ? meta.templateName : undefined,
      saleNumber:
        typeof meta.number === 'string' ? meta.number : undefined,
      sessionKey:
        typeof meta.sessionKey === 'string' ? meta.sessionKey : undefined,
      roomTitle:
        typeof meta.roomTitle === 'string' ? meta.roomTitle : undefined,
      confirmClients: Array.isArray(meta.clients)
        ? (meta.clients as Array<Record<string, unknown>>)
            .filter((c) => typeof c.externalId === 'string')
            .map((c) => ({
              externalId: c.externalId as string,
              clientName:
                typeof c.clientName === 'string'
                  ? c.clientName
                  : (c.externalId as string),
              phone:
                typeof c.phone === 'string' && c.phone ? c.phone : undefined,
              confirmed: c.confirmed === true,
              confirmedAt:
                typeof c.confirmedAt === 'string' ? c.confirmedAt : undefined,
            }))
        : undefined,
    };
  }

  async confirmBookingClient(
    user: JwtPayload,
    taskId: string,
    body: { clientExternalId: string; confirmed?: boolean },
  ) {
    const clubId = requireClubId(user);
    const externalId = body.clientExternalId?.trim();
    if (!externalId) {
      throw new BadRequestException('clientExternalId обязателен');
    }
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId, source: 'BOOKING_CONFIRM' },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    if (
      task.status === PrismaAdminTaskStatus.DONE ||
      task.status === PrismaAdminTaskStatus.CANCELLED
    ) {
      throw new BadRequestException('Задача уже закрыта');
    }

    const meta = (task.meta ?? {}) as Record<string, unknown>;
    const clients = Array.isArray(meta.clients)
      ? ([...meta.clients] as Array<Record<string, unknown>>)
      : [];
    const idx = clients.findIndex((c) => c.externalId === externalId);
    if (idx < 0) {
      throw new NotFoundException('Клиент не найден в задаче');
    }
    const confirmed = body.confirmed !== false;
    clients[idx] = {
      ...clients[idx],
      confirmed,
      confirmedAt: confirmed ? new Date().toISOString() : null,
    };
    const allDone =
      clients.length > 0 && clients.every((c) => c.confirmed === true);

    const nextMeta = {
      ...meta,
      clients,
    } as Prisma.InputJsonValue;

    const updated = await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        meta: nextMeta,
        status: allDone
          ? PrismaAdminTaskStatus.DONE
          : task.status === PrismaAdminTaskStatus.OPEN
            ? PrismaAdminTaskStatus.IN_PROGRESS
            : task.status,
        completedAt: allDone ? new Date() : null,
        assigneeId: task.assigneeId ?? user.sub,
      },
      include: {
        assignee: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId: user.sub,
        comment: confirmed
          ? `Подтвердил: ${String(clients[idx].clientName ?? externalId)}`
          : `Снял подтверждение: ${String(clients[idx].clientName ?? externalId)}`,
      },
    });
    return this.mapTaskItem(updated);
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
