import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminTaskStatus, Role } from '@prisma/client';
import type { FitgoExpiringMembershipRow } from '@fitgo/1c-adapter';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const DEBT_DAYS = 7;
const MEMBERSHIP_DAYS = 14;
const LOST_AFTER_DAYS = 7;
const MAX_CALL_ATTEMPTS = 3;

@Injectable()
export class AdminTasksSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AdminTasksSchedulerService.name);
  private lastDayKey = '';

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
    // Night window only — daytime API restart must not re-fire (in-memory lastDayKey).
    if (now.getHours() < 3 || now.getHours() >= 5) return;
    const dayKey = now.toISOString().slice(0, 10);
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
    dayKey = new Date().toISOString().slice(0, 10),
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

    const debtCreated = await this.generateDebtTasks(clubId, systemUser.id, dayKey);
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

  /** Public refresh used by admin dashboard / tasks UI. */
  async refreshMembershipRenewals(clubId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, externalId: true },
    });
    if (!club) return { created: 0, closedRenewed: 0, closedLost: 0 };

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

    if (!systemUser) return { created: 0, closedRenewed: 0, closedLost: 0 };
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

  private async syncMembershipRenewals(
    clubId: string,
    _clubExternalId: string | null,
    systemUserId: string,
  ) {
    let created = 0;
    let closedRenewed = 0;
    let closedLost = 0;

    const provider = this.fitness.getProvider();
    if (!provider.getExpiringMemberships) {
      this.logger.warn('getExpiringMemberships not available — skip renewals');
      return { created, closedRenewed, closedLost };
    }

    let rows: FitgoExpiringMembershipRow[] = [];
    try {
      rows = await provider.getExpiringMemberships(MEMBERSHIP_DAYS);
    } catch (err) {
      this.logger.warn(
        `Membership expiry scan failed: ${err instanceof Error ? err.message : err}`,
      );
      return { created, closedRenewed, closedLost };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDocId = new Map(rows.map((r) => [r.docId, r]));

    // Close open cases when 1C shows nextMembership (auto-renewed).
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

      if (row?.nextMembership) {
        await this.closeAsRenewed(task.id, systemUserId, 'Авто: куплен следующий абонемент');
        closedRenewed += 1;
        continue;
      }

      // Auto-lost T+7 after validUntil if still open and not will-renew recently worked
      const validUntilStr =
        typeof meta.validUntil === 'string' ? meta.validUntil : null;
      if (validUntilStr) {
        const until = new Date(validUntilStr.slice(0, 10));
        const daysPast =
          (today.getTime() - until.getTime()) / 86400000;
        if (
          daysPast >= LOST_AFTER_DAYS &&
          task.stage !== 'WILL_RENEW' &&
          task.stage !== 'THINKING'
        ) {
          await this.prisma.adminTask.update({
            where: { id: task.id },
            data: {
              stage: 'LOST',
              status: AdminTaskStatus.DONE,
              completedAt: new Date(),
              lostReason: 'no_contact',
            },
          });
          await this.prisma.adminTaskEvent.create({
            data: {
              taskId: task.id,
              actorId: systemUserId,
              stage: 'LOST',
              comment: 'Авто: не связались (T+7)',
            },
          });
          closedLost += 1;
          continue;
        }
      }

      // Raise to call queue at T-7 if still NEW
      if (validUntilStr && (task.stage === 'NEW' || !task.stage)) {
        const until = new Date(validUntilStr.slice(0, 10));
        const daysLeft =
          (until.getTime() - today.getTime()) / 86400000;
        if (daysLeft <= 7 && (!task.nextActionAt || task.nextActionAt > today)) {
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

      const dedupeKey = `membership:${row.docId}`;
      const existing = await this.prisma.adminTask.findUnique({
        where: { clubId_dedupeKey: { clubId, dedupeKey } },
      });
      if (existing) {
        // Refresh meta / reopen if previously lost but still in window without next
        if (
          existing.status === AdminTaskStatus.DONE &&
          existing.stage === 'LOST' &&
          existing.lostReason === 'no_contact'
        ) {
          // leave closed
        } else if (
          existing.status === AdminTaskStatus.DONE &&
          existing.stage === 'RENEWED'
        ) {
          // leave closed
        } else {
          await this.prisma.adminTask.update({
            where: { id: existing.id },
            data: {
              meta: this.membershipMeta(row),
              clientExternalId: row.externalId,
              dueAt: new Date(row.validUntil.slice(0, 10)),
            },
          });
        }
        continue;
      }

      const name =
        `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim() || 'клиент';
      const until = new Date(row.validUntil.slice(0, 10));
      const daysLeft = Math.floor(
        (until.getTime() - today.getTime()) / 86400000,
      );
      // T-14: nextActionAt = due in 7 days (call starts at T-7); or today if already ≤7
      const nextAction = new Date(today);
      if (daysLeft > 7) {
        nextAction.setDate(until.getDate() - 7);
        // fix month overflow
        nextAction.setTime(until.getTime() - 7 * 86400000);
      }

      const task = await this.prisma.adminTask.create({
        data: {
          clubId,
          assigneeId: null,
          createdById: systemUserId,
          title: `Абонемент истекает: ${name}`,
          description: `${row.name ?? 'Абонемент'} до ${row.validUntil.slice(0, 10)} (≤${MEMBERSHIP_DAYS} дн.).`,
          dueAt: until,
          status: AdminTaskStatus.OPEN,
          source: 'MEMBERSHIP_EXPIRING',
          dedupeKey,
          clientExternalId: row.externalId,
          stage: 'NEW',
          nextActionAt: nextAction,
          attempts: 0,
          meta: this.membershipMeta(row),
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

      // Soft push once at T-14 (when daysLeft is near 14 or first create)
      if (daysLeft >= 12) {
        await this.sendRenewalPush(clubId, row);
        await this.prisma.adminTask.update({
          where: { id: task.id },
          data: {
            meta: {
              ...this.membershipMeta(row),
              pushSentAt: new Date().toISOString(),
            },
          },
        });
      }
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
}

export { MAX_CALL_ATTEMPTS, MEMBERSHIP_DAYS };
