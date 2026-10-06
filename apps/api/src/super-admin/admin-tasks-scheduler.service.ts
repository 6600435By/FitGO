import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminTaskStatus, Role } from '@prisma/client';
import type { FitgoExpiringMembershipRow } from '@fitgo/1c-adapter';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { localDayKey } from '../club-schedule/trainer-schedule.helpers';

const DEBT_DAYS = 7;
const SCAN_DAYS = 14;
const SHORT_TERM_MAX_DAYS = 31;
const WINDOW = { short: 7, long: 14 } as const;
const CALL_LEAD = { short: 3, long: 7 } as const;
const MAX_NO_ANSWER = 2;
const NO_ANSWER_RETRY_DAYS = 2;
const LOST_AFTER_DAYS = 7;
const REFRESH_MIN_MS = 30 * 60 * 1000;

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

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
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

    const debtCreated = await this.generateDebtTasks(
      clubId,
      systemUser.id,
      dayKey,
    );
    const membership = await this.syncMembershipRenewals(
      clubId,
      clubExternalId,
      systemUser.id,
    );

    this.logger.log(
      `Club ${clubId}: debt +${debtCreated}, membership +${membership.created}, renewed ${membership.closedRenewed}, lost ${membership.closedLost}`,
    );
    return {
      debt: debtCreated,
      membership: membership.created,
      closedRenewed: membership.closedRenewed,
      closedLost: membership.closedLost,
    };
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

  private async generateDebtTasks(
    clubId: string,
    systemUserId: string,
    dayKey: string,
  ) {
    let debtCreated = 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DEBT_DAYS);

    const unpaid = await this.prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        paidAt: null,
        soldAt: { lte: cutoff },
        employeeExternalId: { not: null },
      },
      take: 200,
      orderBy: { soldAt: 'asc' },
    });

    for (const sale of unpaid) {
      const code = sale.employeeExternalId?.trim();
      if (!code) continue;
      const seller = await this.prisma.user.findFirst({
        where: {
          clubId,
          OR: [{ employeeCode: code }, { externalId: code }],
          roles: { some: { role: Role.ADMIN } },
          isActive: true,
        },
        select: { id: true },
      });
      if (!seller) continue;

      const dedupeKey = `debt:${sale.externalSaleId}:${dayKey.slice(0, 7)}`;
      const existing = await this.prisma.adminTask.findUnique({
        where: { clubId_dedupeKey: { clubId, dedupeKey } },
      });
      if (existing) continue;

      const amount = Number(sale.amount || 0).toFixed(2);
      const staffDebt = /\(\s*сотрудник\s*\)/i.test(sale.clientName ?? '');
      await this.prisma.adminTask.create({
        data: {
          clubId,
          assigneeId: seller.id,
          createdById: systemUserId,
          title: staffDebt
            ? `Долг сотрудника: ${sale.clientName ?? 'сотрудник'} (${amount} BYN)`
            : `Долг клиента: ${sale.clientName ?? 'клиент'} (${amount} BYN)`,
          description: `Неоплаченная продажа старше ${DEBT_DAYS} дн. ${sale.productName ?? sale.saleType}. Дата продажи: ${sale.soldAt.toISOString().slice(0, 10)}.`,
          dueAt: new Date(),
          status: AdminTaskStatus.OPEN,
          source: staffDebt ? 'STAFF_DEBT' : 'DEBT_OVERDUE',
          dedupeKey,
          relatedSaleId: sale.id,
          relatedUserId: seller.id,
        },
      });
      debtCreated += 1;
    }
    return debtCreated;
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

    // Nest-side oneOff filter (old 1C publication may still return them)
    rows = rows.filter((r) => !r.oneOff);

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

    for (const task of openRenewals) {
      const meta = (task.meta ?? {}) as Record<string, unknown>;
      const docId = typeof meta.docId === 'string' ? meta.docId : null;
      const row = docId ? byDocId.get(docId) : undefined;
      const validUntilStr =
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

      if (row?.nextMembership) {
        await this.closeAsRenewed(
          task.id,
          systemUserId,
          'Авто: куплен следующий абонемент',
        );
        closedRenewed += 1;
        continue;
      }

      // Doc left the 14-day window — check live membership for renewal after expiry
      if (!row && task.clientExternalId && provider.getMembership) {
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

      // Auto-close T+7 for ALL open stages
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
      if (row.nextMembership) continue;
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

    if (cancelledOneOff > 0) {
      this.logger.log(
        `Club ${clubId}: cancelled ${cancelledOneOff} one-off renewal tasks`,
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
