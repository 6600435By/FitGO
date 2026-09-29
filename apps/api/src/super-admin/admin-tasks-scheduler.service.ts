import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminTaskStatus, Role } from '@prisma/client';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

const DEBT_DAYS = 7;
const MEMBERSHIP_DAYS = 7;

@Injectable()
export class AdminTasksSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AdminTasksSchedulerService.name);
  private lastDayKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_ADMIN_TASKS_CRON') === 'false') return;
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    if (now.getHours() < 3) return;
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
      return { debt: 0, membership: 0 };
    }

    let debtCreated = 0;
    let membershipCreated = 0;

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
          createdById: systemUser.id,
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

    const defaultAdmin = await this.prisma.user.findFirst({
      where: {
        clubId,
        roles: { some: { role: Role.ADMIN } },
        isActive: true,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const provider = this.fitness.getProvider();
    if (
      defaultAdmin &&
      clubExternalId &&
      provider.getAllClientsMemberships
    ) {
      try {
        const rows = await provider.getAllClientsMemberships(clubExternalId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const row of rows ?? []) {
          if (!row.validUntil) continue;
          const until = new Date(row.validUntil);
          const days =
            (until.getTime() - today.getTime()) / 86400000;
          if (days < 0 || days > MEMBERSHIP_DAYS) continue;
          const ext = row.externalId?.trim();
          if (!ext) continue;
          const dedupeKey = `membership:${ext}:${dayKey.slice(0, 7)}`;
          const existing = await this.prisma.adminTask.findUnique({
            where: { clubId_dedupeKey: { clubId, dedupeKey } },
          });
          if (existing) continue;
          const name =
            `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim() ||
            'клиент';
          await this.prisma.adminTask.create({
            data: {
              clubId,
              assigneeId: defaultAdmin.id,
              createdById: systemUser.id,
              title: `Абонемент истекает: ${name}`,
              description: `${row.membershipName ?? 'Абонемент'} до ${row.validUntil.slice(0, 10)} (≤${MEMBERSHIP_DAYS} дн.).`,
              dueAt: until,
              status: AdminTaskStatus.OPEN,
              source: 'MEMBERSHIP_EXPIRING',
              dedupeKey,
              relatedUserId: null,
            },
          });
          membershipCreated += 1;
        }
      } catch (err) {
        this.logger.warn(
          `Membership expiry scan failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `Club ${clubId}: debt tasks +${debtCreated}, membership +${membershipCreated}`,
    );
    return { debt: debtCreated, membership: membershipCreated };
  }
}
