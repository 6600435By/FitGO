import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  classifyPtSessionOrigin,
  classifyPtStatsPayment,
  isSpaLikeSessionTitle,
  onexSessionKey,
  ptStatsOriginLabelRu,
  ptStatsPaymentLabelRu,
  sliceForTrack,
  type PtStatsClientGap,
  type PtStatsMixCounts,
  type PtStatsPayment,
  type PtStatsPaymentCounts,
  type PtStatsReport,
  type PtStatsSessionLine,
  type PtStatsTrainerSummary,
  type PtStatsOrigin,
  type StaffPayProfile,
} from '@fitgo/shared-types';
import {
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  PersonalBookingStatus,
  Role,
} from '@prisma/client';
import { isExcludedFromPtBookingControl as isExcludedPt } from '../admin-sales/trainer-pt-sales-from-revenue';
import {
  resolveStaffUserId,
  staffDisplayNames,
} from '../analytics/staff-analytics.helpers';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffRosterService } from '../staff-roster/staff-roster.service';

function emptyMix(): PtStatsMixCounts {
  return { membership: 0, block: 0, oneShot: 0, gift: 0, unknown: 0 };
}

function emptyPayments(): PtStatsPaymentCounts {
  return {
    writtenOff: 0,
    paid: 0,
    debt: 0,
    gift: 0,
    unknown: 0,
    debtMinor: 0,
  };
}

function bumpMix(mix: PtStatsMixCounts, origin: PtStatsOrigin) {
  switch (origin) {
    case 'MEMBERSHIP':
      mix.membership += 1;
      break;
    case 'BLOCK':
      mix.block += 1;
      break;
    case 'ONE_SHOT':
      mix.oneShot += 1;
      break;
    case 'GIFT':
      mix.gift += 1;
      break;
    default:
      mix.unknown += 1;
  }
}

function bumpPayment(
  payments: PtStatsPaymentCounts,
  payment: PtStatsPayment,
  priceMinor: number,
) {
  switch (payment) {
    case 'WRITTEN_OFF':
      payments.writtenOff += 1;
      break;
    case 'PAID':
      payments.paid += 1;
      break;
    case 'DEBT':
      payments.debt += 1;
      payments.debtMinor += Math.max(0, priceMinor);
      break;
    case 'GIFT':
      payments.gift += 1;
      break;
    default:
      payments.unknown += 1;
  }
}

function periodDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

function shiftIsoDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function staffEmployeeCodes(user: {
  externalId?: string | null;
  employeeCode?: string | null;
}): string[] {
  const out = new Set<string>();
  for (const raw of [user.externalId, user.employeeCode]) {
    const t = raw?.trim();
    if (!t) continue;
    out.add(t);
    const stripped = t.replace(/^0+/, '');
    if (stripped) out.add(stripped);
  }
  return [...out];
}

function emptyTrainerSummary(
  trainerId: string,
  trainerName: string,
): PtStatsTrainerSummary {
  return {
    trainerId,
    trainerName,
    sessionsConducted: 0,
    noShowCount: 0,
    cancelledCount: 0,
    uniqueClients: 0,
    newClients: 0,
    returningClients: 0,
    sessionsPerClient: null,
    retentionPct: null,
    retention90Pct: null,
    conversionPct: null,
    mix: emptyMix(),
    payments: emptyPayments(),
    shiftMinutes: 0,
    shiftPayMinor: 0,
    hourlyRateMinor: 0,
    sessionMotivationMinor: 0,
    totalEarnMinor: 0,
    ladderPercent: null,
  };
}

