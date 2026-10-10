import { Injectable } from '@nestjs/common';
import type {
  AnalyticsDepartment,
  ManagerEfficiencyBlock,
  StaffAnalyticsReport,
  StaffDepartmentKpi,
  StaffKpiRow,
  StaffPayColumns,
} from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import {
  AdminTaskStatus,
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  PersonalBookingStatus,
  PtSessionPayKind,
  Role,
  SessionRemarkStatus,
  SpaBookingStatus,
  SpaPaymentType,
  StaffShiftTrack,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { addDaysIso, assertPeriod, rangeBounds } from './analytics-period';
import { applyStaffFlags } from './staff-analytics.rules';
import { ClubAnalyticsService } from './club-analytics.service';

type StaffUser = {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  externalId: string | null;
  groupPrograms: boolean;
  trainerStaff: boolean;
  trainerClub: boolean;
  roles: { role: Role }[];
};

@Injectable()
export class StaffAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
    private readonly clubAnalytics: ClubAnalyticsService,
  ) {}

  async getStaffReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      department?: AnalyticsDepartment;
      userId?: string;
      includePay?: boolean;
    },
  ): Promise<StaffAnalyticsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const department: AnalyticsDepartment = params.department ?? 'ALL';
    const isSuperAdmin = user.roles.includes(UserRole.SUPER_ADMIN);
    const isManager = user.roles.includes(UserRole.MANAGER);
    const canSeePay = isSuperAdmin || isManager;
    const includePay = Boolean(params.includePay) && canSeePay;

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });

    const staff = await this.loadStaff(clubId);
    const { start, end } = rangeBounds(params.from, params.to);

    // Skip heavy collectors when a single department is selected.
    const needAdmin =
      department === 'ALL' ||
      department === 'ADMIN' ||
      department === 'MANAGER';
    const needGroup =
      department === 'ALL' || department === 'GROUP_TRAINER';
    const needPt = department === 'ALL' || department === 'PT_TRAINER';
    const needSpa = department === 'ALL' || department === 'SPECIALIST';
    const needTech = department === 'ALL' || department === 'TECH';
    const emptyKpi = Promise.resolve(new Map<string, StaffDepartmentKpi>());
    const emptyPay = Promise.resolve(
      new Map<string, StaffPayColumns & { openExceptions: number }>(),
    );

    const [
      hoursByUser,
      remarksByUser,
      adminKpis,
      groupKpis,
      ptKpis,
      spaKpis,
      techKpis,
      payByUser,
    ] = await Promise.all([
      this.collectHours(clubId, start, end),
      this.collectRemarks(clubId, start, end),
      needAdmin
        ? this.collectAdminKpis(clubId, staff, start, end, params.from, params.to)
        : emptyKpi,
      needGroup
        ? this.collectGroupTrainerKpis(clubId, staff, start, end)
        : emptyKpi,
      needPt
        ? this.collectPtTrainerKpis(
            clubId,
            staff,
            start,
            end,
            params.from,
            params.to,
          )
        : emptyKpi,
      needSpa
        ? this.collectSpaKpis(clubId, staff, start, end, params.from, params.to)
        : emptyKpi,
      needTech ? this.collectTechKpis(clubId, staff, start, end) : emptyKpi,
      includePay
        ? this.collectPay(clubId, params.from, params.to)
        : emptyPay,
    ]);

    const rows: StaffKpiRow[] = [];

    for (const s of staff) {
      const roleSet = new Set(s.roles.map((r) => r.role));
      const name = `${s.lastName} ${s.firstName}`.trim();
      const hours = hoursByUser.get(s.id) ?? 0;
      const remarks = remarksByUser.get(s.id) ?? { open: 0, opened: 0, closed: 0 };
      const pay = payByUser.get(s.id);

      const departments = this.departmentsFor(s, roleSet);
      for (const dept of departments) {
        if (department !== 'ALL' && department !== dept) continue;
        if (params.userId && params.userId !== s.id) continue;

        // Manager rows: MANAGER viewer must not see other managers' pay / efficiency
        if (dept === 'MANAGER' && !isSuperAdmin) {
          if (s.id !== user.sub) continue;
        }

        let kpi: StaffDepartmentKpi | null = null;
        if (dept === 'ADMIN') kpi = adminKpis.get(s.id) ?? null;
        else if (dept === 'GROUP_TRAINER') kpi = groupKpis.get(s.id) ?? null;
        else if (dept === 'PT_TRAINER') kpi = ptKpis.get(s.id) ?? null;
        else if (dept === 'SPECIALIST') kpi = spaKpis.get(s.id) ?? null;
        else if (dept === 'TECH') kpi = techKpis.get(s.id) ?? null;
        else if (dept === 'MANAGER') {
          kpi = {
            kind: 'MANAGER',
            corporateSalesMinor: 0,
            motivationSalesMinor: pay?.motivationMinor ?? 0,
          };
        }
        if (!kpi) {
          kpi = this.emptyKpi(dept);
        }

        const hidePay =
          !includePay ||
          (dept === 'MANAGER' && !isSuperAdmin && s.id !== user.sub);

        rows.push({
          userId: s.id,
          name,
          department: dept,
          roles: [...roleSet],
          hours,
          openRemarks: remarks.open,
          openExceptions: pay?.openExceptions ?? 0,
          flags: [],
          kpi,
          pay: hidePay
            ? null
            : pay
              ? {
                  totalEarnedMinor: pay.totalEarnedMinor,
                  advancePaidMinor: pay.advancePaidMinor,
                  settlementPaidMinor: pay.settlementPaidMinor,
                  periodPaidTotalMinor: pay.periodPaidTotalMinor,
                  toPayMinor: pay.toPayMinor,
                  baseSalaryMinor: pay.baseSalaryMinor,
                  motivationMinor: pay.motivationMinor,
                  bonusMinor: pay.bonusMinor,
                  fineMinor: pay.fineMinor,
                }
              : null,
        });
      }
    }

    // Enrich manager corporate sales
    if (includePay || isSuperAdmin) {
      const corpo = await this.prisma.payrollCorporateSale.findMany({
        where: {
          clubId,
          periodFrom: { lte: end },
          periodTo: { gte: start },
        },
      });
      for (const row of rows) {
        if (row.kpi.kind !== 'MANAGER') continue;
        const sum = corpo
          .filter((c) => c.userId === row.userId)
          .reduce((a, c) => a + c.amountMinor, 0);
        row.kpi.corporateSalesMinor = sum;
      }
    }

    const flagged = applyStaffFlags(rows);
    const problemCount = flagged.reduce(
      (a, r) => a + r.flags.filter((f) => f.severity === 'problem').length,
      0,
    );
    const achievementCount = flagged.reduce(
      (a, r) => a + r.flags.filter((f) => f.severity === 'achievement').length,
      0,
    );

    let managerEfficiency: ManagerEfficiencyBlock | null = null;
    if (isSuperAdmin) {
      managerEfficiency = await this.buildManagerEfficiency(
        user,
        clubId,
        params.from,
        params.to,
        flagged,
      );
    }

    const totals = {
      staffCount: new Set(flagged.map((r) => r.userId)).size,
      hours: flagged.reduce((a, r) => a + r.hours, 0),
      ...(includePay
        ? {
            totalEarnedMinor: flagged.reduce(
              (a, r) => a + (r.pay?.totalEarnedMinor ?? 0),
              0,
            ),
            toPayMinor: flagged.reduce((a, r) => a + (r.pay?.toPayMinor ?? 0), 0),
          }
        : {}),
    };

    return {
      from: params.from,
      to: params.to,
      currency: club?.currency ?? 'BYN',
      includePay,
      department,
      rows: flagged,
      problemCount,
      achievementCount,
      managerEfficiency,
      totals,
    };
  }

  async exportStaffXlsx(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      department?: AnalyticsDepartment;
      userId?: string;
      includePay?: boolean;
    },
  ): Promise<Buffer> {
    const report = await this.getStaffReport(user, params);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FitGO';

    const summary = wb.addWorksheet('Сводка');
    summary.addRow(['Период', `${report.from} — ${report.to}`]);
    summary.addRow(['Сотрудников', report.totals.staffCount]);
    summary.addRow(['Часы', Math.round(report.totals.hours * 10) / 10]);
    summary.addRow(['Проблемы', report.problemCount]);
    summary.addRow(['Достижения', report.achievementCount]);
    if (report.includePay) {
      summary.addRow([
        'Начислено',
        (report.totals.totalEarnedMinor ?? 0) / 100,
      ]);
      summary.addRow(['К выдаче', (report.totals.toPayMinor ?? 0) / 100]);
    }

    const depts: Array<{ id: StaffKpiRow['department']; label: string }> = [
      { id: 'ADMIN', label: 'Админы' },
      { id: 'GROUP_TRAINER', label: 'Тренеры ГП' },
      { id: 'PT_TRAINER', label: 'Тренеры ПТ' },
      { id: 'SPECIALIST', label: 'СПА' },
      { id: 'TECH', label: 'Тех' },
      { id: 'MANAGER', label: 'Упр' },
    ];

    for (const d of depts) {
      const deptRows = report.rows.filter((r) => r.department === d.id);
      if (!deptRows.length) continue;
      const ws = wb.addWorksheet(d.label);
      const headers = this.xlsxHeaders(d.id, report.includePay);
      ws.addRow(headers);
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
      for (const r of deptRows) {
        const values = this.xlsxRow(r, report.includePay);
        const excelRow = ws.addRow(values);
        const hasProblem = r.flags.some((f) => f.severity === 'problem');
        const hasAchieve = r.flags.some((f) => f.severity === 'achievement');
        if (hasProblem) {
          excelRow.getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFE4E6' },
          };
        } else if (hasAchieve) {
          excelRow.getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDCFCE7' },
          };
        }
      }
      // Totals
      const totalRow = ['Итого', '', ...Array(headers.length - 2).fill('')];
      totalRow[2] = String(
        Math.round(deptRows.reduce((a, r) => a + r.hours, 0) * 10) / 10,
      );
      ws.addRow(totalRow);
    }

    if (report.managerEfficiency) {
      const ws = wb.addWorksheet('Управляющий');
      ws.addRow(['Индикатор', 'Статус', 'Значение', 'Сравнение', 'Подсказка']);
      for (const ind of report.managerEfficiency.indicators) {
        ws.addRow([
          ind.label,
          ind.status,
          ind.value,
          ind.compareValue ?? '',
          ind.hint ?? '',
        ]);
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private xlsxHeaders(dept: StaffKpiRow['department'], includePay: boolean) {
    const base = ['ФИО', 'Подразделение', 'Часы', 'Замечания', 'Флаги'];
    const pay = includePay
      ? ['Начислено', 'Аванс', 'ЗП 15', 'Выплачено', 'К выдаче']
      : [];
    const kpi =
      dept === 'ADMIN'
        ? [
            'Продажи',
            'Прод./час',
            'Задачи %',
            'Просрочено',
            'Подтв. ГП',
            'Подтв. ПТ/СПА',
          ]
        : dept === 'GROUP_TRAINER'
          ? ['Занятия', 'Ср. чел.', 'Заполн. %', 'Отмены %', 'Неявки %']
          : dept === 'PT_TRAINER'
            ? [
                'ПТ',
                'Платные',
                'Подарки',
                'Новые',
                'Конверсия %',
                'Удерж. 90 %',
                'Активные',
                'Продажи ПТ',
              ]
            : dept === 'SPECIALIST'
              ? [
                  'Услуги',
                  'Абонемент',
                  'Оплата',
                  'Allsports',
                  'Новые',
                  'Повтор %',
                  'Выручка',
                ]
              : dept === 'TECH'
                ? ['Смены', 'Переработка мин']
                : ['Корпо', 'Мотивация'];
    return [...base, ...kpi, ...pay];
  }

  private xlsxRow(r: StaffKpiRow, includePay: boolean): (string | number)[] {
    const flags = r.flags.map((f) => f.label).join(', ');
    const base: (string | number)[] = [
      r.name,
      r.department,
      Math.round(r.hours * 10) / 10,
      r.openRemarks,
      flags,
    ];
    const k = r.kpi;
    let kpi: (string | number)[] = [];
    if (k.kind === 'ADMIN') {
      kpi = [
        k.salesBySegment.totalMinor / 100,
        k.salesPerHourMinor != null ? k.salesPerHourMinor / 100 : '',
        k.tasksDonePct,
        k.tasksOverdue,
        k.bookingApprovalsGroup,
        k.bookingApprovalsSession,
      ];
    } else if (k.kind === 'GROUP_TRAINER') {
      kpi = [
        k.sessionsConducted,
        k.avgAttendees,
        k.avgFillPct ?? '',
        k.cancelRatePct ?? '',
        k.noShowPct ?? '',
      ];
    } else if (k.kind === 'PT_TRAINER') {
      kpi = [
        k.sessionsConducted,
        k.paidSessions,
        k.giftSessions,
        k.newClients,
        k.conversionPct ?? '',
        k.retention90Pct ?? '',
        k.activeClients30d,
        k.ptSalesMinor / 100,
      ];
    } else if (k.kind === 'SPECIALIST') {
      kpi = [
        k.servicesTotal,
        k.quotaCount,
        k.paidCount,
        k.allsportsCount,
        k.newClients,
        k.repeatPct ?? '',
        k.paidRevenueMinor / 100,
      ];
    } else if (k.kind === 'TECH') {
      kpi = [k.shifts, k.overtimeMinutes];
    } else if (k.kind === 'MANAGER') {
      kpi = [k.corporateSalesMinor / 100, k.motivationSalesMinor / 100];
    }
    const pay = includePay
      ? [
          (r.pay?.totalEarnedMinor ?? 0) / 100,
          (r.pay?.advancePaidMinor ?? 0) / 100,
          (r.pay?.settlementPaidMinor ?? 0) / 100,
          (r.pay?.periodPaidTotalMinor ?? 0) / 100,
          (r.pay?.toPayMinor ?? 0) / 100,
        ]
      : [];
    return [...base, ...kpi, ...pay];
  }

  private emptyKpi(dept: StaffKpiRow['department']): StaffDepartmentKpi {
    switch (dept) {
      case 'ADMIN':
        return {
          kind: 'ADMIN',
          salesBySegment: {
            membershipMinor: 0,
            spaMinor: 0,
            shopMinor: 0,
            corporateMinor: 0,
            totalMinor: 0,
          },
          salesPerHourMinor: null,
          tasksAssigned: 0,
          tasksDone: 0,
          tasksDonePct: 0,
          tasksOverdue: 0,
          medianCloseHours: null,
          renewalFunnel: {},
          bookingApprovalsGroup: 0,
          bookingApprovalsSession: 0,
          attendanceMarks: 0,
          remarksOpened: 0,
          remarksClosed: 0,
          approvalSharePct: null,
          avgApprovalLagHours: null,
        };
      case 'GROUP_TRAINER':
        return {
          kind: 'GROUP_TRAINER',
          sessionsConducted: 0,
          avgAttendees: 0,
          avgFillPct: null,
          cancelRatePct: null,
          noShowPct: null,
          cancelledSessions: 0,
          topDirections: [],
        };
      case 'PT_TRAINER':
        return {
          kind: 'PT_TRAINER',
          sessionsConducted: 0,
          paidSessions: 0,
          giftSessions: 0,
          newClients: 0,
          conversionPct: null,
          retention90Pct: null,
          retentionCohortFrom: null,
          retentionCohortTo: null,
          activeClients30d: 0,
          ptSalesMinor: 0,
        };
      case 'SPECIALIST':
        return {
          kind: 'SPECIALIST',
          servicesTotal: 0,
          quotaCount: 0,
          paidCount: 0,
          allsportsCount: 0,
          unknownPayCount: 0,
          newClients: 0,
          repeatPct: null,
          paidRevenueMinor: 0,
        };
      case 'TECH':
        return { kind: 'TECH', shifts: 0, overtimeMinutes: 0 };
      case 'MANAGER':
        return {
          kind: 'MANAGER',
          corporateSalesMinor: 0,
          motivationSalesMinor: 0,
        };
    }
  }

  private departmentsFor(
    s: StaffUser,
    roleSet: Set<Role>,
  ): StaffKpiRow['department'][] {
    const out: StaffKpiRow['department'][] = [];
    if (roleSet.has(Role.MANAGER)) out.push('MANAGER');
    if (roleSet.has(Role.ADMIN) && !roleSet.has(Role.MANAGER)) out.push('ADMIN');
    if (roleSet.has(Role.TRAINER)) {
      if (s.groupPrograms) out.push('GROUP_TRAINER');
      // PT: штат/клуб или тренер без флага ГП (чистый ПТ)
      if (s.trainerStaff || s.trainerClub || !s.groupPrograms) {
        out.push('PT_TRAINER');
      }
    }
    if (roleSet.has(Role.SPECIALIST)) out.push('SPECIALIST');
    if (roleSet.has(Role.TECH)) out.push('TECH');
    return [...new Set(out)];
  }

  private async loadStaff(clubId: string): Promise<StaffUser[]> {
    return this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        archivedAt: null,
        roles: {
          some: {
            role: {
              in: [
                Role.ADMIN,
                Role.MANAGER,
                Role.TRAINER,
                Role.SPECIALIST,
                Role.TECH,
              ],
            },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        externalId: true,
        groupPrograms: true,
        trainerStaff: true,
        trainerClub: true,
        roles: { select: { role: true } },
      },
    });
  }

  private async collectHours(clubId: string, start: Date, end: Date) {
    const shifts = await this.prisma.staffShift.findMany({
      where: { clubId, date: { gte: start, lte: end } },
      select: { userId: true, startAt: true, endAt: true, overtimeMinutes: true },
    });
    const map = new Map<string, number>();
    for (const s of shifts) {
      const hrs =
        (s.endAt.getTime() - s.startAt.getTime()) / 3600000 +
        (s.overtimeMinutes ?? 0) / 60;
      map.set(s.userId, (map.get(s.userId) ?? 0) + hrs);
    }
    // PT day sheets worked minutes as fallback/add for trainers
    const sheets = await this.prisma.trainerDaySheet.findMany({
      where: { clubId, date: { gte: start, lte: end } },
      select: { trainerId: true, workedMinutes: true, shiftMinutes: true },
    });
    for (const sh of sheets) {
      const hrs = Math.max(sh.workedMinutes, sh.shiftMinutes) / 60;
      // Only add if no staff shifts recorded (avoid double count)
      if (!map.has(sh.trainerId)) {
        map.set(sh.trainerId, hrs);
      } else {
        // already have roster hours
      }
    }
    return map;
  }

  private async collectRemarks(clubId: string, start: Date, end: Date) {
    const remarks = await this.prisma.sessionRemark.findMany({
      where: {
        clubId,
        OR: [
          { createdAt: { gte: start, lte: end } },
          { status: SessionRemarkStatus.OPEN },
        ],
      },
      select: {
        staffId: true,
        adminId: true,
        status: true,
        closedAt: true,
        createdAt: true,
      },
    });
    const map = new Map<
      string,
      { open: number; opened: number; closed: number }
    >();
    const bump = (id: string | null | undefined, field: 'open' | 'opened' | 'closed') => {
      if (!id) return;
      const cur = map.get(id) ?? { open: 0, opened: 0, closed: 0 };
      cur[field]++;
      map.set(id, cur);
    };
    for (const r of remarks) {
      if (r.status === SessionRemarkStatus.OPEN) bump(r.staffId, 'open');
      if (r.createdAt >= start && r.createdAt <= end) bump(r.staffId, 'opened');
      if (r.closedAt && r.closedAt >= start && r.closedAt <= end) {
        bump(r.adminId, 'closed');
      }
    }
    return map;
  }

  private async collectPay(clubId: string, from: string, to: string) {
    const summary = await this.payroll.getClubSummary(clubId, from, to);
    const map = new Map<
      string,
      StaffPayColumns & { openExceptions: number; motivationMinor: number }
    >();
    for (const section of summary.sections) {
      for (const r of section.rows) {
        map.set(r.userId, {
          totalEarnedMinor: r.totalEarnedMinor,
          advancePaidMinor: r.advancePaidMinor,
          settlementPaidMinor: r.settlementPaidMinor,
          periodPaidTotalMinor: r.periodPaidTotalMinor,
          toPayMinor: r.toPayMinor,
          baseSalaryMinor: r.baseSalaryMinor,
          motivationMinor: r.motivationMinor,
          bonusMinor: r.bonusMinor,
          fineMinor: r.fineMinor,
          openExceptions: r.openExceptions,
        });
      }
    }
    return map;
  }

  private async collectAdminKpis(
    clubId: string,
    staff: StaffUser[],
    start: Date,
    end: Date,
    from: string,
    to: string,
  ) {
    const admins = staff.filter((s) =>
      s.roles.some((r) => r.role === Role.ADMIN || r.role === Role.MANAGER),
    );
    const adminIds = new Set(admins.map((a) => a.id));
    const map = new Map<string, StaffDepartmentKpi>();

    const [tasks, groupApprovals, sessionApprovals, remarks] = await Promise.all([
      this.prisma.adminTask.findMany({
        where: {
          clubId,
          OR: [
            { createdAt: { gte: start, lte: end } },
            { completedAt: { gte: start, lte: end } },
            { status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] } },
          ],
        },
        select: {
          assigneeId: true,
          status: true,
          dueAt: true,
          completedAt: true,
          createdAt: true,
          stage: true,
          source: true,
        },
      }),
      this.prisma.groupClassApproval.findMany({
        where: {
          clubId,
          adminApprovedAt: { gte: start, lte: end },
        },
        select: { adminUserId: true, adminApprovedAt: true, sessionKey: true },
      }),
      this.prisma.sessionApproval.findMany({
        where: {
          clubId,
          adminApprovedAt: { gte: start, lte: end },
        },
        select: { adminApprovedById: true, adminApprovedAt: true },
      }),
      this.prisma.sessionRemark.findMany({
        where: { clubId, createdAt: { gte: start, lte: end } },
        select: { staffId: true, adminId: true, status: true, closedAt: true },
      }),
    ]);

    // Sales from payroll summary (cheap reuse)
    let paySummary: Awaited<ReturnType<PayrollService['getClubSummary']>> | null =
      null;
    try {
      paySummary = await this.payroll.getClubSummary(clubId, from, to);
    } catch {
      paySummary = null;
    }
    const salesByUser = new Map<
      string,
      {
        membershipMinor: number;
        spaMinor: number;
        shopMinor: number;
        corporateMinor: number;
        totalMinor: number;
      }
    >();
    if (paySummary) {
      for (const section of paySummary.sections) {
        for (const r of section.rows) {
          if (!adminIds.has(r.userId)) continue;
          const s = r.sales;
          salesByUser.set(r.userId, {
            membershipMinor: s?.membershipMinor ?? 0,
            spaMinor: (s?.massageMinor ?? 0) + (s?.solariumMinor ?? 0),
            shopMinor: s?.shopMinor ?? 0,
            corporateMinor: s?.corporateMinor ?? 0,
            totalMinor:
              (s?.membershipMinor ?? 0) +
              (s?.massageMinor ?? 0) +
              (s?.solariumMinor ?? 0) +
              (s?.shopMinor ?? 0) +
              (s?.corporateMinor ?? 0),
          });
        }
      }
    }

    const hours = await this.collectHours(clubId, start, end);
    const totalGroupApprovals = groupApprovals.length;
    const totalSessionApprovals = sessionApprovals.length;

    for (const admin of admins) {
      if (!admin.roles.some((r) => r.role === Role.ADMIN)) continue;
      const myTasks = tasks.filter((t) => t.assigneeId === admin.id);
      const done = myTasks.filter((t) => t.status === AdminTaskStatus.DONE);
      const overdue = myTasks.filter((t) => {
        if (
          t.status === AdminTaskStatus.DONE ||
          t.status === AdminTaskStatus.CANCELLED
        ) {
          return Boolean(
            t.dueAt && t.completedAt && t.completedAt > t.dueAt,
          );
        }
        return Boolean(t.dueAt && t.dueAt < end);
      }).length;
      const closeHours = done
        .filter((t) => t.completedAt)
        .map(
          (t) =>
            (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000,
        )
        .sort((a, b) => a - b);
      const medianCloseHours =
        closeHours.length > 0
          ? closeHours[Math.floor(closeHours.length / 2)]!
          : null;

      const renewalFunnel: Record<string, number> = {};
      for (const t of myTasks.filter((x) => x.source === 'MEMBERSHIP_EXPIRING')) {
        const st = t.stage ?? 'NEW';
        renewalFunnel[st] = (renewalFunnel[st] ?? 0) + 1;
      }

      const gAppr = groupApprovals.filter((a) => a.adminUserId === admin.id)
        .length;
      const sAppr = sessionApprovals.filter(
        (a) => a.adminApprovedById === admin.id,
      ).length;
      const totalAppr = totalGroupApprovals + totalSessionApprovals;
      const myAppr = gAppr + sAppr;

      const sales = salesByUser.get(admin.id) ?? {
        membershipMinor: 0,
        spaMinor: 0,
        shopMinor: 0,
        corporateMinor: 0,
        totalMinor: 0,
      };
      const hrs = hours.get(admin.id) ?? 0;

      map.set(admin.id, {
        kind: 'ADMIN',
        salesBySegment: sales,
        salesPerHourMinor:
          hrs > 0 ? Math.round(sales.totalMinor / hrs) : null,
        tasksAssigned: myTasks.length,
        tasksDone: done.length,
        tasksDonePct:
          myTasks.length > 0
            ? Math.round((done.length / myTasks.length) * 100)
            : 0,
        tasksOverdue: overdue,
        medianCloseHours:
          medianCloseHours != null
            ? Math.round(medianCloseHours * 10) / 10
            : null,
        renewalFunnel,
        bookingApprovalsGroup: gAppr,
        bookingApprovalsSession: sAppr,
        attendanceMarks: 0,
        remarksOpened: remarks.filter((r) => r.staffId === admin.id).length,
        remarksClosed: remarks.filter(
          (r) =>
            r.adminId === admin.id &&
            r.status !== SessionRemarkStatus.OPEN,
        ).length,
        approvalSharePct:
          totalAppr > 0 ? Math.round((myAppr / totalAppr) * 1000) / 10 : null,
        avgApprovalLagHours: null,
      });
    }
    return map;
  }

  private async collectGroupTrainerKpis(
    clubId: string,
    staff: StaffUser[],
    start: Date,
    end: Date,
  ) {
    const trainers = staff.filter(
      (s) =>
        s.roles.some((r) => r.role === Role.TRAINER) && s.groupPrograms,
    );
    const byExternal = new Map<string, string>();
    for (const t of trainers) {
      if (t.externalId) byExternal.set(t.externalId, t.id);
    }

    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        isActive: true,
        kind: OnexClassKind.GROUP,
        startAt: { gte: start, lte: end },
      },
      select: {
        employeeExternalId: true,
        status: true,
        title: true,
        attendedCount: true,
        bookedCount: true,
        externalId: true,
        members: {
          select: { attendance: true, cancelled: true },
        },
      },
    });
    const slots = await this.prisma.clubScheduleSlot.findMany({
      where: { clubId, startAt: { gte: start, lte: end } },
      select: { externalId: true, capacity: true },
    });
    const cap = new Map(slots.map((s) => [s.externalId, s.capacity]));

    const map = new Map<string, StaffDepartmentKpi>();
    const buckets = new Map<
      string,
      {
        sessions: typeof sessions;
      }
    >();
    for (const s of sessions) {
      const uid = s.employeeExternalId
        ? byExternal.get(s.employeeExternalId)
        : undefined;
      if (!uid) continue;
      const b = buckets.get(uid) ?? { sessions: [] };
      b.sessions.push(s);
      buckets.set(uid, b);
    }

    for (const t of trainers) {
      const list = buckets.get(t.id)?.sessions ?? [];
      const completed = list.filter(
        (s) => s.status === OnexClassStatus.COMPLETED,
      );
      const cancelled = list.filter(
        (s) => s.status === OnexClassStatus.CANCELLED,
      ).length;
      let attendedSum = 0;
      let fillSum = 0;
      let fillN = 0;
      let booked = 0;
      let memberCancelled = 0;
      let noShow = 0;
      const byTitle = new Map<string, number>();
      for (const s of completed) {
        attendedSum += s.attendedCount;
        booked += s.bookedCount;
        const c = cap.get(s.externalId) ?? 0;
        if (c > 0) {
          fillSum += (s.attendedCount / c) * 100;
          fillN++;
        }
        byTitle.set(s.title, (byTitle.get(s.title) ?? 0) + 1);
        for (const m of s.members) {
          if (m.cancelled || m.attendance === OnexClassMemberAttendance.CANCELLED) {
            memberCancelled++;
          }
          if (m.attendance === OnexClassMemberAttendance.NO_SHOW) noShow++;
        }
      }
      const memberTotal = completed.reduce((a, s) => a + s.members.length, 0);
      const topDirections = [...byTitle.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([title, count]) => ({ title, count }));

      map.set(t.id, {
        kind: 'GROUP_TRAINER',
        sessionsConducted: completed.length,
        avgAttendees:
          completed.length > 0
            ? Math.round((attendedSum / completed.length) * 10) / 10
            : 0,
        avgFillPct: fillN > 0 ? Math.round(fillSum / fillN) : null,
        cancelRatePct:
          booked + memberCancelled > 0
            ? Math.round(
                (memberCancelled / Math.max(booked, memberTotal, 1)) * 1000,
              ) / 10
            : null,
        noShowPct:
          memberTotal > 0
            ? Math.round((noShow / memberTotal) * 1000) / 10
            : null,
        cancelledSessions: cancelled,
        topDirections,
      });
    }
    return map;
  }

  private async collectPtTrainerKpis(
    clubId: string,
    staff: StaffUser[],
    start: Date,
    end: Date,
    from: string,
    to: string,
  ) {
    const trainers = staff.filter(
      (s) =>
        s.roles.some((r) => r.role === Role.TRAINER) &&
        (s.trainerStaff || s.trainerClub || !s.groupPrograms),
    );
    // Also include groupPrograms trainers who also do PT
    const ptTrainers = staff.filter(
      (s) =>
        s.roles.some((r) => r.role === Role.TRAINER) &&
        (s.trainerStaff || s.trainerClub),
    );
    const all = new Map<string, StaffUser>();
    for (const t of [...trainers, ...ptTrainers]) all.set(t.id, t);

    const trainerIds = [...all.keys()];
    const map = new Map<string, StaffDepartmentKpi>();
    if (!trainerIds.length) return map;

    // All PT for these trainers (need history for first-session detection)
    const historyStart = addDaysIso(from, -150);
    const historyStartDate = rangeBounds(historyStart, to).start;
    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: { in: trainerIds },
        status: {
          in: [PersonalBookingStatus.COMPLETED, PersonalBookingStatus.CONFIRMED],
        },
        startAt: { gte: historyStartDate, lte: end },
      },
      select: {
        trainerId: true,
        clientId: true,
        startAt: true,
        status: true,
        isComplimentary: true,
        payKind: true,
      },
      orderBy: { startAt: 'asc' },
    });

    const sales = await this.prisma.trainerPtSale.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: start, lte: end },
      },
      select: { employeeCode: true, amount: true },
    });
    const salesByCode = new Map<string, number>();
    for (const s of sales) {
      if (!s.employeeCode) continue;
      salesByCode.set(
        s.employeeCode,
        (salesByCode.get(s.employeeCode) ?? 0) +
          Math.round((Number(s.amount) || 0) * 100),
      );
    }

    const firstByPair = new Map<string, Date>();
    for (const b of bookings) {
      const key = `${b.trainerId}:${b.clientId}`;
      if (!firstByPair.has(key)) firstByPair.set(key, b.startAt);
    }

    const cohortFrom = addDaysIso(from, -150);
    const cohortTo = addDaysIso(to, -60);

    for (const t of all.values()) {
      const mine = bookings.filter((b) => b.trainerId === t.id);
      const inPeriod = mine.filter(
        (b) =>
          b.startAt >= start &&
          b.startAt <= end &&
          b.status === PersonalBookingStatus.COMPLETED,
      );
      const gift = inPeriod.filter(
        (b) => b.isComplimentary || b.payKind === PtSessionPayKind.GIFT,
      ).length;
      const paid = inPeriod.filter(
        (b) =>
          !b.isComplimentary &&
          b.payKind !== PtSessionPayKind.GIFT &&
          (b.payKind === PtSessionPayKind.PAID ||
            b.payKind === PtSessionPayKind.BLOCK ||
            b.payKind === PtSessionPayKind.UNKNOWN),
      ).length;

      // New clients: first PT of pair falls in period
      const newClientIds: string[] = [];
      for (const [key, first] of firstByPair) {
        if (!key.startsWith(`${t.id}:`)) continue;
        if (first >= start && first <= end) {
          newClientIds.push(key.slice(t.id.length + 1));
        }
      }

      let converted = 0;
      for (const clientId of newClientIds) {
        const first = firstByPair.get(`${t.id}:${clientId}`)!;
        const windowEnd = new Date(first.getTime() + 30 * 86400000);
        const hasPaid = mine.some(
          (b) =>
            b.clientId === clientId &&
            b.startAt > first &&
            b.startAt <= windowEnd &&
            b.status === PersonalBookingStatus.COMPLETED &&
            !b.isComplimentary &&
            b.payKind !== PtSessionPayKind.GIFT,
        );
        if (hasPaid) converted++;
      }
      const conversionPct =
        newClientIds.length > 0
          ? Math.round((converted / newClientIds.length) * 1000) / 10
          : null;

      // Retention 90d cohort: first PT between cohortFrom..cohortTo
      const cohortClients: string[] = [];
      const cohortStart = rangeBounds(cohortFrom, cohortTo).start;
      const cohortEnd = rangeBounds(cohortFrom, cohortTo).end;
      for (const [key, first] of firstByPair) {
        if (!key.startsWith(`${t.id}:`)) continue;
        if (first >= cohortStart && first <= cohortEnd) {
          cohortClients.push(key.slice(t.id.length + 1));
        }
      }
      let retained = 0;
      for (const clientId of cohortClients) {
        const first = firstByPair.get(`${t.id}:${clientId}`)!;
        const winStart = new Date(first.getTime() + 60 * 86400000);
        const winEnd = new Date(first.getTime() + 90 * 86400000);
        const has = mine.some(
          (b) =>
            b.clientId === clientId &&
            b.startAt >= winStart &&
            b.startAt <= winEnd &&
            b.status === PersonalBookingStatus.COMPLETED,
        );
        if (has) retained++;
      }
      const retention90Pct =
        cohortClients.length > 0
          ? Math.round((retained / cohortClients.length) * 1000) / 10
          : null;

      const activeSince = new Date(end.getTime() - 30 * 86400000);
      const activeClients30d = new Set(
        mine
          .filter(
            (b) =>
              b.startAt >= activeSince &&
              b.startAt <= end &&
              b.status === PersonalBookingStatus.COMPLETED,
          )
          .map((b) => b.clientId),
      ).size;

      map.set(t.id, {
        kind: 'PT_TRAINER',
        sessionsConducted: inPeriod.length,
        paidSessions: paid,
        giftSessions: gift,
        newClients: newClientIds.length,
        conversionPct,
        retention90Pct,
        retentionCohortFrom: cohortClients.length ? cohortFrom : null,
        retentionCohortTo: cohortClients.length ? cohortTo : null,
        activeClients30d,
        ptSalesMinor: t.employeeCode
          ? (salesByCode.get(t.employeeCode) ?? 0)
          : 0,
      });
    }
    return map;
  }

  private async collectSpaKpis(
    clubId: string,
    staff: StaffUser[],
    start: Date,
    end: Date,
    from: string,
    to: string,
  ) {
    const specialists = staff.filter((s) =>
      s.roles.some((r) => r.role === Role.SPECIALIST),
    );
    const map = new Map<string, StaffDepartmentKpi>();
    if (!specialists.length) return map;

    const historyStart = rangeBounds(addDaysIso(from, -60), to).start;
    const bookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: { in: specialists.map((s) => s.id) },
        status: SpaBookingStatus.COMPLETED,
        startAt: { gte: historyStart, lte: end },
      },
      select: {
        specialistId: true,
        clientId: true,
        clientExternalId: true,
        guestPhone: true,
        startAt: true,
        paymentType: true,
        partnerSource: true,
        priceMinor: true,
      },
      orderBy: { startAt: 'asc' },
    });

    const clientKey = (b: (typeof bookings)[0]) =>
      b.clientId ??
      b.clientExternalId ??
      (b.guestPhone ? `phone:${b.guestPhone}` : null);

    for (const sp of specialists) {
      const mine = bookings.filter((b) => b.specialistId === sp.id);
      const inPeriod = mine.filter((b) => b.startAt >= start && b.startAt <= end);

      let quota = 0;
      let paid = 0;
      let allsports = 0;
      let unknown = 0;
      let paidRevenue = 0;
      for (const b of inPeriod) {
        const ps = (b.partnerSource ?? '').toUpperCase();
        if (ps.includes('ALLSPORT')) {
          allsports++;
        } else if (b.paymentType === SpaPaymentType.QUOTA) {
          quota++;
        } else if (b.paymentType === SpaPaymentType.PAID) {
          paid++;
          paidRevenue += b.priceMinor ?? 0;
        } else {
          unknown++;
        }
      }

      const firstByClient = new Map<string, Date>();
      for (const b of mine) {
        const key = clientKey(b);
        if (!key) continue;
        if (!firstByClient.has(key)) firstByClient.set(key, b.startAt);
      }
      const newClients: string[] = [];
      for (const [key, first] of firstByClient) {
        if (first >= start && first <= end) newClients.push(key);
      }
      let repeats = 0;
      for (const key of newClients) {
        const first = firstByClient.get(key)!;
        const winEnd = new Date(first.getTime() + 60 * 86400000);
        const has = mine.some((b) => {
          const ck = clientKey(b);
          return (
            ck === key &&
            b.startAt > first &&
            b.startAt <= winEnd
          );
        });
        if (has) repeats++;
      }

      map.set(sp.id, {
        kind: 'SPECIALIST',
        servicesTotal: inPeriod.length,
        quotaCount: quota,
        paidCount: paid,
        allsportsCount: allsports,
        unknownPayCount: unknown,
        newClients: newClients.length,
        repeatPct:
          newClients.length > 0
            ? Math.round((repeats / newClients.length) * 1000) / 10
            : null,
        paidRevenueMinor: paidRevenue,
      });
    }
    return map;
  }

  private async collectTechKpis(
    clubId: string,
    staff: StaffUser[],
    start: Date,
    end: Date,
  ) {
    const tech = staff.filter((s) => s.roles.some((r) => r.role === Role.TECH));
    const map = new Map<string, StaffDepartmentKpi>();
    if (!tech.length) return map;

    const shifts = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        track: StaffShiftTrack.TECH,
        date: { gte: start, lte: end },
        userId: { in: tech.map((t) => t.id) },
      },
      select: { userId: true, overtimeMinutes: true },
    });
    for (const t of tech) {
      const mine = shifts.filter((s) => s.userId === t.id);
      map.set(t.id, {
        kind: 'TECH',
        shifts: mine.length,
        overtimeMinutes: mine.reduce((a, s) => a + (s.overtimeMinutes ?? 0), 0),
      });
    }
    return map;
  }

  private async buildManagerEfficiency(
    user: JwtPayload,
    clubId: string,
    from: string,
    to: string,
    rows: StaffKpiRow[],
  ): Promise<ManagerEfficiencyBlock> {
    const clubReport = await this.clubAnalytics.getClubReport(user, {
      from,
      to,
      compare: 'prev',
      includePay: true,
    });

    const pendingGroup = await this.prisma.onexClassSession.count({
      where: {
        clubId,
        isActive: true,
        kind: OnexClassKind.GROUP,
        status: OnexClassStatus.COMPLETED,
        startAt: { gte: rangeBounds(from, to).start, lte: rangeBounds(from, to).end },
        // rough: sessions without admin approval — left as count of completed
      },
    });
    const approvals = await this.prisma.groupClassApproval.count({
      where: {
        clubId,
        OR: [
          { adminApprovedAt: { not: null } },
          { overrideApprovedAt: { not: null } },
        ],
        createdAt: {
          gte: rangeBounds(from, to).start,
          lte: rangeBounds(from, to).end,
        },
      },
    });
    const openBookingControl = Math.max(0, pendingGroup - approvals);

    const openRemarks = await this.prisma.sessionRemark.count({
      where: { clubId, status: SessionRemarkStatus.OPEN },
    });
    const payrollExceptions = rows.reduce((a, r) => a + r.openExceptions, 0);

    const adminRows = rows.filter((r) => r.kpi.kind === 'ADMIN');
    const tasksDone = adminRows.reduce(
      (a, r) => a + (r.kpi.kind === 'ADMIN' ? r.kpi.tasksDone : 0),
      0,
    );
    const tasksAssigned = adminRows.reduce(
      (a, r) => a + (r.kpi.kind === 'ADMIN' ? r.kpi.tasksAssigned : 0),
      0,
    );
    const adminTasksDonePct =
      tasksAssigned > 0
        ? Math.round((tasksDone / tasksAssigned) * 100)
        : null;

    const revDelta = clubReport.money.revenue.deltaPct;
    const renewal = clubReport.members.renewalRate.value;
    const churn = clubReport.members.churn.value;
    const fotShare = clubReport.fot?.fotShareOfRevenuePct.value ?? null;

    const indicators: ManagerEfficiencyBlock['indicators'] = [
      {
        id: 'revenue',
        label: 'Выручка',
        status:
          revDelta == null
            ? 'yellow'
            : revDelta >= 0
              ? 'green'
              : revDelta > -10
                ? 'yellow'
                : 'red',
        value: clubReport.money.revenue.value / 100,
        compareValue: (clubReport.money.revenue.compareValue ?? 0) / 100,
        hint: revDelta != null ? `${revDelta > 0 ? '+' : ''}${revDelta}%` : undefined,
      },
      {
        id: 'renewal',
        label: '% продлений',
        status: renewal >= 60 ? 'green' : renewal >= 40 ? 'yellow' : 'red',
        value: renewal,
        hint: 'Цель ≥ 60%',
      },
      {
        id: 'churn',
        label: 'Отток',
        status: churn <= 5 ? 'green' : churn <= 15 ? 'yellow' : 'red',
        value: churn,
      },
      {
        id: 'fot',
        label: 'ФОТ / выручка',
        status:
          fotShare == null
            ? 'yellow'
            : fotShare <= 40
              ? 'green'
              : fotShare <= 55
                ? 'yellow'
                : 'red',
        value: fotShare ?? '—',
        hint: 'Ориентир ≤ 40%',
      },
      {
        id: 'booking_control',
        label: 'Очередь контроля',
        status:
          openBookingControl <= 5
            ? 'green'
            : openBookingControl <= 20
              ? 'yellow'
              : 'red',
        value: openBookingControl,
      },
      {
        id: 'tasks',
        label: 'Задачи админов',
        status:
          adminTasksDonePct == null
            ? 'yellow'
            : adminTasksDonePct >= 80
              ? 'green'
              : adminTasksDonePct >= 60
                ? 'yellow'
                : 'red',
        value: adminTasksDonePct ?? '—',
      },
      {
        id: 'remarks',
        label: 'Открытые замечания',
        status:
          openRemarks === 0 ? 'green' : openRemarks <= 5 ? 'yellow' : 'red',
        value: openRemarks,
      },
      {
        id: 'exceptions',
        label: 'Исключения ЗП',
        status:
          payrollExceptions === 0
            ? 'green'
            : payrollExceptions <= 3
              ? 'yellow'
              : 'red',
        value: payrollExceptions,
      },
    ];

    return {
      indicators,
      openBookingControl,
      oldestPendingApprovalHours: null,
      adminTasksDonePct,
      openRemarks,
      payrollExceptions,
    };
  }
}
