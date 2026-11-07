import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PersonalBookingStatus,
  TrainerOwnPackageStatus,
  TrainerPaymentKind,
  TrainerPaymentMethod,
} from '@prisma/client';
import type {
  TrainerClientPackageView,
  TrainerClientPaymentView,
  TrainerLedgerClientSnapshot,
  TrainerLedgerDebtor,
  TrainerLedgerOverview,
  TrainerOwnPackageTemplate,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { decidePersonalSessionSettle } from './personal-package-debit.rules';
import { canChoosePtFlow } from './pt-flow.util';

function clientName(u: { firstName: string; lastName: string }) {
  return `${u.lastName} ${u.firstName}`.trim();
}

function monthBounds(d = new Date()) {
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { from, to };
}

@Injectable()
export class TrainerLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  private async requireClubTrainer(user: JwtPayload) {
    const trainer = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        clubId: true,
        trainerClub: true,
        trainerStaff: true,
        staffProfile: { select: { defaultSessionPriceMinor: true } },
      },
    });
    if (!trainer?.trainerClub) {
      throw new ForbiddenException('Раздел «Мои оплаты» только для «Тренер клуб»');
    }
    return trainer;
  }

  async overview(user: JwtPayload): Promise<TrainerLedgerOverview> {
    const trainer = await this.requireClubTrainer(user);
    const { from, to } = monthBounds();

    const [paymentsMonth, paymentsAll, balances, activePackages, templates, clubDebt] =
      await Promise.all([
        this.prisma.trainerClientPayment.findMany({
          where: {
            trainerId: trainer.id,
            paidAt: { gte: from, lte: to },
          },
          include: {
            client: { select: { firstName: true, lastName: true } },
          },
          orderBy: { paidAt: 'desc' },
        }),
        this.prisma.trainerClientPayment.aggregate({
          where: { trainerId: trainer.id },
          _sum: { amountMinor: true },
        }),
        this.prisma.trainerClientBalance.findMany({
          where: { trainerId: trainer.id, debtMinor: { gt: 0 } },
          include: {
            client: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { debtMinor: 'desc' },
        }),
        this.prisma.trainerClientPackage.findMany({
          where: {
            trainerId: trainer.id,
            status: TrainerOwnPackageStatus.ACTIVE,
            sessionsRemaining: { gt: 0 },
          },
          include: {
            client: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        this.prisma.trainerOwnPackage.findMany({
          where: { trainerId: trainer.id },
          orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
        }),
        trainer.clubId
          ? this.payroll.resolveStaffClientDebt(trainer.clubId, trainer.id)
          : Promise.resolve({ amountMinor: 0 }),
      ]);

    const monthEarnedMinor = paymentsMonth.reduce(
      (s, p) => s + p.amountMinor,
      0,
    );
    const allTimeEarnedMinor = paymentsAll._sum.amountMinor ?? 0;
    const debtorsTotalMinor = balances.reduce((s, b) => s + b.debtMinor, 0);

    const packageByClient = new Map(
      activePackages.map((p) => [p.clientId, p] as const),
    );

    const debtors: TrainerLedgerDebtor[] = balances.map((b) => {
      const pkg = packageByClient.get(b.clientId);
      return {
        clientId: b.clientId,
        clientName: clientName(b.client),
        debtMinor: b.debtMinor,
        activePackage: pkg
          ? {
              id: pkg.id,
              title: pkg.title,
              sessionsRemaining: pkg.sessionsRemaining,
              validUntil: pkg.validUntil?.toISOString() ?? null,
            }
          : null,
      };
    });

    const expectedMinor =
      debtorsTotalMinor +
      activePackages.reduce(
        (s, p) => s + Math.max(0, p.priceMinor - p.paidMinor),
        0,
      );

    const recentPayments: TrainerClientPaymentView[] = paymentsMonth
      .slice(0, 30)
      .map((p) => this.mapPayment(p));

    const mappedTemplates: TrainerOwnPackageTemplate[] = templates.map((t) => ({
      id: t.id,
      title: t.title,
      sessionsCount: t.sessionsCount,
      priceMinor: t.priceMinor,
      validityDays: t.validityDays,
      isActive: t.isActive,
    }));

    return {
      monthEarnedMinor,
      allTimeEarnedMinor,
      expectedMinor,
      debtorsCount: debtors.length,
      debtorsTotalMinor,
      activePackagesCount: activePackages.length,
      defaultSessionPriceMinor:
        trainer.staffProfile?.defaultSessionPriceMinor ?? null,
      clubDebtMinor: clubDebt.amountMinor ?? 0,
      debtors,
      recentPayments,
      templates: mappedTemplates,
      canChoosePtFlow: canChoosePtFlow(trainer),
    };
  }

  async listTemplates(user: JwtPayload): Promise<TrainerOwnPackageTemplate[]> {
    const trainer = await this.requireClubTrainer(user);
    const rows = await this.prisma.trainerOwnPackage.findMany({
      where: { trainerId: trainer.id },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      sessionsCount: t.sessionsCount,
      priceMinor: t.priceMinor,
      validityDays: t.validityDays,
      isActive: t.isActive,
    }));
  }

  async upsertTemplate(
    user: JwtPayload,
    data: {
      id?: string;
      title: string;
      sessionsCount: number;
      priceMinor: number;
      validityDays?: number | null;
      isActive?: boolean;
    },
  ): Promise<TrainerOwnPackageTemplate> {
    const trainer = await this.requireClubTrainer(user);
    if (!data.title.trim()) {
      throw new BadRequestException('Укажите название пакета');
    }
    if (data.sessionsCount < 1) {
      throw new BadRequestException('Количество тренировок ≥ 1');
    }
    if (data.priceMinor < 0) {
      throw new BadRequestException('Цена не может быть отрицательной');
    }

    let row;
    if (data.id) {
      const existing = await this.prisma.trainerOwnPackage.findFirst({
        where: { id: data.id, trainerId: trainer.id },
      });
      if (!existing) throw new NotFoundException('Шаблон не найден');
      row = await this.prisma.trainerOwnPackage.update({
        where: { id: existing.id },
        data: {
          title: data.title.trim(),
          sessionsCount: data.sessionsCount,
          priceMinor: data.priceMinor,
          validityDays: data.validityDays ?? null,
          isActive: data.isActive ?? true,
        },
      });
    } else {
      row = await this.prisma.trainerOwnPackage.create({
        data: {
          trainerId: trainer.id,
          title: data.title.trim(),
          sessionsCount: data.sessionsCount,
          priceMinor: data.priceMinor,
          validityDays: data.validityDays ?? null,
          isActive: data.isActive ?? true,
        },
      });
    }

    return {
      id: row.id,
      title: row.title,
      sessionsCount: row.sessionsCount,
      priceMinor: row.priceMinor,
      validityDays: row.validityDays,
      isActive: row.isActive,
    };
  }

  async setDefaultSessionPrice(user: JwtPayload, priceMinor: number | null) {
    const trainer = await this.requireClubTrainer(user);
    if (priceMinor != null && priceMinor < 0) {
      throw new BadRequestException('Цена не может быть отрицательной');
    }
    await this.prisma.staffProfile.upsert({
      where: { userId: trainer.id },
      create: {
        userId: trainer.id,
        defaultSessionPriceMinor: priceMinor,
      },
      update: { defaultSessionPriceMinor: priceMinor },
    });
    return { defaultSessionPriceMinor: priceMinor };
  }

  async sellPackage(
    user: JwtPayload,
    data: {
      clientId: string;
      templateId?: string;
      title?: string;
      sessionsCount?: number;
      priceMinor?: number;
      validityDays?: number | null;
      paidMinor?: number;
      method?: TrainerPaymentMethod;
      comment?: string;
    },
  ): Promise<TrainerClientPackageView> {
    const trainer = await this.requireClubTrainer(user);
    await this.assertRosterClient(trainer.id, data.clientId);

    let title = data.title?.trim();
    let sessionsCount = data.sessionsCount;
    let priceMinor = data.priceMinor;
    let validityDays = data.validityDays;

    if (data.templateId) {
      const tpl = await this.prisma.trainerOwnPackage.findFirst({
        where: { id: data.templateId, trainerId: trainer.id, isActive: true },
      });
      if (!tpl) throw new NotFoundException('Шаблон пакета не найден');
      title = title || tpl.title;
      sessionsCount = sessionsCount ?? tpl.sessionsCount;
      priceMinor = priceMinor ?? tpl.priceMinor;
      validityDays =
        validityDays !== undefined ? validityDays : tpl.validityDays;
    }

    if (!title || !sessionsCount || priceMinor == null) {
      throw new BadRequestException('Нужны название, число тренировок и цена');
    }
    if (sessionsCount < 1) {
      throw new BadRequestException('Количество тренировок ≥ 1');
    }

    const paidMinor = Math.max(0, data.paidMinor ?? priceMinor);
    const validUntil =
      validityDays && validityDays > 0
        ? new Date(Date.now() + validityDays * 86_400_000)
        : null;

    const client = await this.prisma.user.findUniqueOrThrow({
      where: { id: data.clientId },
      select: { firstName: true, lastName: true },
    });

    const pkg = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trainerClientPackage.create({
        data: {
          trainerId: trainer.id,
          clientId: data.clientId,
          ...(data.templateId ? { templateId: data.templateId } : {}),
          title,
          sessionsTotal: sessionsCount!,
          sessionsRemaining: sessionsCount!,
          priceMinor: priceMinor!,
          paidMinor,
          validUntil,
          status: TrainerOwnPackageStatus.ACTIVE,
        },
      });

      if (paidMinor > 0) {
        await tx.trainerClientPayment.create({
          data: {
            trainerId: trainer.id,
            clientId: data.clientId,
            amountMinor: paidMinor,
            method: data.method ?? TrainerPaymentMethod.CASH,
            kind: TrainerPaymentKind.PACKAGE_SALE,
            comment: data.comment,
            packageId: created.id,
          },
        });
      }

      return created;
    });

    return {
      id: pkg.id,
      clientId: pkg.clientId,
      clientName: clientName(client),
      title: pkg.title,
      sessionsTotal: pkg.sessionsTotal,
      sessionsRemaining: pkg.sessionsRemaining,
      priceMinor: pkg.priceMinor,
      paidMinor: pkg.paidMinor,
      validUntil: pkg.validUntil?.toISOString() ?? null,
      status: pkg.status,
      soldAt: pkg.soldAt.toISOString(),
    };
  }

  async recordPayment(
    user: JwtPayload,
    data: {
      clientId: string;
      amountMinor: number;
      method: TrainerPaymentMethod;
      kind?: TrainerPaymentKind;
      comment?: string;
      packageId?: string;
      bookingId?: string;
      applyToDebt?: boolean;
    },
  ): Promise<TrainerClientPaymentView> {
    const trainer = await this.requireClubTrainer(user);
    await this.assertRosterClient(trainer.id, data.clientId);
    if (data.amountMinor <= 0) {
      throw new BadRequestException('Сумма должна быть больше 0');
    }

    const client = await this.prisma.user.findUniqueOrThrow({
      where: { id: data.clientId },
      select: { firstName: true, lastName: true },
    });

    const kind =
      data.kind ??
      (data.applyToDebt
        ? TrainerPaymentKind.DEBT_PAYMENT
        : data.packageId
          ? TrainerPaymentKind.PACKAGE_SALE
          : TrainerPaymentKind.OTHER);

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trainerClientPayment.create({
        data: {
          trainerId: trainer.id,
          clientId: data.clientId,
          amountMinor: data.amountMinor,
          method: data.method,
          kind,
          comment: data.comment,
          packageId: data.packageId,
          bookingId: data.bookingId,
        },
        include: {
          client: { select: { firstName: true, lastName: true } },
        },
      });

      if (data.applyToDebt !== false && kind === TrainerPaymentKind.DEBT_PAYMENT) {
        const bal = await tx.trainerClientBalance.findUnique({
          where: {
            trainerId_clientId: {
              trainerId: trainer.id,
              clientId: data.clientId,
            },
          },
        });
        if (bal && bal.debtMinor > 0) {
          await tx.trainerClientBalance.update({
            where: { id: bal.id },
            data: {
              debtMinor: Math.max(0, bal.debtMinor - data.amountMinor),
            },
          });
        }
      }

      if (data.packageId && kind === TrainerPaymentKind.PACKAGE_SALE) {
        await tx.trainerClientPackage.updateMany({
          where: {
            id: data.packageId,
            trainerId: trainer.id,
          },
          data: { paidMinor: { increment: data.amountMinor } },
        });
      }

      return created;
    });

    return this.mapPayment({ ...payment, client });
  }

  async clientSnapshot(
    user: JwtPayload,
    clientId: string,
  ): Promise<TrainerLedgerClientSnapshot> {
    const trainer = await this.requireClubTrainer(user);
    await this.assertRosterClient(trainer.id, clientId);

    const client = await this.prisma.user.findUniqueOrThrow({
      where: { id: clientId },
      select: { firstName: true, lastName: true },
    });

    const [balance, packages, payments] = await Promise.all([
      this.prisma.trainerClientBalance.findUnique({
        where: {
          trainerId_clientId: { trainerId: trainer.id, clientId },
        },
      }),
      this.prisma.trainerClientPackage.findMany({
        where: { trainerId: trainer.id, clientId },
        orderBy: { soldAt: 'desc' },
      }),
      this.prisma.trainerClientPayment.findMany({
        where: { trainerId: trainer.id, clientId },
        include: {
          client: { select: { firstName: true, lastName: true } },
        },
        orderBy: { paidAt: 'desc' },
        take: 50,
      }),
    ]);

    const mappedPkgs = packages.map((p) =>
      this.mapPackage(p, clientName(client)),
    );
    const activePackage =
      mappedPkgs.find(
        (p) => p.status === 'ACTIVE' && p.sessionsRemaining > 0,
      ) ?? null;

    return {
      clientId,
      clientName: clientName(client),
      debtMinor: balance?.debtMinor ?? 0,
      activePackage,
      packages: mappedPkgs,
      payments: payments.map((p) => this.mapPayment(p)),
    };
  }

  /**
   * After PERSONAL PT completion: debit active package or raise client debt.
   * Idempotent via booking.ledgerSettledAt.
   */
  async settlePersonalSession(bookingId: string) {
    const booking = await this.prisma.personalTrainingBooking.findUnique({
      where: { id: bookingId },
      include: {
        trainer: {
          select: {
            id: true,
            trainerClub: true,
            trainerStaff: true,
            staffProfile: { select: { defaultSessionPriceMinor: true } },
          },
        },
      },
    });
    if (!booking) return null;

    const precheck = decidePersonalSessionSettle({
      booking,
      activePackage: null,
      defaultSessionPriceMinor:
        booking.trainer.staffProfile?.defaultSessionPriceMinor ?? null,
    });
    if (precheck.action === 'skip') {
      return precheck.reason === 'already_settled' ? booking : null;
    }
    if (precheck.action === 'mark_complimentary') {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { ledgerSettledAt: new Date() },
      });
      return booking;
    }

    const active = await this.prisma.trainerClientPackage.findFirst({
      where: {
        trainerId: booking.trainerId,
        clientId: booking.clientId,
        status: TrainerOwnPackageStatus.ACTIVE,
        sessionsRemaining: { gt: 0 },
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
      orderBy: [{ validUntil: 'asc' }, { soldAt: 'asc' }],
    });

    const decision = decidePersonalSessionSettle({
      booking,
      activePackage: active
        ? {
            id: active.id,
            sessionsRemaining: active.sessionsRemaining,
            status: active.status,
            validUntil: active.validUntil,
          }
        : null,
      defaultSessionPriceMinor:
        booking.trainer.staffProfile?.defaultSessionPriceMinor ?? null,
    });

    if (decision.action === 'skip') {
      return decision.reason === 'already_settled' ? booking : null;
    }

    if (decision.action === 'mark_complimentary') {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { ledgerSettledAt: new Date() },
      });
      return booking;
    }

    if (decision.action === 'debit_package') {
      await this.prisma.$transaction([
        this.prisma.trainerClientPackage.update({
          where: { id: decision.packageId },
          data: {
            sessionsRemaining: decision.remaining,
            status: decision.exhausted
              ? TrainerOwnPackageStatus.EXHAUSTED
              : TrainerOwnPackageStatus.ACTIVE,
          },
        }),
        this.prisma.personalTrainingBooking.update({
          where: { id: bookingId },
          data: {
            ledgerPackageId: decision.packageId,
            ledgerSettledAt: new Date(),
            paymentStatus: 'PAID',
            payKind: 'BLOCK',
          },
        }),
      ]);
      return booking;
    }

    if (decision.action === 'raise_debt') {
      const price = decision.priceMinor;
      await this.prisma.$transaction(async (tx) => {
        await tx.trainerClientBalance.upsert({
          where: {
            trainerId_clientId: {
              trainerId: booking.trainerId,
              clientId: booking.clientId,
            },
          },
          create: {
            trainerId: booking.trainerId,
            clientId: booking.clientId,
            debtMinor: price,
          },
          update: { debtMinor: { increment: price } },
        });
        await tx.personalTrainingBooking.update({
          where: { id: bookingId },
          data: {
            ledgerSettledAt: new Date(),
            paymentStatus: 'DEBT',
            priceMinor: price,
            payKind: 'PAID',
          },
        });
      });
      return booking;
    }

    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: { ledgerSettledAt: new Date() },
    });
    return booking;
  }

  /** Lightweight snapshot for CRM client card (no payments history). */
  async clientCardSnippet(trainerId: string, clientId: string) {
    const [balance, pkg] = await Promise.all([
      this.prisma.trainerClientBalance.findUnique({
        where: { trainerId_clientId: { trainerId, clientId } },
      }),
      this.prisma.trainerClientPackage.findFirst({
        where: {
          trainerId,
          clientId,
          status: TrainerOwnPackageStatus.ACTIVE,
          sessionsRemaining: { gt: 0 },
        },
        orderBy: { soldAt: 'desc' },
      }),
    ]);
    return {
      debtMinor: balance?.debtMinor ?? 0,
      activePackage: pkg
        ? {
            id: pkg.id,
            title: pkg.title,
            sessionsRemaining: pkg.sessionsRemaining,
            sessionsTotal: pkg.sessionsTotal,
            validUntil: pkg.validUntil?.toISOString() ?? null,
            status: pkg.status,
          }
        : null,
    };
  }

  private async assertRosterClient(trainerId: string, clientId: string) {
    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId, clientId } },
    });
    if (!link) {
      throw new BadRequestException('Клиент не в вашей базе');
    }
  }

  private mapPayment(p: {
    id: string;
    clientId: string;
    amountMinor: number;
    method: TrainerPaymentMethod;
    kind: TrainerPaymentKind;
    paidAt: Date;
    comment: string | null;
    packageId: string | null;
    bookingId: string | null;
    client: { firstName: string; lastName: string };
  }): TrainerClientPaymentView {
    return {
      id: p.id,
      clientId: p.clientId,
      clientName: clientName(p.client),
      amountMinor: p.amountMinor,
      method: p.method,
      kind: p.kind,
      paidAt: p.paidAt.toISOString(),
      comment: p.comment,
      packageId: p.packageId,
      bookingId: p.bookingId,
    };
  }

  private mapPackage(
    p: {
      id: string;
      clientId: string;
      title: string;
      sessionsTotal: number;
      sessionsRemaining: number;
      priceMinor: number;
      paidMinor: number;
      validUntil: Date | null;
      status: TrainerOwnPackageStatus;
      soldAt: Date;
    },
    name: string,
  ): TrainerClientPackageView {
    return {
      id: p.id,
      clientId: p.clientId,
      clientName: name,
      title: p.title,
      sessionsTotal: p.sessionsTotal,
      sessionsRemaining: p.sessionsRemaining,
      priceMinor: p.priceMinor,
      paidMinor: p.paidMinor,
      validUntil: p.validUntil?.toISOString() ?? null,
      status: p.status,
      soldAt: p.soldAt.toISOString(),
    };
  }
}
