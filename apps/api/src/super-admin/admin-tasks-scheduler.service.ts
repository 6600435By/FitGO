import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminTaskStatus,
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  Prisma,
  Role,
  SpaBookingStatus,
} from '@prisma/client';
import {
  FitgoAnalyticsHttpProvider,
  isGuestVisitProductName,
  type FitgoBirthdayRow,
  type FitgoExpiringMembershipRow,
  type FitgoInstallmentSale,
  type FitgoRenewalCoverageRow,
} from '@fitgo/1c-adapter';
import {
  fitgoSessionKey,
  isMultiVisitPackSale,
  onexSessionKey,
  resolveGroupRoomKey,
} from '@fitgo/shared-types';
import {
  classifySaleType,
  isLikelyTrainingProductName,
  loadPayrollSegmentSets,
} from '../admin-sales/admin-sales-segments';
import { preferredSaleBasisId } from '../admin-sales/payment-basis-products';
import {
  isCollectibleClientDebt,
  isStaffDebtorName,
} from '../admin-sales/club-revenue-debt';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { localDayKey } from '../club-schedule/trainer-schedule.helpers';

type ConfirmClientMeta = {
  externalId: string;
  clientName: string;
  phone: string | null;
  confirmed: boolean;
  confirmedAt?: string | null;
};

const SCAN_DAYS = 14;
const SHORT_TERM_MAX_DAYS = 31;
const WINDOW = { short: 7, long: 14 } as const;
const CALL_LEAD = { short: 3, long: 7 } as const;
const MAX_NO_ANSWER = 2;
const NO_ANSWER_RETRY_DAYS = 2;
const LOST_AFTER_DAYS = 7;
const REFRESH_MIN_MS = 30 * 60 * 1000;
/** e1cib ref 81167085c20c362e11eb03e61ea82c5b → platform UUID (not dash-insert). */
const BIRTHDAY_SEGMENT_UUID = '1ea82c5b-03e6-11eb-8116-7085c20c362e';
const BIRTHDAY_ACTIVE_MONTHS = 24;

/** @deprecated use MAX_NO_ANSWER — kept for imports during transition */
const MAX_CALL_ATTEMPTS = MAX_NO_ANSWER;
/** @deprecated use SCAN_DAYS */
const MEMBERSHIP_DAYS = SCAN_DAYS;

type TermBucket = 'short' | 'long';