function sumTrainerSummaries(
  trainers: PtStatsTrainerSummary[],
): PtStatsTrainerSummary {
  if (trainers.length === 1) return trainers[0]!;
  const totals = emptyTrainerSummary('ALL', 'Все тренеры');
  if (trainers.length === 0) return totals;
  for (const t of trainers) {
    totals.sessionsConducted += t.sessionsConducted;
    totals.noShowCount += t.noShowCount;
    totals.cancelledCount += t.cancelledCount;
    totals.uniqueClients += t.uniqueClients;
    totals.newClients += t.newClients;
    totals.returningClients += t.returningClients;
    totals.shiftMinutes += t.shiftMinutes;
    totals.shiftPayMinor += t.shiftPayMinor;
    totals.sessionMotivationMinor += t.sessionMotivationMinor;
    totals.totalEarnMinor += t.totalEarnMinor;
    totals.mix.membership += t.mix.membership;
    totals.mix.block += t.mix.block;
    totals.mix.oneShot += t.mix.oneShot;
    totals.mix.gift += t.mix.gift;
    totals.mix.unknown += t.mix.unknown;
    totals.payments.writtenOff += t.payments.writtenOff;
    totals.payments.paid += t.payments.paid;
    totals.payments.debt += t.payments.debt;
    totals.payments.gift += t.payments.gift;
    totals.payments.unknown += t.payments.unknown;
    totals.payments.debtMinor += t.payments.debtMinor;
    if (t.hourlyRateMinor > totals.hourlyRateMinor) {
      totals.hourlyRateMinor = t.hourlyRateMinor;
    }
    if (
      t.ladderPercent != null &&
      (totals.ladderPercent == null || t.ladderPercent > totals.ladderPercent)
    ) {
      totals.ladderPercent = t.ladderPercent;
    }
  }
  totals.sessionsPerClient =
    totals.uniqueClients > 0
      ? Math.round((totals.sessionsConducted / totals.uniqueClients) * 10) / 10
      : null;
  // Weighted retention / conversion across trainers with data
  let retW = 0;
  let retN = 0;
  let ret90W = 0;
  let ret90N = 0;
  let convW = 0;
  let convN = 0;
  for (const t of trainers) {
    if (t.retentionPct != null && t.uniqueClients > 0) {
      retW += t.retentionPct * t.uniqueClients;
      retN += t.uniqueClients;
    }
    if (t.retention90Pct != null) {
      ret90W += t.retention90Pct;
      ret90N += 1;
    }
    if (t.conversionPct != null && t.newClients > 0) {
      convW += t.conversionPct * t.newClients;
      convN += t.newClients;
    }
  }
  totals.retentionPct =
    retN > 0 ? Math.round((retW / retN) * 10) / 10 : null;
  totals.retention90Pct =
    ret90N > 0 ? Math.round((ret90W / ret90N) * 10) / 10 : null;
  totals.conversionPct =
    convN > 0 ? Math.round((convW / convN) * 10) / 10 : null;
  return totals;
}

type OnexMeta = {
  sessionKey: string;
  paymentBasis?: string | null;
  packageQty?: number | null;
  clientKey: string;
  clientName: string;
  trainerUserId?: string;
  attendance: OnexClassMemberAttendance;
  cancelled: boolean;
  status: OnexClassStatus;
  startAt: Date;
  title: string;
};

