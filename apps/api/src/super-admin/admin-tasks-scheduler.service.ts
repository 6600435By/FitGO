import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminTaskStatus, Prisma, Role } from '@prisma/client';
import {
  FitgoAnalyticsHttpProvider,
  type FitgoExpiringMembershipRow,
  type FitgoInstallmentSale,
} from '@fitgo/1c-adapter';
import { isCollectibleClientDebt } from '../admin-sales/club-revenue-debt';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { localDayKey } from '../club-schedule/trainer-schedule.helpers';

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

    this.logger.log(
      `Club ${clubId}: debt +${debtCreated}, installment +${installment}, membership +${membership.created}, renewed ${membership.closedRenewed}, lost ${membership.closedLost}`,
    );
    return {
      debt: debtCreated,
      installment,
      membership: membership.created,
      closedRenewed: membership.closedRenewed,
      closedLost: membership.closedLost,
    };
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
      const staffDebt = /\(\s*сотрудник\s*\)/i.test(row.clientName ?? '');
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