@Injectable()
export class AdminTasksSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AdminTasksSchedulerService.name);
  private lastDayKey = '';
  private readonly lastRefreshAt = new Map<string, number>();
  private readonly lastBirthdayRefreshAt = new Map<string, number>();
  /** Last birthday scan error per club (cleared on success). */
  private readonly lastBirthdayScanError = new Map<string, string>();
  /** One birthday scan per club — inbox must not start a second 60s 1C call. */
  private readonly birthdayRefreshFlight = new Map<
    string,
    Promise<{
      created: number;
      skipped: number;
      skippedThrottle: boolean;
      scanError: string | null;
    }>
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Nightly admin-task generation is invoked from ClubSyncOrchestrator FULL.
    // Keep legacy cron only when club sync is off.
    if (this.config.get('ENABLE_CLUB_SYNC_CRON') !== 'false') return;
    if (this.config.get('ENABLE_ADMIN_TASKS_CRON') === 'false') return;
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    if (now.getHours() < 3 || now.getHours() >= 5) return;
    const dayKey = localDayKey(now);
    if (this.lastDayKey === dayKey) return;
    this.lastDayKey = dayKey;
    this.logger.log('Starting daily auto admin tasks');
    try {
      const clubs = await this.prisma.club.findMany({
        select: { id: true, externalId: true },
      });
      for (const club of clubs) {
        try {
          await this.generateForClub(club.id, club.externalId, dayKey);
        } catch (err) {
          this.logger.error(
            `Auto tasks failed for ${club.id}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
    } catch (err) {
      this.logger.error('Auto tasks tick failed', err);
    }
  }

  async generateForClub(
    clubId: string,
    clubExternalId: string | null,
    dayKey = localDayKey(),
  ) {
    const systemUser = await this.prisma.user.findFirst({
      where: {
        clubId,
        roles: { some: { role: Role.SUPER_ADMIN } },
        isActive: true,
      },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn(`No SUPER_ADMIN for club ${clubId} — skip auto tasks`);
      return { debt: 0, membership: 0, closedRenewed: 0, closedLost: 0 };
    }

    await this.cancelLegacyPerSaleDebtTasks(clubId, systemUser.id);
    const debtCreated = await this.syncDebtors(clubId, systemUser.id);
    const installment = await this.syncInstallmentPayments(
      clubId,
      systemUser.id,
    );
    const membership = await this.syncMembershipRenewals(
      clubId,
      clubExternalId,
      systemUser.id,
    );
    const birthdays = await this.syncBirthdays(clubId, systemUser.id, dayKey);
    const confirmations = await this.syncBookingConfirmations(
      clubId,
      systemUser.id,
      dayKey,
    );
    const ptNoPerformer = await this.syncTrainingSalesNoPerformer(
      clubId,
      systemUser.id,
    );

    this.logger.log(
      `Club ${clubId}: debt +${debtCreated}, installment +${installment}, membership +${membership.created}, renewed ${membership.closedRenewed}, lost ${membership.closedLost}, birthday +${birthdays.created} skip ${birthdays.skipped}, confirm +${confirmations.created}, ptNoPerformer +${ptNoPerformer}`,
    );
    return {
      debt: debtCreated,
      installment,
      membership: membership.created,
      closedRenewed: membership.closedRenewed,
      closedLost: membership.closedLost,
      birthday: birthdays.created,
      birthdaySkipped: birthdays.skipped,
      confirmation: confirmations.created,
      ptNoPerformer,
    };
  }

  private addClubDays(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    const utc = Date.UTC(y, m - 1, d + days);
    return new Date(utc).toISOString().slice(0, 10);
  }

  /** Last scan error for admin empty-state hint (null if last scan ok). */
  getBirthdayScanError(clubId: string): string | null {
    return this.lastBirthdayScanError.get(clubId) ?? null;
  }

  /**
   * Start a birthday scan without holding the task list.
   * A slow /clients/birthdays used to keep GET /super-admin/tasks open for 60s,
   * so the inbox painted as empty while admins still had the queue.
   */
  refreshBirthdaysNonBlocking(clubId: string) {
    void this.refreshBirthdays(clubId).catch((err) => {
      this.logger.warn(
        `Birthday refresh failed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /**
   * Refresh birthday tasks from 1C. Safe for admin / super-admin inbox open.
   * At most once per 30 min per club unless force.
   */
  async refreshBirthdays(clubId: string, force = false) {
    const inflight = this.birthdayRefreshFlight.get(clubId);
    if (inflight && !force) return inflight;

    const last = this.lastBirthdayRefreshAt.get(clubId) ?? 0;
    if (!force && Date.now() - last < REFRESH_MIN_MS) {
      return {
        created: 0,
        skipped: 0,
        skippedThrottle: true as const,
        scanError: this.lastBirthdayScanError.get(clubId) ?? null,
      };
    }

    const job = this.executeBirthdayRefresh(clubId);
    this.birthdayRefreshFlight.set(clubId, job);
    void job.finally(() => {
      if (this.birthdayRefreshFlight.get(clubId) === job) {
        this.birthdayRefreshFlight.delete(clubId);
      }
    });
    return job;
  }

  private async executeBirthdayRefresh(clubId: string) {
    const systemUser =
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.SUPER_ADMIN } },
          isActive: true,
        },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.ADMIN } },
          isActive: true,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!systemUser) {
      return {
        created: 0,
        skipped: 0,
        skippedThrottle: false as const,
        scanError: this.lastBirthdayScanError.get(clubId) ?? null,
      };
    }

    this.lastBirthdayRefreshAt.set(clubId, Date.now());
    const result = await this.syncBirthdays(
      clubId,
      systemUser.id,
      localDayKey(),
    );
    return {
      ...result,
      skippedThrottle: false as const,
      scanError: this.lastBirthdayScanError.get(clubId) ?? null,
    };
  }

  private async syncBirthdays(
    clubId: string,
    systemUserId: string,
    dayKey: string,
  ) {
    let created = 0;
    let skipped = 0;
    const provider = this.fitness.getProvider();
    if (!provider.getSegmentBirthdays) {
      const msg = 'Провайдер 1С не поддерживает дни рождения';
      this.lastBirthdayScanError.set(clubId, msg);
      return { created, skipped, scanError: msg };
    }

    let rows: FitgoBirthdayRow[] = [];
    try {
      rows = await provider.getSegmentBirthdays(BIRTHDAY_SEGMENT_UUID);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Birthday scan failed: ${msg}`);
      this.lastBirthdayScanError.set(clubId, msg);
      return { created, skipped, scanError: msg };
    }

    this.lastBirthdayScanError.delete(clubId);

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - BIRTHDAY_ACTIVE_MONTHS);

    // Close yesterday's open birthday tasks
    const yesterday = this.addClubDays(dayKey, -1);
    const stale = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'BIRTHDAY',
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
        dedupeKey: { startsWith: 'birthday:' },
        NOT: { dedupeKey: { endsWith: `:${dayKey}` } },
      },
      take: 200,
    });
    for (const task of stale) {
      if (task.dedupeKey?.endsWith(`:${yesterday}`) || !task.dedupeKey?.endsWith(`:${dayKey}`)) {
        await this.prisma.adminTask.update({
          where: { id: task.id },
          data: {
            status: AdminTaskStatus.DONE,
            completedAt: new Date(),
          },
        });
        await this.prisma.adminTaskEvent.create({
          data: {
            taskId: task.id,
            actorId: systemUserId,
            comment: 'Авто: день рождения прошёл',
          },
        });
      }
    }

    for (const row of rows) {
      const lastVisit = row.lastVisitAt
        ? new Date(row.lastVisitAt.slice(0, 10))
        : null;
      const activeVisit =
        lastVisit != null &&
        !Number.isNaN(lastVisit.getTime()) &&
        lastVisit.getTime() >= cutoff.getTime();
      const guestOnly = row.guestOnly === true;
      const include =
        !guestOnly &&
        (activeVisit || row.hasActiveMembership === true);
      const name =
        `${row.lastName} ${row.firstName}`.trim() || row.externalId;
      const dedupeKey = include
        ? `birthday:${row.externalId}:${dayKey}`
        : `birthday-skip:${row.externalId}:${dayKey}`;

      if (!include) {
        skipped += 1;
        const skipReason = guestOnly
          ? 'Не звоним — только гостевой визит'
          : 'Не звоним — нет визита более 2 лет и нет абонемента';
        await this.prisma.adminTask.upsert({
          where: { clubId_dedupeKey: { clubId, dedupeKey } },
          create: {
            clubId,
            createdById: systemUserId,
            title: `День рождения: ${name}`,
            description: skipReason,
            dueAt: new Date(`${dayKey}T10:00:00+03:00`),
            status: AdminTaskStatus.CANCELLED,
            completedAt: new Date(),
            source: 'BIRTHDAY',
            dedupeKey,
            clientExternalId: row.externalId,
            meta: {
              phone: row.phone ?? null,
              clientName: name,
              skippedInactive: true,
              skippedGuest: guestOnly,
              lastVisitAt: row.lastVisitAt ?? null,
            },
          },
          update: {},
        });
        continue;
      }

      const existing = await this.prisma.adminTask.findUnique({
        where: { clubId_dedupeKey: { clubId, dedupeKey } },
      });
      if (existing) continue;

      await this.prisma.adminTask.create({
        data: {
          clubId,
          createdById: systemUserId,
          title: `День рождения: ${name}`,
          description: 'Поздравить клиента',
          dueAt: new Date(`${dayKey}T10:00:00+03:00`),
          status: AdminTaskStatus.OPEN,
          source: 'BIRTHDAY',
          dedupeKey,
          clientExternalId: row.externalId,
          meta: {
            phone: row.phone ?? null,
            clientName: name,
            lastVisitAt: row.lastVisitAt ?? null,
            hasActiveMembership: row.hasActiveMembership === true,
          },
        },
      });
      created += 1;
    }

    return { created, skipped, scanError: null as string | null };
  }

  /** Public refresh used by admin tasks inbox (local DB — cheap). */
  async refreshBookingConfirmations(clubId: string, dayKey = localDayKey()) {
    const systemUser =
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.SUPER_ADMIN } },
          isActive: true,
        },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.ADMIN } },
          isActive: true,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!systemUser) return { created: 0 };
    return this.syncBookingConfirmations(clubId, systemUser.id, dayKey);
  }

  private async syncBookingConfirmations(
    clubId: string,
    systemUserId: string,
    dayKey: string,
  ) {
    let created = 0;
    const tomorrow = this.addClubDays(dayKey, 1);
    const start = new Date(`${tomorrow}T00:00:00+03:00`);
    const end = new Date(`${tomorrow}T23:59:59.999+03:00`);
    const seenDedupe = new Set<string>();

    // Cancel confirmations that are no longer for tomorrow / cancelled sessions
    const openConfirm = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'BOOKING_CONFIRM',
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
      },
      take: 500,
    });
    for (const task of openConfirm) {
      const meta = (task.meta ?? {}) as Record<string, unknown>;
      const sessionDate =
        typeof meta.sessionDate === 'string' ? meta.sessionDate : '';
      // Legacy per-client keys → cancel (replaced by one task per session)
      const isLegacyPerClient =
        !!task.dedupeKey?.startsWith('confirm:') &&
        !task.dedupeKey.startsWith('confirm-session:') &&
        !task.dedupeKey.startsWith('confirm-spa:');
      if ((sessionDate && sessionDate !== tomorrow) || isLegacyPerClient) {
        await this.prisma.adminTask.update({
          where: { id: task.id },
          data: {
            status: AdminTaskStatus.CANCELLED,
            completedAt: new Date(),
          },
        });
        await this.prisma.adminTaskEvent.create({
          data: {
            taskId: task.id,
            actorId: systemUserId,
            comment: isLegacyPerClient
              ? 'Авто: заменено на одну задачу по занятию'
              : 'Авто: занятие уже не завтра',
          },
        });
      }
    }

    // GROUP in «Зал реформеров» — filter in JS: Postgres ILIKE is unreliable for Cyrillic case
    const groupSessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        isActive: true,
        status: {
          in: [OnexClassStatus.SCHEDULED, OnexClassStatus.IN_PROGRESS],
        },
        startAt: { gte: start, lte: end },
      },
      include: {
        members: {
          where: {
            cancelled: false,
            attendance: {
              not: OnexClassMemberAttendance.CANCELLED,
            },
          },
        },
      },
    });
    const reformerSessions = groupSessions.filter(
      (s) =>
        resolveGroupRoomKey(s.roomTitle) === 'REFORMER' ||
        /реформ/i.test(s.title ?? ''),
    );

    const spaBookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        status: { not: SpaBookingStatus.CANCELLED },
        startAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        startAt: true,
        guestPhone: true,
        guestName: true,
        clientExternalId: true,
        service: { select: { name: true } },
        client: {
          select: {
            externalId: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const externalIds = [
      ...new Set([
        ...reformerSessions.flatMap((s) =>
          s.members.map((m) => m.externalId).filter(Boolean),
        ),
        ...spaBookings
          .map((b) => b.client?.externalId || b.clientExternalId)
          .filter((id): id is string => !!id),
      ]),
    ];
    const users = externalIds.length
      ? await this.prisma.user.findMany({
          where: { clubId, externalId: { in: externalIds } },
          select: {
            externalId: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];
    const phoneByExt = new Map(
      users
        .filter((u) => u.externalId)
        .map((u) => [u.externalId as string, u.phone ?? '']),
    );

    const needRoster = reformerSessions.filter((s) =>
      s.members.some((m) => !phoneByExt.get(m.externalId)),
    );
    const rosterPhone = new Map<string, string>();
    const provider = this.fitness.getProvider();
    if (provider.getGroupSessionRoster && needRoster.length) {
      for (const s of needRoster.slice(0, 30)) {
        try {
          const roster = await provider.getGroupSessionRoster(s.externalId);
          for (const m of roster?.data ?? []) {
            if (m.externalId && m.phone) {
              rosterPhone.set(m.externalId, m.phone);
            }
          }
        } catch {
          // non-fatal
        }
      }
    }

    for (const session of reformerSessions) {
      if (!session.members.length) continue;
      const sessionKey = onexSessionKey(session.externalId);
      const dedupeKey = `confirm-session:${session.externalId}:${tomorrow}`;
      seenDedupe.add(dedupeKey);

      const clients: ConfirmClientMeta[] = session.members.map((member) => {
        const phone =
          phoneByExt.get(member.externalId) ||
          rosterPhone.get(member.externalId) ||
          '';
        return {
          externalId: member.externalId,
          clientName: member.clientName?.trim() || member.externalId,
          phone: phone || null,
          confirmed: false,
        };
      });

      const timeLabel = session.startAt.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Minsk',
      });
      const title = `Реформер ${timeLabel}: подтвердить ${clients.length}`;
      const description = `${session.title}${session.roomTitle ? ` · ${session.roomTitle}` : ''} · ${tomorrow}`;
      const metaBase = {
        membershipName: session.title,
        roomTitle: session.roomTitle ?? null,
        sessionKey,
        sessionDate: tomorrow,
        sessionExternalId: session.externalId,
        kind: 'GROUP',
        confirmKind: 'REFORMER',
      };

      const existing = await this.prisma.adminTask.findUnique({
        where: { clubId_dedupeKey: { clubId, dedupeKey } },
      });
      if (existing) {
        if (
          existing.status === AdminTaskStatus.CANCELLED ||
          existing.status === AdminTaskStatus.DONE
        ) {
          continue;
        }
        const prevMeta = (existing.meta ?? {}) as Record<string, unknown>;
        const prevClients = Array.isArray(prevMeta.clients)
          ? (prevMeta.clients as ConfirmClientMeta[])
          : [];
        const prevById = new Map(
          prevClients.map((c) => [c.externalId, c] as const),
        );
        const merged = clients.map((c) => {
          const prev = prevById.get(c.externalId);
          if (prev?.confirmed) {
            return {
              ...c,
              confirmed: true,
              confirmedAt: prev.confirmedAt ?? null,
            };
          }
          return c;
        });
        await this.prisma.adminTask.update({
          where: { id: existing.id },
          data: {
            title,
            description,
            dueAt: session.startAt,
            meta: {
              ...metaBase,
              clients: merged,
            },
          },
        });
        continue;
      }

      await this.prisma.adminTask.create({
        data: {
          clubId,
          createdById: systemUserId,
          title,
          description,
          dueAt: session.startAt,
          status: AdminTaskStatus.OPEN,
          source: 'BOOKING_CONFIRM',
          dedupeKey,
          meta: {
            ...metaBase,
            clients,
          },
        },
      });
      created += 1;
    }

    for (const booking of spaBookings) {
      const ext =
        booking.client?.externalId ||
        booking.clientExternalId ||
        `guest:${booking.id}`;
      const clientName =
        (booking.client
          ? `${booking.client.lastName} ${booking.client.firstName}`.trim()
          : '') ||
        booking.guestName?.trim() ||
        'Клиент SPA';
      const phone =
        booking.client?.phone ||
        phoneByExt.get(ext) ||
        booking.guestPhone ||
        '';
      const sessionKey = fitgoSessionKey('SPA', booking.id);
      const dedupeKey = `confirm-spa:${booking.id}:${tomorrow}`;
      seenDedupe.add(dedupeKey);
      const clients: ConfirmClientMeta[] = [
        {
          externalId: ext,
          clientName,
          phone: phone || null,
          confirmed: false,
        },
      ];
      const serviceName = booking.service.name;
      const timeLabel = booking.startAt.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Minsk',
      });
      const title = `SPA ${timeLabel}: ${clientName}`;
      const description = `${serviceName} · ${tomorrow}`;
      const metaBase = {
        phone: phone || null,
        clientName,
        membershipName: serviceName,
        sessionKey,
        sessionDate: tomorrow,
        spaBookingId: booking.id,
        kind: 'SPA',
        confirmKind: 'SPA',
      };

      const existing = await this.prisma.adminTask.findUnique({
        where: { clubId_dedupeKey: { clubId, dedupeKey } },
      });
      if (existing) {
        if (
          existing.status === AdminTaskStatus.CANCELLED ||
          existing.status === AdminTaskStatus.DONE
        ) {
          continue;
        }
        const prevMeta = (existing.meta ?? {}) as Record<string, unknown>;
        const prevClients = Array.isArray(prevMeta.clients)
          ? (prevMeta.clients as ConfirmClientMeta[])
          : [];
        const wasConfirmed = prevClients.some(
          (c) => c.externalId === ext && c.confirmed,
        );
        await this.prisma.adminTask.update({
          where: { id: existing.id },
          data: {
            title,
            description,
            dueAt: booking.startAt,
            clientExternalId: booking.clientExternalId ?? null,
            meta: {
              ...metaBase,
              clients: clients.map((c) =>
                wasConfirmed
                  ? {
                      ...c,
                      confirmed: true,
                      confirmedAt:
                        prevClients.find((p) => p.externalId === ext)
                          ?.confirmedAt ?? null,
                    }
                  : c,
              ),
            },
          },
        });
        continue;
      }

      await this.prisma.adminTask.create({
        data: {
          clubId,
          createdById: systemUserId,
          title,
          description,
          dueAt: booking.startAt,
          status: AdminTaskStatus.OPEN,
          source: 'BOOKING_CONFIRM',
          dedupeKey,
          clientExternalId: booking.clientExternalId ?? null,
          meta: {
            ...metaBase,
            clients,
          },
        },
      });
      created += 1;
    }

    // Cancel open confirm tasks whose session/booking disappeared
    const stillOpen = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'BOOKING_CONFIRM',
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
        OR: [
          { dedupeKey: { startsWith: 'confirm-session:' } },
          { dedupeKey: { startsWith: 'confirm-spa:' } },
        ],
      },
      select: { id: true, dedupeKey: true },
      take: 500,
    });
    for (const task of stillOpen) {
      if (!task.dedupeKey || seenDedupe.has(task.dedupeKey)) continue;
      if (!task.dedupeKey.endsWith(`:${tomorrow}`)) continue;
      await this.prisma.adminTask.update({
        where: { id: task.id },
        data: {
          status: AdminTaskStatus.CANCELLED,
          completedAt: new Date(),
        },
      });
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId: task.id,
          actorId: systemUserId,
          comment: 'Авто: запись/занятие отменены или без клиентов',
        },
      });
    }

    return { created };
  }

  private readonly lastDebtRefreshAt = new Map<string, number>();

  /**
   * Rebuild debtor tasks (one row per person). Safe to call from admin UI.
   * Cancels legacy per-sale debt tasks first.
   */
  async refreshDebtors(clubId: string, force = false) {
    const last = this.lastDebtRefreshAt.get(clubId) ?? 0;
    if (!force && Date.now() - last < REFRESH_MIN_MS) {
      return { created: 0, skipped: true as const };
    }

    const systemUser =
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.SUPER_ADMIN } },
          isActive: true,
        },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.ADMIN } },
          isActive: true,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!systemUser) {
      return { created: 0, skipped: false as const };
    }

    this.lastDebtRefreshAt.set(clubId, Date.now());
    // Cancel in batches until none left (legacy take was 500)
    for (let i = 0; i < 20; i++) {
      const before = await this.prisma.adminTask.count({
        where: {
          clubId,
          status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
          OR: [
            { source: 'DEBT_OVERDUE' },
            {
              source: { in: ['STAFF_DEBT', 'CLIENT_DEBT'] },
              dedupeKey: { startsWith: 'debt:' },
            },
          ],
        },
      });
      if (before === 0) break;
      await this.cancelLegacyPerSaleDebtTasks(clubId, systemUser.id);
    }
    const created = await this.syncDebtors(clubId, systemUser.id);
    return { created, skipped: false as const };
  }

  /** Public refresh used by admin UI — at most once per 30 min per club. */
  async refreshMembershipRenewals(clubId: string, force = false) {
    const last = this.lastRefreshAt.get(clubId) ?? 0;
    if (!force && Date.now() - last < REFRESH_MIN_MS) {
      return {
        created: 0,
        closedRenewed: 0,
        closedLost: 0,
        skipped: true as const,
      };
    }

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, externalId: true },
    });
    if (!club) {
      return { created: 0, closedRenewed: 0, closedLost: 0 };
    }

    const systemUser =
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.SUPER_ADMIN } },
          isActive: true,
        },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: Role.ADMIN } },
          isActive: true,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }));

    if (!systemUser) {
      return { created: 0, closedRenewed: 0, closedLost: 0 };
    }
    this.lastRefreshAt.set(clubId, Date.now());
    return this.syncMembershipRenewals(
      clubId,
      club.externalId,
      systemUser.id,
    );
  }

  /** One-shot batch: cancel old per-sale debt tasks (debt:{saleId}:…). */
  private async cancelLegacyPerSaleDebtTasks(
    clubId: string,
    systemUserId: string,
  ) {
    const legacy = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
        OR: [
          { source: 'DEBT_OVERDUE' },
          {
            source: { in: ['STAFF_DEBT', 'CLIENT_DEBT'] },
            dedupeKey: { startsWith: 'debt:' },
          },
        ],
      },
      select: { id: true },
      take: 500,
    });
    if (!legacy.length) return;
    await this.prisma.adminTask.updateMany({
      where: { id: { in: legacy.map((r) => r.id) } },
      data: {
        status: AdminTaskStatus.CANCELLED,
        completedAt: new Date(),
        nextActionAt: null,
      },
    });
    await this.prisma.adminTaskEvent.createMany({
      data: legacy.map((row) => ({
        taskId: row.id,
        actorId: systemUserId,
        comment: 'Авто: заменено на задачу «один должник»',
      })),
    });
  }

  /**
   * One AdminTask per debtor (client or staff), shared club queue.
   * Source = ClubRevenue unpaid snapshot (`scope=debt` from Analytics) —
   * same register as 1C «Неоплаченные» / карточка «Оплатить».
   * Do not use SaleTransaction unpaid: that cache is not cleared when debt
   * leaves the register outside the sales sync window.
   */
  /**
   * One-shot PT (сегмент «Тренировки») sold without Исполнитель → admin queue.
   * Packs «N ПТ» skipped. Auto-closes when performer appears on revenue sync.
   */
  private async syncTrainingSalesNoPerformer(
    clubId: string,
    systemUserId: string,
  ): Promise<number> {
    const segments = await loadPayrollSegmentSets(this.config);
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - SCAN_DAYS);
    fromD.setHours(0, 0, 0, 0);

    const entries = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: fromD },
        operationType: { in: ['payment', 'sale', 'unpaid'] },
      },
      take: 5000,
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        documentId: true,
        externalId: true,
        productName: true,
        productExternalId: true,
        saleType: true,
        clientName: true,
        clientExternalId: true,
        employeeName: true,
        employeeExternalId: true,
        performerExternalId: true,
        performerName: true,
        amount: true,
        paidAmount: true,
        saleAmount: true,
        occurredAt: true,
      },
    });

    type Missing = {
      dedupeKey: string;
      productName: string;
      clientName: string;
      clientExternalId: string | null;
      authorName: string;
      amount: number;
      occurredAt: Date;
      documentId: string;
    };
    const missing = new Map<string, Missing>();

    for (const e of entries) {
      const product = e.productName ?? '';
      // Glued cash «занятие, вода» — check PT segment of the name.
      const ptProbe = product.includes(',')
        ? product
            .split(',')
            .map((p) => p.trim())
            .find(
              (p) =>
                isLikelyTrainingProductName(p) ||
                classifySaleType(
                  e.saleType ?? undefined,
                  p,
                  segments,
                  e.productExternalId,
                ) === 'training',
            ) ?? product
        : product;
      const bucket = classifySaleType(
        e.saleType ?? undefined,
        ptProbe,
        segments,
        e.productExternalId,
      );
      const isTraining =
        bucket === 'training' || isLikelyTrainingProductName(ptProbe);
      if (!isTraining) continue;
      if (isMultiVisitPackSale(ptProbe) || isMultiVisitPackSale(product)) {
        continue;
      }
      if (!isLikelyTrainingProductName(ptProbe)) {
        // Segment hit but not a one-shot name (e.g. odd pack) — skip.
        continue;
      }
      const hasPerf = Boolean(
        e.performerExternalId?.trim() || e.performerName?.trim(),
      );
      if (hasPerf) continue;

      const documentId = preferredSaleBasisId({
        externalId: e.externalId,
        documentId: e.documentId,
      });
      if (!documentId) continue;
      const dedupeKey = `training-sale:${documentId}`;
      if (missing.has(dedupeKey)) continue;

      const amount =
        Number(e.paidAmount) ||
        Number(e.saleAmount) ||
        Number(e.amount) ||
        0;
      missing.set(dedupeKey, {
        dedupeKey,
        productName: ptProbe || product || 'ПТ',
        clientName: (e.clientName ?? '').trim() || 'клиент',
        clientExternalId: e.clientExternalId?.trim() || null,
        authorName:
          (e.employeeName ?? '').trim() ||
          (e.employeeExternalId ?? '').trim() ||
          '—',
        amount,
        occurredAt: e.occurredAt,
        documentId,
      });
    }

    const openTasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'TRAINING_SALE_NO_PERFORMER',
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
        dedupeKey: { startsWith: 'training-sale:' },
      },
    });
    const byDedupe = new Map(
      openTasks
        .filter((t) => t.dedupeKey)
        .map((t) => [t.dedupeKey as string, t]),
    );

    let created = 0;
    const toCreate: Prisma.AdminTaskCreateManyInput[] = [];
    const now = new Date();
    for (const row of missing.values()) {
      const amountStr = row.amount.toFixed(2);
      const whenIso = row.occurredAt.toISOString().slice(0, 10);
      const title = `Проверить продажу: ${row.productName} · ${row.clientName}`;
      const description = `Нет исполнителя на разовом занятии ПТ. Автор: ${row.authorName}. Сумма: ${amountStr} BYN. Дата: ${whenIso}. Документ: ${row.documentId}.`;
      const meta = {
        documentId: row.documentId,
        productName: row.productName,
        clientName: row.clientName,
        authorName: row.authorName,
        amount: row.amount,
        occurredAt: row.occurredAt.toISOString(),
      };
      const existing = byDedupe.get(row.dedupeKey);
      if (existing) {
        await this.prisma.adminTask.update({
          where: { id: existing.id },
          data: {
            title,
            description,
            meta,
            clientExternalId: row.clientExternalId,
            dueAt: row.occurredAt,
            relatedSaleId: null,
          },
        });
        continue;
      }
      toCreate.push({
        clubId,
        assigneeId: null,
        createdById: systemUserId,
        title,
        description,
        dueAt: row.occurredAt,
        status: AdminTaskStatus.OPEN,
        source: 'TRAINING_SALE_NO_PERFORMER',
        dedupeKey: row.dedupeKey,
        relatedSaleId: null,
        clientExternalId: row.clientExternalId,
        meta,
        nextActionAt: now,
      });
    }
    if (toCreate.length) {
      const res = await this.prisma.adminTask.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      created += res.count;
    }

    for (const task of openTasks) {
      if (!task.dedupeKey || missing.has(task.dedupeKey)) continue;
      await this.prisma.adminTask.update({
        where: { id: task.id },
        data: {
          status: AdminTaskStatus.DONE,
          completedAt: new Date(),
          nextActionAt: null,
        },
      });
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId: task.id,
          actorId: systemUserId,
          comment: 'Авто: исполнитель проставлен',
        },
      });
    }

    return created;
  }

  private async syncDebtors(clubId: string, systemUserId: string) {
    let created = 0;
    const unpaid = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        operationType: 'unpaid',
      },
      take: 5000,
      orderBy: { occurredAt: 'asc' },
    });

    type Bucket = {
      key: string;
      kind: 'client' | 'staff';
      name: string;
      clientExternalId: string | null;
      total: number;
      count: number;
      oldestSoldAt: Date;
      sellers: Set<string>;
      entryIds: string[];
    };
    const buckets = new Map<string, Bucket>();

    for (const row of unpaid) {
      if (
        !isCollectibleClientDebt({
          externalId: row.externalId,
          productName: row.productName,
        })
      ) {
        continue;
      }
      const amount = Number(row.amount || row.saleAmount || 0);
      if (!(amount > 0)) continue;
      const staffDebt = isStaffDebtorName(row.clientName);
      const kind = staffDebt ? 'staff' : 'client';
      const ext = row.clientExternalId?.trim() || null;
      const name =
        (row.clientName ?? '').trim() ||
        (staffDebt ? 'сотрудник' : 'клиент');
      const key = ext ? `${kind}:id:${ext}` : `${kind}:name:${name.toLowerCase()}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          kind,
          name,
          clientExternalId: ext,
          total: 0,
          count: 0,
          oldestSoldAt: row.occurredAt,
          sellers: new Set(),
          entryIds: [],
        };
        buckets.set(key, bucket);
      }
      bucket.total += amount;
      bucket.count += 1;
      if (row.occurredAt < bucket.oldestSoldAt) {
        bucket.oldestSoldAt = row.occurredAt;
      }
      const seller =
        (row.employeeName ?? '').trim() ||
        (row.employeeExternalId ?? '').trim();
      if (seller) bucket.sellers.add(seller);
      bucket.entryIds.push(row.id);
    }

    const openSources = ['CLIENT_DEBT', 'STAFF_DEBT'] as const;
    const openTasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: { in: [...openSources] },
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
        dedupeKey: { startsWith: 'debtor:' },
      },
    });
    const byDedupe = new Map(
      openTasks
        .filter((t) => t.dedupeKey)
        .map((t) => [t.dedupeKey as string, t]),
    );
    const seen = new Set<string>();

    const toCreate: Prisma.AdminTaskCreateManyInput[] = [];
    const now = new Date();
    for (const bucket of buckets.values()) {
      const dedupeKey = `debtor:${bucket.key}`;
      seen.add(dedupeKey);
      const totalStr = bucket.total.toFixed(2);
      const oldestIso = bucket.oldestSoldAt.toISOString().slice(0, 10);
      const sellers = [...bucket.sellers];
      const meta = {
        total: bucket.total,
        count: bucket.count,
        oldestSoldAt: oldestIso,
        sellers,
        debtorKind: bucket.kind,
        clientName: bucket.name,
      };
      const source = bucket.kind === 'staff' ? 'STAFF_DEBT' : 'CLIENT_DEBT';
      const title =
        bucket.kind === 'staff'
          ? `Долг сотрудника: ${bucket.name} (${totalStr} BYN)`
          : `Долг клиента: ${bucket.name} (${totalStr} BYN)`;
      const description = `${bucket.count} продаж(и), всего ${totalStr} BYN. Самый старый долг: ${oldestIso}.${sellers.length ? ` Продавцы: ${sellers.join(', ')}.` : ''}`;
      const existing = byDedupe.get(dedupeKey);
      if (existing) {
        await this.prisma.adminTask.update({
          where: { id: existing.id },
          data: {
            title,
            description,
            meta,
            clientExternalId: bucket.clientExternalId,
            dueAt: bucket.oldestSoldAt,
            // Not a SaleTransaction id — debt lines come from ClubRevenue.
            relatedSaleId: null,
          },
        });
        continue;
      }
      toCreate.push({
        clubId,
        assigneeId: null,
        createdById: systemUserId,
        title,
        description,
        dueAt: bucket.oldestSoldAt,
        status: AdminTaskStatus.OPEN,
        source,
        dedupeKey,
        relatedSaleId: null,
        clientExternalId: bucket.clientExternalId,
        meta,
        nextActionAt: now,
      });
    }
    if (toCreate.length) {
      const res = await this.prisma.adminTask.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      created += res.count;
    }

    for (const task of openTasks) {
      if (!task.dedupeKey || seen.has(task.dedupeKey)) continue;
      await this.prisma.adminTask.update({
        where: { id: task.id },
        data: {
          status: AdminTaskStatus.DONE,
          completedAt: new Date(),
          nextActionAt: null,
        },
      });
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId: task.id,
          actorId: systemUserId,
          comment: 'Авто: долг погашен',
        },
      });
    }

    return created;
  }

  private analyticsProvider(): FitgoAnalyticsHttpProvider | null {
    const baseUrl = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim() ?? '';
    const basicAuth =
      this.config.get<string>('FORMA_BASIC_AUTH')?.trim() ?? '';
    if (!baseUrl || !apiKey) return null;
    return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
  }

  /**
   * Per unpaid installment payment due today or earlier.
   * Requires Analytics `scope=installments`.
   */
  private async syncInstallmentPayments(
    clubId: string,
    systemUserId: string,
  ): Promise<number> {
    const provider = this.analyticsProvider();
    if (!provider?.getInstallments) return 0;

    let rows: FitgoInstallmentSale[] = [];
    try {
      rows = (await provider.getInstallments()) ?? [];
    } catch (err) {
      this.logger.warn(
        `Installments scan failed: ${err instanceof Error ? err.message : err}`,
      );
      return 0;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let created = 0;

    const open = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'INSTALLMENT_PAYMENT',
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
      },
    });
    const byDedupe = new Map(
      open.filter((t) => t.dedupeKey).map((t) => [t.dedupeKey as string, t]),
    );
    const seen = new Set<string>();

    for (const row of rows) {
      const payments = row.payments ?? [];
      const totalN = payments.length;
      for (const p of payments) {
        const planAmt = Number(p.planAmount || 0);
        const factAmt = Number(p.factAmount || 0);
        const paid = factAmt >= planAmt && planAmt > 0;
        const planDate = new Date(String(p.planDate).slice(0, 10));
        if (Number.isNaN(planDate.getTime())) continue;
        const dedupeKey = `installment:${row.saleDocumentId}:${p.n}`;
        if (paid) {
          const existing = byDedupe.get(dedupeKey);
          if (existing) {
            await this.prisma.adminTask.update({
              where: { id: existing.id },
              data: {
                status: AdminTaskStatus.DONE,
                completedAt: new Date(),
                nextActionAt: null,
              },
            });
            await this.prisma.adminTaskEvent.create({
              data: {
                taskId: existing.id,
                actorId: systemUserId,
                comment: 'Авто: платёж по рассрочке оплачен',
              },
            });
          }
          continue;
        }
        // Show from plan date onward (not future)
        if (planDate > today) continue;

        seen.add(dedupeKey);
        const name = (row.clientName ?? '').trim() || 'клиент';
        const amountStr = planAmt.toFixed(2);
        const planIso = planDate.toISOString().slice(0, 10);
        const meta = {
          saleDocumentId: row.saleDocumentId,
          number: row.number ?? null,
          soldAt: row.soldAt ?? null,
          templateName: row.templateName ?? null,
          total: row.total ?? null,
          paymentN: p.n,
          paymentTotal: totalN,
          planDate: planIso,
          planAmount: planAmt,
          phone: row.phone ?? null,
          clientName: name,
          payments: JSON.parse(JSON.stringify(payments)),
        } as Prisma.InputJsonValue;
        const title = `Рассрочка: ${name} — платёж ${p.n} из ${totalN} (${amountStr} BYN)`;
        const description = `${row.templateName ?? 'Рассрочка'}${row.number ? ` · №${row.number}` : ''} · план ${planIso}`;
        const existing = byDedupe.get(dedupeKey);
        if (existing) {
          await this.prisma.adminTask.update({
            where: { id: existing.id },
            data: {
              title,
              description,
              meta,
              clientExternalId: row.clientExternalId ?? null,
              dueAt: planDate,
              nextActionAt: planDate,
            },
          });
          continue;
        }
        await this.prisma.adminTask.create({
          data: {
            clubId,
            assigneeId: null,
            createdById: systemUserId,
            title,
            description,
            dueAt: planDate,
            nextActionAt: planDate,
            status: AdminTaskStatus.OPEN,
            source: 'INSTALLMENT_PAYMENT',
            dedupeKey,
            clientExternalId: row.clientExternalId ?? null,
            meta,
          },
        });
        created += 1;
      }
    }

    for (const task of open) {
      if (!task.dedupeKey || seen.has(task.dedupeKey)) continue;
      // Paid or no longer in feed — leave paid closers above; stale unpaid leave open
    }

    return created;
  }

  private termBucket(termDays: number | undefined): TermBucket {
    if (termDays != null && termDays > 0 && termDays <= SHORT_TERM_MAX_DAYS) {
      return 'short';
    }
    return 'long';
  }

  private async syncMembershipRenewals(
    clubId: string,
    _clubExternalId: string | null,
    systemUserId: string,
  ) {
    let created = 0;
    let closedRenewed = 0;
    let closedLost = 0;
    let cancelledOneOff = 0;
    let cancelledGuest = 0;

    const provider = this.fitness.getProvider();
    if (!provider.getExpiringMemberships) {
      this.logger.warn('getExpiringMemberships not available — skip renewals');
      return { created, closedRenewed, closedLost };
    }

    let rows: FitgoExpiringMembershipRow[] = [];
    try {
      rows = await provider.getExpiringMemberships(SCAN_DAYS);
    } catch (err) {
      this.logger.warn(
        `Membership expiry scan failed: ${err instanceof Error ? err.message : err}`,
      );
      return { created, closedRenewed, closedLost };
    }

    // Nest-side filters (old 1C publication may still return one-offs / guests)
    rows = rows.filter(
      (r) => !r.oneOff && !isGuestVisitProductName(r.name),
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDocId = new Map(rows.map((r) => [r.docId, r]));

    const openRenewals = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: 'MEMBERSHIP_EXPIRING',
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
      },
    });

    // Batch coverage for tasks whose membership left the expiring (+lookback) feed
    const coverageItems: Array<{
      externalId: string;
      docId: string;
      validUntil?: string;
    }> = [];
    for (const task of openRenewals) {
      const meta = (task.meta ?? {}) as Record<string, unknown>;
      const docId = typeof meta.docId === 'string' ? meta.docId : null;
      if (!docId || byDocId.has(docId)) continue;
      if (!task.clientExternalId) continue;
      coverageItems.push({
        externalId: task.clientExternalId,
        docId,
        validUntil:
          typeof meta.validUntil === 'string' ? meta.validUntil : undefined,
      });
    }
    const coverageByKey = new Map<string, FitgoRenewalCoverageRow>();
    if (coverageItems.length && provider.getRenewalCoverage) {
      try {
        const coverage = await provider.getRenewalCoverage(coverageItems);
        for (const c of coverage) {
          coverageByKey.set(`${c.externalId}:${c.docId}`, c);
        }
      } catch (err) {
        this.logger.warn(
          `Renewal coverage batch failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    for (const task of openRenewals) {
      const meta = (task.meta ?? {}) as Record<string, unknown>;
      const docId = typeof meta.docId === 'string' ? meta.docId : null;
      const row = docId ? byDocId.get(docId) : undefined;
      let validUntilStr =
        typeof meta.validUntil === 'string' ? meta.validUntil : null;
      const termDays =
        typeof meta.termDays === 'number'
          ? meta.termDays
          : row?.termDays;
      const bucket = this.termBucket(termDays);
      const callLead = CALL_LEAD[bucket];

      // Cancel legacy one-off cases if meta/row says so
      if (meta.oneOff === true || row?.oneOff) {
        await this.prisma.adminTask.update({
          where: { id: task.id },
          data: {
            status: AdminTaskStatus.CANCELLED,
            completedAt: new Date(),
            nextActionAt: null,
          },
        });
        await this.prisma.adminTaskEvent.create({
          data: {
            taskId: task.id,
            actorId: systemUserId,
            stage: task.stage,
            comment: 'Авто: разовый продукт — исключён из продлений',
          },
        });
        cancelledOneOff += 1;
        continue;
      }

      const membershipName =
        (typeof meta.membershipName === 'string' ? meta.membershipName : '') ||
        row?.name ||
        '';
      if (isGuestVisitProductName(membershipName)) {
        await this.prisma.adminTask.update({
          where: { id: task.id },
          data: {
            status: AdminTaskStatus.CANCELLED,
            completedAt: new Date(),
            nextActionAt: null,
          },
        });
        await this.prisma.adminTaskEvent.create({
          data: {
            taskId: task.id,
            actorId: systemUserId,
            stage: task.stage,
            comment: 'Авто: гостевой визит — исключён из задач',
          },
        });
        cancelledGuest += 1;
        continue;
      }

      if (row?.renewed || row?.nextMembership) {
        await this.closeAsRenewed(
          task.id,
          systemUserId,
          row.renewed && !row.nextMembership
            ? 'Авто: абонемент продлён в 1С'
            : 'Авто: куплен следующий абонемент',
        );
        closedRenewed += 1;
        continue;
      }

      // Same doc, later end date in feed (freeze / term shift) — move due, keep open
      if (row?.validUntil && validUntilStr) {
        const liveUntil = row.validUntil.slice(0, 10);
        const taskUntil = validUntilStr.slice(0, 10);
        if (liveUntil > taskUntil) {
          const until = new Date(liveUntil);
          const nextAction = new Date(today);
          const daysLeft = Math.floor(
            (until.getTime() - today.getTime()) / 86400000,
          );
          if (daysLeft > callLead) {
            nextAction.setTime(until.getTime() - callLead * 86400000);
          }
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: {
              meta: { ...meta, validUntil: liveUntil },
              dueAt: until,
              nextActionAt: nextAction,
            },
          });
          validUntilStr = liveUntil;
        }
      }

      // Doc left the scan window — batch coverage (next sold / marked / extended)
      if (!row && docId && task.clientExternalId) {
        const cov = coverageByKey.get(`${task.clientExternalId}:${docId}`);
        if (cov?.covered) {
          await this.closeAsRenewed(
            task.id,
            systemUserId,
            this.renewalCoverageComment(cov.reason),
          );
          closedRenewed += 1;
          continue;
        }
        if (
          cov?.reason === 'extended' &&
          cov.currentValidUntil &&
          validUntilStr &&
          cov.currentValidUntil > validUntilStr.slice(0, 10)
        ) {
          const liveUntil = cov.currentValidUntil.slice(0, 10);
          const until = new Date(liveUntil);
          const nextAction = new Date(today);
          const daysLeft = Math.floor(
            (until.getTime() - today.getTime()) / 86400000,
          );
          if (daysLeft > callLead) {
            nextAction.setTime(until.getTime() - callLead * 86400000);
          }
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: {
              meta: { ...meta, validUntil: liveUntil },
              dueAt: until,
              nextActionAt: nextAction,
            },
          });
          validUntilStr = liveUntil;
        } else if (!cov && provider.getMembership) {
          // Legacy fallback when coverage endpoint not published yet
          try {
            const live = await provider.getMembership(task.clientExternalId);
            const oldUntil = validUntilStr?.slice(0, 10);
            const newUntil = live?.validUntil?.slice(0, 10);
            const newId = live?.id;
            if (
              live &&
              newId &&
              docId &&
              newId !== docId &&
              newUntil &&
              oldUntil &&
              newUntil > oldUntil
            ) {
              await this.closeAsRenewed(
                task.id,
                systemUserId,
                'Авто: новый абонемент в 1С после окончания',
              );
              closedRenewed += 1;
              continue;
            }
          } catch {
            // ignore per-client probe failures
          }
        }
      }

      // T+1 soft follow-up for WILL_RENEW
      if (
        task.stage === 'WILL_RENEW' &&
        validUntilStr &&
        !meta.followupSentAt
      ) {
        const until = new Date(validUntilStr.slice(0, 10));
        const daysPast = (today.getTime() - until.getTime()) / 86400000;
        if (daysPast >= 1) {
          await this.sendFollowupMessage(clubId, task.clientExternalId, meta);
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: {
              meta: { ...meta, followupSentAt: new Date().toISOString() },
            },
          });
        }
      }

      // Auto-close T+7 for ALL open stages (after coverage check)
      if (validUntilStr) {
        const until = new Date(validUntilStr.slice(0, 10));
        const daysPast = (today.getTime() - until.getTime()) / 86400000;
        if (daysPast >= LOST_AFTER_DAYS) {
          const lostReason =
            task.stage === 'WILL_RENEW' ? 'not_renewed' : 'no_contact';
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: {
              stage: 'LOST',
              status: AdminTaskStatus.DONE,
              completedAt: new Date(),
              lostReason,
              nextActionAt: null,
            },
          });
          await this.prisma.adminTaskEvent.create({
            data: {
              taskId: task.id,
              actorId: systemUserId,
              stage: 'LOST',
              comment:
                lostReason === 'not_renewed'
                  ? 'Авто: не продлил (T+7 после «Продлит»)'
                  : 'Авто: не связались (T+7)',
            },
          });
          closedLost += 1;
          continue;
        }
      }

      // Raise NEW to call queue at CALL_LEAD
      if (
        validUntilStr &&
        (task.stage === 'NEW' || !task.stage) &&
        task.stage !== 'WILL_RENEW'
      ) {
        const until = new Date(validUntilStr.slice(0, 10));
        const daysLeft =
          (until.getTime() - today.getTime()) / 86400000;
        if (
          daysLeft <= callLead &&
          (!task.nextActionAt || task.nextActionAt > today)
        ) {
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: { nextActionAt: today },
          });
        }
      }
    }

    for (const row of rows) {
      if (row.renewed || row.nextMembership) continue;
      if (!row.docId || !row.validUntil) continue;

      const bucket = this.termBucket(row.termDays);
      const windowDays = WINDOW[bucket];
      const callLead = CALL_LEAD[bucket];

      const until = new Date(row.validUntil.slice(0, 10));
      const daysLeft = Math.floor(
        (until.getTime() - today.getTime()) / 86400000,
      );
      if (daysLeft < 0 || daysLeft > windowDays) continue;

      const dedupeKey = `membership:${row.docId}`;
      const existing = await this.prisma.adminTask.findUnique({
        where: { clubId_dedupeKey: { clubId, dedupeKey } },
      });
      if (existing) {
        if (
          existing.status === AdminTaskStatus.DONE ||
          existing.status === AdminTaskStatus.CANCELLED
        ) {
          continue;
        }
        const prevMeta = (existing.meta ?? {}) as Record<string, unknown>;
        await this.prisma.adminTask.update({
          where: { id: existing.id },
          data: {
            meta: {
              ...this.membershipMeta(row),
              pushSentAt: prevMeta.pushSentAt ?? null,
              followupSentAt: prevMeta.followupSentAt ?? null,
            },
            clientExternalId: row.externalId,
            dueAt: until,
          },
        });
        continue;
      }

      const name =
        `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim() || 'клиент';
      const nextAction = new Date(today);
      if (daysLeft > callLead) {
        nextAction.setTime(until.getTime() - callLead * 86400000);
      }

      const meta = this.membershipMeta(row);
      const task = await this.prisma.adminTask.create({
        data: {
          clubId,
          assigneeId: null,
          createdById: systemUserId,
          title: `Абонемент истекает: ${name}`,
          description: `${row.name ?? 'Абонемент'} до ${row.validUntil.slice(0, 10)} (окно ${windowDays} дн.).`,
          dueAt: until,
          status: AdminTaskStatus.OPEN,
          source: 'MEMBERSHIP_EXPIRING',
          dedupeKey,
          clientExternalId: row.externalId,
          stage: 'NEW',
          nextActionAt: nextAction,
          attempts: 0,
          meta,
        },
      });
      await this.prisma.adminTaskEvent.create({
        data: {
          taskId: task.id,
          actorId: systemUserId,
          stage: 'NEW',
          comment: 'Создано автоматически',
        },
      });
      created += 1;

      // Soft push once when case is created (within its window)
      await this.sendRenewalPush(clubId, row);
      await this.prisma.adminTask.update({
        where: { id: task.id },
        data: {
          meta: {
            ...meta,
            pushSentAt: new Date().toISOString(),
          },
        },
      });
    }

    if (cancelledOneOff > 0 || cancelledGuest > 0) {
      this.logger.log(
        `Club ${clubId}: cancelled renewals oneOff=${cancelledOneOff} guest=${cancelledGuest}`,
      );
    }

    return { created, closedRenewed, closedLost };
  }

  private membershipMeta(row: FitgoExpiringMembershipRow) {
    return {
      docId: row.docId,
      membershipName: row.name,
      validUntil: row.validUntil.slice(0, 10),
      validFrom: row.validFrom?.slice(0, 10),
      phone: row.phone ?? null,
      firstName: row.firstName,
      lastName: row.lastName,
      visitsRemaining: row.visitsRemaining ?? null,
      kind: row.kind ?? 'membership',
      termDays: row.termDays ?? null,
      totalUnits: row.totalUnits ?? null,
      oneOff: false,
    };
  }

  private renewalCoverageComment(reason: string | undefined): string {
    if (reason === 'marked') return 'Авто: абонемент продлён в 1С';
    if (reason === 'next_sold' || reason === 'next_active') {
      return 'Авто: куплен следующий абонемент';
    }
    return 'Авто: куплен следующий абонемент';
  }

  private async closeAsRenewed(
    taskId: string,
    actorId: string,
    comment: string,
  ) {
    await this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        stage: 'RENEWED',
        status: AdminTaskStatus.DONE,
        completedAt: new Date(),
        nextActionAt: null,
      },
    });
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId,
        actorId,
        stage: 'RENEWED',
        comment,
      },
    });
  }

  private async sendRenewalPush(
    clubId: string,
    row: FitgoExpiringMembershipRow,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        clubId,
        externalId: row.externalId,
        roles: { some: { role: Role.CLIENT } },
        isActive: true,
      },
      select: { id: true },
    });
    if (!user) return;
    const until = row.validUntil.slice(0, 10);
    try {
      await this.notifications.sendReminderToClient(
        user.id,
        `Ваш абонемент «${row.name}» действует до ${until}. Продлите в приложении, чтобы не прерывать занятия.`,
      );
    } catch (err) {
      this.logger.warn(
        `Renewal push failed for ${row.externalId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async sendFollowupMessage(
    clubId: string,
    clientExternalId: string | null,
    meta: Record<string, unknown>,
  ) {
    if (!clientExternalId) return;
    const user = await this.prisma.user.findFirst({
      where: {
        clubId,
        externalId: clientExternalId,
        roles: { some: { role: Role.CLIENT } },
        isActive: true,
      },
      select: { id: true },
    });
    if (!user) return;
    const name =
      typeof meta.membershipName === 'string'
        ? meta.membershipName
        : 'абонемент';
    try {
      await this.notifications.sendReminderToClient(
        user.id,
        `Напоминаем: можно продлить «${name}» в приложении или на ресепшене клуба.`,
      );
    } catch (err) {
      this.logger.warn(
        `Renewal follow-up failed for ${clientExternalId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Soft message after first no-answer (used by AdminService). */
  async sendNoAnswerMessage(
    clubId: string,
    clientExternalId: string | null | undefined,
  ) {
    if (!clientExternalId) return;
    const user = await this.prisma.user.findFirst({
      where: {
        clubId,
        externalId: clientExternalId,
        roles: { some: { role: Role.CLIENT } },
        isActive: true,
      },
      select: { id: true },
    });
    if (!user) return;
    try {
      await this.notifications.sendReminderToClient(
        user.id,
        'Мы звонили по поводу продления абонемента. Ответьте в приложении или перезвоните в клуб.',
      );
    } catch {
      // ignore
    }
  }
}

export {
  MAX_CALL_ATTEMPTS,
  MAX_NO_ANSWER,
  MEMBERSHIP_DAYS,
  SCAN_DAYS,
  NO_ANSWER_RETRY_DAYS,
  WINDOW,
  CALL_LEAD,
  SHORT_TERM_MAX_DAYS,
};