@Injectable()
export class PtTimesheetStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
    private readonly staffRoster: StaffRosterService,
  ) {}

  async getReport(
    clubId: string,
    from: string,
    to: string,
    opts?: { trainerId?: string | null },
  ): Promise<PtStatsReport> {
    this.assertPeriod(from, to);
    const trainers = await this.resolvePtTrainers(clubId, from, to, opts?.trainerId);
    if (opts?.trainerId && trainers.length === 0) {
      throw new NotFoundException('Тренер не найден');
    }

    const onexMeta = await this.loadOnexMeta(clubId, from, to, trainers);
    const allLines: PtStatsSessionLine[] = [];
    const summaries: PtStatsTrainerSummary[] = [];
    const currency = 'BYN';

    for (const t of trainers) {
      const built = await this.buildTrainerReport(
        clubId,
        t,
        from,
        to,
        onexMeta,
      );
      summaries.push(built.summary);
      allLines.push(...built.lines);
    }

    allLines.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    const noNextBooking = await this.findNoNextBooking(
      clubId,
      allLines,
      trainers,
    );

    const showShiftColumns = summaries.some((s) => s.hourlyRateMinor > 0);
    const totals = sumTrainerSummaries(summaries);

    return {
      from,
      to,
      currency,
      trainerId: opts?.trainerId ?? null,
      trainers: summaries,
      totals,
      lines: allLines,
      noNextBooking,
      showShiftColumns,
    };
  }

  /** Names for the stats picker. Does not build KPIs or payroll. */
  async listTrainerOptions(
    clubId: string,
    from: string,
    to: string,
  ): Promise<Array<{ id: string; name: string }>> {
    this.assertPeriod(from, to);
    const trainers = await this.resolvePtTrainers(clubId, from, to, null);
    return trainers.map((t) => ({ id: t.id, name: t.name }));
  }

  async exportXlsx(
    clubId: string,
    from: string,
    to: string,
    opts?: { trainerId?: string | null },
  ): Promise<Buffer> {
    const report = await this.getReport(clubId, from, to, opts);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FitGO';

    // One sheet: metrics as rows (columns = trainers), then session lines
    // trainer-by-trainer. No sessionKey in the client breakdown.
    const sheet = wb.addWorksheet('Общая информация');
    const money = (minor: number) => Number((minor / 100).toFixed(2));
    const trainers = report.trainers;
    const cols: PtStatsTrainerSummary[] =
      trainers.length > 1 ? [...trainers, report.totals] : trainers;
    const colLabels = cols.map((t, i) =>
      trainers.length > 1 && i === cols.length - 1 ? 'ИТОГО' : t.trainerName,
    );

    sheet.addRow(['Период', `${from} — ${to}`]);
    sheet.addRow([]);
    sheet.addRow(['Показатель', ...colLabels]);

    const metric = (
      label: string,
      pick: (t: PtStatsTrainerSummary) => string | number,
    ) => {
      sheet.addRow([label, ...cols.map(pick)]);
    };

    metric('Проведено', (t) => t.sessionsConducted);
    metric('Неявки', (t) => t.noShowCount);
    metric('Отмены', (t) => t.cancelledCount);
    metric('Уникальные клиенты', (t) => t.uniqueClients);
    metric('Новые', (t) => t.newClients);
    metric('Повторные', (t) => t.returningClients);
    metric('На клиента', (t) => t.sessionsPerClient ?? '');
    metric('Удержание %', (t) => t.retentionPct ?? '');
    metric('Удержание 60–90 %', (t) => t.retention90Pct ?? '');
    metric('Конверсия %', (t) => t.conversionPct ?? '');
    metric('Абонемент', (t) => t.mix.membership);
    metric('Блок', (t) => t.mix.block);
    metric('Разовые', (t) => t.mix.oneShot);
    metric('Подарок', (t) => t.mix.gift);
    metric('Не распознано', (t) => t.mix.unknown);
    metric('Списано', (t) => t.payments.writtenOff);
    metric('Оплачено', (t) => t.payments.paid);
    metric('Долг', (t) => t.payments.debt);
    metric('Долг ₽', (t) => money(t.payments.debtMinor));
    metric('Смена мин', (t) => t.shiftMinutes);
    metric('Смена ₽', (t) => money(t.shiftPayMinor));
    metric('Мотивация ₽', (t) => money(t.sessionMotivationMinor));
    metric('Итого ₽', (t) => money(t.totalEarnMinor));
    metric('Лестница %', (t) => t.ladderPercent ?? '');

    sheet.addRow([]);
    sheet.addRow([
      'Дата',
      'Тренер',
      'Клиент',
      'Откуда',
      'Оплата',
      'Цена',
      '%',
      'Начислено',
      'Название',
    ]);

    const linesByTrainer = new Map<string, PtStatsSessionLine[]>();
    for (const line of report.lines) {
      const list = linesByTrainer.get(line.trainerId) ?? [];
      list.push(line);
      linesByTrainer.set(line.trainerId, list);
    }
    for (const t of trainers) {
      const lines = [...(linesByTrainer.get(t.trainerId) ?? [])].sort(
        (a, b) =>
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
      for (const line of lines) {
        sheet.addRow([
          line.occurredAt,
          line.trainerName,
          line.clientName,
          ptStatsOriginLabelRu(line.origin),
          ptStatsPaymentLabelRu(line.payment),
          money(line.priceMinor),
          line.ratePercent ?? '',
          money(line.earnMinor),
          line.title,
        ]);
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private assertPeriod(from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('from/to: YYYY-MM-DD');
    }
    if (from > to) {
      throw new BadRequestException('from не может быть позже to');
    }
  }

  private async resolvePtTrainers(
    clubId: string,
    from: string,
    to: string,
    trainerId?: string | null,
  ): Promise<Array<{
    id: string;
    name: string;
    externalId: string | null;
    employeeCode: string | null;
    firstName: string;
    lastName: string;
  }>> {
    if (trainerId) {
      const u = await this.prisma.user.findFirst({
        where: {
          id: trainerId,
          clubId,
          roles: { some: { role: Role.TRAINER } },
        },
      });
      if (!u) return [];
      return [
        {
          id: u.id,
          name: `${u.lastName} ${u.firstName}`.trim(),
          externalId: u.externalId,
          employeeCode: u.employeeCode,
          firstName: u.firstName,
          lastName: u.lastName,
        },
      ];
    }

    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        externalId: true,
        employeeCode: true,
        trainerClub: true,
        trainerStaff: true,
        trainerReformers: true,
        groupPrograms: true,
      },
    });

    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const onexWithPt = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.PT,
        status: OnexClassStatus.COMPLETED,
        isActive: true,
        startAt: { gte: fromD, lte: toD },
      },
      select: { employeeExternalId: true, employeeName: true, title: true },
    });
    const activeIds = new Set<string>();
    const byExternal = new Map<string, string>();
    for (const u of users) {
      for (const c of staffEmployeeCodes(u)) byExternal.set(c, u.id);
    }
    for (const s of onexWithPt) {
      if (isExcludedPt(s.title) || isSpaLikeSessionTitle(s.title)) continue;
      const uid = resolveStaffUserId(
        byExternal,
        users,
        s.employeeExternalId,
        s.employeeName,
      );
      if (uid) activeIds.add(uid);
    }

    const fitgo = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainer: { clubId },
        startAt: { gte: fromD, lte: toD },
        status: { not: PersonalBookingStatus.CANCELLED },
      },
      select: { trainerId: true },
      distinct: ['trainerId'],
    });
    for (const b of fitgo) activeIds.add(b.trainerId);

    return users
      .filter((u) => {
        const isPtCabinet =
          u.trainerClub || u.trainerStaff || u.trainerReformers;
        return isPtCabinet || activeIds.has(u.id);
      })
      .map((u) => ({
        id: u.id,
        name: `${u.lastName} ${u.firstName}`.trim(),
        externalId: u.externalId,
        employeeCode: u.employeeCode,
        firstName: u.firstName,
        lastName: u.lastName,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  private async loadOnexMeta(
    clubId: string,
    from: string,
    to: string,
    trainers: Array<{
      id: string;
      externalId: string | null;
      employeeCode: string | null;
      firstName: string;
      lastName: string;
    }>,
  ): Promise<OnexMeta[]> {
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const byExternal = new Map<string, string>();
    for (const t of trainers) {
      for (const c of staffEmployeeCodes(t)) byExternal.set(c, t.id);
    }
    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.PT,
        isActive: true,
        startAt: { gte: fromD, lte: toD },
        status: {
          in: [
            OnexClassStatus.COMPLETED,
            OnexClassStatus.CANCELLED,
            OnexClassStatus.SCHEDULED,
          ],
        },
      },
      include: { members: true },
    });
    const out: OnexMeta[] = [];
    for (const s of sessions) {
      if (isExcludedPt(s.title) || isSpaLikeSessionTitle(s.title)) continue;
      const trainerUserId = resolveStaffUserId(
        byExternal,
        trainers,
        s.employeeExternalId,
        s.employeeName,
      );
      if (s.members.length === 0) {
        out.push({
          sessionKey: onexSessionKey(s.externalId),
          paymentBasis: null,
          packageQty: null,
          clientKey: `sess:${s.externalId}`,
          clientName: '—',
          trainerUserId,
          attendance: OnexClassMemberAttendance.EXPECTED,
          cancelled: s.status === OnexClassStatus.CANCELLED,
          status: s.status,
          startAt: s.startAt,
          title: s.title,
        });
        continue;
      }
      for (const mem of s.members) {
        out.push({
          sessionKey: onexSessionKey(s.externalId),
          paymentBasis: mem.paymentBasis,
          packageQty: mem.packageQty,
          clientKey: mem.externalId?.trim() || `sess:${s.externalId}`,
          clientName: mem.clientName || '—',
          trainerUserId,
          attendance: mem.attendance,
          cancelled:
            Boolean(mem.cancelled) || s.status === OnexClassStatus.CANCELLED,
          status: s.status,
          startAt: s.startAt,
          title: s.title,
        });
      }
    }
    return out;
  }

  private async buildTrainerReport(
    clubId: string,
    trainer: { id: string; name: string },
    from: string,
    to: string,
    onexMeta: OnexMeta[],
  ): Promise<{ summary: PtStatsTrainerSummary; lines: PtStatsSessionLine[] }> {
    const { units, profile, ladderPercent } =
      await this.payroll.listPtUnitsWithMonthLadder(
        clubId,
        trainer.id,
        from,
        to,
      );

    const metaByKey = new Map<string, OnexMeta>();
    for (const m of onexMeta) {
      if (m.trainerUserId && m.trainerUserId !== trainer.id) continue;
      if (!metaByKey.has(m.sessionKey)) metaByKey.set(m.sessionKey, m);
    }

    const lines: PtStatsSessionLine[] = [];
    const mix = emptyMix();
    const payments = emptyPayments();
    let sessionMotivationMinor = 0;

    const fitgoBookingIds = units
      .map((u) => u.id)
      .filter((id) => !id.startsWith('onex:') && !id.startsWith('ptsale:'));
    const bookingClient = new Map<string, string>();
    if (fitgoBookingIds.length > 0) {
      const bookings = await this.prisma.personalTrainingBooking.findMany({
        where: { id: { in: fitgoBookingIds }, trainerId: trainer.id },
        select: { id: true, clientId: true },
      });
      for (const b of bookings) bookingClient.set(b.id, b.clientId);
    }

    for (const u of units) {
      const meta = u.sessionKey ? metaByKey.get(u.sessionKey) : undefined;
      const fromSale = (u.sessionKey ?? '').startsWith('sale:');
      const origin = classifyPtSessionOrigin({
        paymentBasis: meta?.paymentBasis,
        sessionTitle: u.title,
        packageQty: meta?.packageQty,
        fromSaleLine: fromSale,
        isComplimentary: u.isComplimentary,
      });
      const payment = classifyPtStatsPayment({
        origin,
        paymentBasis: meta?.paymentBasis,
        isComplimentary: u.isComplimentary,
        payrollTrusted: u.payrollTrusted,
      });
      const priceMinor = u.priceMinor ?? 0;
      const earnMinor = u.isComplimentary ? 0 : (u.earnMinor ?? 0);
      if (u.payrollTrusted && !u.isComplimentary) {
        sessionMotivationMinor += earnMinor;
      }
      bumpMix(mix, origin);
      bumpPayment(payments, payment, priceMinor);

      const clientId = bookingClient.get(u.id);
      const clientKey =
        meta?.clientKey ??
        clientId ??
        `name:${(u.clientName ?? u.id).trim().toLowerCase()}`;
      lines.push({
        sessionKey: u.sessionKey ?? `pt:${u.id}`,
        occurredAt: u.occurredAt,
        trainerId: trainer.id,
        trainerName: trainer.name,
        clientKey,
        clientId,
        clientName: u.clientName ?? meta?.clientName ?? '—',
        origin,
        payment,
        priceMinor,
        ratePercent: u.ratePercent,
        earnMinor,
        isComplimentary: Boolean(u.isComplimentary),
        payrollTrusted: u.payrollTrusted,
        title: u.title,
        saleExternalId: u.saleExternalId,
        saleOccurredAt: u.saleOccurredAt,
      });
    }

    const mineMeta = onexMeta.filter(
      (m) => !m.trainerUserId || m.trainerUserId === trainer.id,
    );
    let noShowCount = 0;
    let cancelledCount = 0;
    for (const m of mineMeta) {
      if (m.status === OnexClassStatus.CANCELLED || m.cancelled) {
        cancelledCount += 1;
      } else if (m.attendance === OnexClassMemberAttendance.NO_SHOW) {
        noShowCount += 1;
      }
    }

    const clientKeys = new Set(lines.map((l) => l.clientKey));
    const uniqueClients = clientKeys.size;

    const kpis = await this.clientKpis(clubId, trainer.id, from, to, lines);

    const hourly = await this.shiftPay(clubId, trainer.id, from, to, profile);

    const summary: PtStatsTrainerSummary = {
      trainerId: trainer.id,
      trainerName: trainer.name,
      sessionsConducted: lines.length,
      noShowCount,
      cancelledCount,
      uniqueClients,
      newClients: kpis.newClients,
      returningClients: Math.max(0, uniqueClients - kpis.newClients),
      sessionsPerClient:
        uniqueClients > 0
          ? Math.round((lines.length / uniqueClients) * 10) / 10
          : null,
      retentionPct: kpis.retentionPct,
      retention90Pct: kpis.retention90Pct,
      conversionPct: kpis.conversionPct,
      mix,
      payments,
      shiftMinutes: hourly.shiftMinutes,
      shiftPayMinor: hourly.shiftPayMinor,
      hourlyRateMinor: hourly.hourlyRateMinor,
      sessionMotivationMinor,
      totalEarnMinor: sessionMotivationMinor + hourly.shiftPayMinor,
      ladderPercent,
    };

    return { summary, lines };
  }

  private async shiftPay(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
    profile?: StaffPayProfile,
  ): Promise<{
    shiftMinutes: number;
    shiftPayMinor: number;
    hourlyRateMinor: number;
  }> {
    const hourlyRateMinor =
      sliceForTrack(profile, 'PT').hourlyRateMinor ||
      profile?.hourlyRateMinor ||
      0;
    if (hourlyRateMinor <= 0) {
      return { shiftMinutes: 0, shiftPayMinor: 0, hourlyRateMinor: 0 };
    }
    const hours = await this.staffRoster.hourlySummary(
      clubId,
      trainerId,
      from,
      to,
    );
    let shiftMinutes = 0;
    for (const s of hours.shifts) {
      if (s.track !== 'TRAINER') continue;
      shiftMinutes += s.minutes + (s.overtimeMinutes ?? 0);
    }
    const shiftPayMinor = Math.round((shiftMinutes / 60) * hourlyRateMinor);
    return { shiftMinutes, shiftPayMinor, hourlyRateMinor };
  }

  /**
   * New / retention / conversion — same definitions as staff analytics PT KPIs,
   * plus period-window retention (prior window of equal length).
   */
  private async clientKpis(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
    periodLines: PtStatsSessionLine[],
  ): Promise<{
    newClients: number;
    retentionPct: number | null;
    retention90Pct: number | null;
    conversionPct: number | null;
  }> {
    const lookbackFrom = '2020-01-01';
    const end = new Date(`${to}T23:59:59.999`);
    const start = new Date(`${from}T00:00:00`);

    const onex = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.PT,
        status: OnexClassStatus.COMPLETED,
        isActive: true,
        startAt: { gte: new Date(`${lookbackFrom}T00:00:00`), lte: end },
      },
      include: {
        members: { where: { cancelled: false }, take: 1 },
      },
      orderBy: { startAt: 'asc' },
    });

    const trainer = await this.prisma.user.findFirst({
      where: { id: trainerId, clubId },
    });
    if (!trainer) {
      return {
        newClients: 0,
        retentionPct: null,
        retention90Pct: null,
        conversionPct: null,
      };
    }
    const codes = new Set(staffEmployeeCodes(trainer));
    const names = new Set(
      staffDisplayNames(trainer).map((n) => n.toLowerCase()),
    );

    type Evt = {
      clientKey: string;
      startAt: Date;
      isGift: boolean;
    };
    const events: Evt[] = [];
    const covered = new Set<string>();

    for (const s of onex) {
      if (isExcludedPt(s.title) || isSpaLikeSessionTitle(s.title)) continue;
      const emp = (s.employeeExternalId ?? '').trim();
      const empName = (s.employeeName ?? '').trim().toLowerCase();
      const byCode =
        emp &&
        [...codes].some(
          (c) => c === emp || c.replace(/^0+/, '') === emp.replace(/^0+/, ''),
        );
      const byName = empName && [...names].some((n) => n === empName);
      // resolve via display name soft match
      let matched = byCode;
      if (!matched && empName) {
        for (const n of names) {
          if (n.includes(empName) || empName.includes(n)) {
            matched = true;
            break;
          }
        }
      }
      if (!matched && !byName) continue;
      const primary = s.members[0];
      const clientKey =
        primary?.externalId?.trim() || `sess:${s.externalId}`;
      const gift =
        /подарок|gift|комплимент|бесплат/i.test(primary?.paymentBasis ?? '') ||
        /подарок|gift|комплимент|бесплат/i.test(s.title);
      events.push({ clientKey, startAt: s.startAt, isGift: gift });
      covered.add(s.externalId);
      if (s.number) covered.add(s.number);
    }

    const fitgo = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId,
        startAt: { gte: new Date(`${lookbackFrom}T00:00:00`), lte: end },
        status: { not: PersonalBookingStatus.CANCELLED },
      },
      select: {
        clientId: true,
        startAt: true,
        crmDocRef: true,
        isComplimentary: true,
      },
      orderBy: { startAt: 'asc' },
    });
    for (const b of fitgo) {
      const ref = b.crmDocRef?.trim();
      if (ref && covered.has(ref)) continue;
      events.push({
        clientKey: b.clientId,
        startAt: b.startAt,
        isGift: b.isComplimentary,
      });
    }
    events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    const firstByClient = new Map<string, Date>();
    for (const e of events) {
      if (!firstByClient.has(e.clientKey)) {
        firstByClient.set(e.clientKey, e.startAt);
      }
    }

    const periodClientKeys = new Set(periodLines.map((l) => l.clientKey));
    let newClients = 0;
    const newIds: string[] = [];
    for (const key of periodClientKeys) {
      const first = firstByClient.get(key);
      if (first && first >= start && first <= end) {
        newClients += 1;
        newIds.push(key);
      }
    }

    let converted = 0;
    for (const clientId of newIds) {
      const first = firstByClient.get(clientId)!;
      const windowEnd = new Date(first.getTime() + 30 * 86400000);
      const hasPaid = events.some(
        (e) =>
          e.clientKey === clientId &&
          e.startAt >= first &&
          e.startAt <= windowEnd &&
          !e.isGift,
      );
      if (hasPaid) converted += 1;
    }
    const conversionPct =
      newIds.length > 0
        ? Math.round((converted / newIds.length) * 1000) / 10
        : null;

    // Period-window retention: prior window of equal length
    const days = periodDays(from, to);
    const priorTo = shiftIsoDays(from, -1);
    const priorFrom = shiftIsoDays(priorTo, -(days - 1));
    const priorStart = new Date(`${priorFrom}T00:00:00`);
    const priorEnd = new Date(`${priorTo}T23:59:59.999`);
    const priorClients = new Set<string>();
    for (const e of events) {
      if (e.startAt >= priorStart && e.startAt <= priorEnd) {
        priorClients.add(e.clientKey);
      }
    }
    let retained = 0;
    for (const key of priorClients) {
      if (periodClientKeys.has(key)) retained += 1;
    }
    const retentionPct =
      priorClients.size > 0
        ? Math.round((retained / priorClients.size) * 1000) / 10
        : null;

    // 60–90 day cohort (staff analytics)
    const cohortTo = shiftIsoDays(to, -60);
    const cohortFrom = shiftIsoDays(to, -150);
    const cStart = new Date(`${cohortFrom}T00:00:00`);
    const cEnd = new Date(`${cohortTo}T23:59:59.999`);
    const cohort: string[] = [];
    for (const [key, first] of firstByClient) {
      if (first >= cStart && first <= cEnd) cohort.push(key);
    }
    let retained90 = 0;
    for (const clientId of cohort) {
      const first = firstByClient.get(clientId)!;
      const winStart = new Date(first.getTime() + 60 * 86400000);
      const winEnd = new Date(first.getTime() + 90 * 86400000);
      const has = events.some(
        (e) =>
          e.clientKey === clientId &&
          e.startAt >= winStart &&
          e.startAt <= winEnd,
      );
      if (has) retained90 += 1;
    }
    const retention90Pct =
      cohort.length > 0
        ? Math.round((retained90 / cohort.length) * 1000) / 10
        : null;

    return { newClients, retentionPct, retention90Pct, conversionPct };
  }

  private async findNoNextBooking(
    clubId: string,
    lines: PtStatsSessionLine[],
    trainers: Array<{ id: string; name: string }>,
  ): Promise<PtStatsClientGap[]> {
    const byClient = new Map<
      string,
      { line: PtStatsSessionLine; last: string }
    >();
    for (const l of lines) {
      const prev = byClient.get(l.clientKey);
      if (!prev || l.occurredAt > prev.last) {
        byClient.set(l.clientKey, { line: l, last: l.occurredAt });
      }
    }
    if (byClient.size === 0) return [];

    const now = new Date();
    const trainerIds = trainers.map((t) => t.id);
    const clientIds = [
      ...new Set(
        [...byClient.values()]
          .map((v) => v.line.clientId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const futureByClient = new Set<string>();
    if (clientIds.length > 0 && trainerIds.length > 0) {
      const future = await this.prisma.personalTrainingBooking.findMany({
        where: {
          clientId: { in: clientIds },
          trainerId: { in: trainerIds },
          trainer: { clubId },
          startAt: { gt: now },
          status: {
            in: [
              PersonalBookingStatus.CONFIRMED,
              PersonalBookingStatus.PENDING_1C,
            ],
          },
        },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      for (const f of future) futureByClient.add(f.clientId);
    }

    const gaps: PtStatsClientGap[] = [];
    const trainerName = new Map(trainers.map((t) => [t.id, t.name]));
    for (const [key, { line, last }] of byClient) {
      if (line.clientId && futureByClient.has(line.clientId)) continue;
      // Only flag when we know the FitGO client — 1C-only keys have no future booking.
      if (!line.clientId) continue;
      gaps.push({
        clientKey: key,
        clientId: line.clientId,
        clientName: line.clientName,
        lastSessionAt: last,
        trainerId: line.trainerId,
        trainerName: trainerName.get(line.trainerId) ?? line.trainerName,
      });
    }
    gaps.sort((a, b) => b.lastSessionAt.localeCompare(a.lastSessionAt));
    return gaps.slice(0, 50);
  }
}
