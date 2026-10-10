/** Club + staff analytics reports for /super-admin/analytics. */

export type AnalyticsCompareMode = 'prev' | 'yoy' | 'custom';

export type AnalyticsDepartment =
  | 'ALL'
  | 'ADMIN'
  | 'GROUP_TRAINER'
  | 'PT_TRAINER'
  | 'SPECIALIST'
  | 'TECH'
  | 'MANAGER';

export type KpiFlagSeverity = 'problem' | 'achievement' | 'info';

export interface KpiFlag {
  id: string;
  severity: KpiFlagSeverity;
  label: string;
  reason: string;
}

/** Metric with optional comparison and sparkline points. */
export interface AnalyticMetric {
  value: number;
  compareValue?: number | null;
  deltaPct?: number | null;
  /** Chronological sparkline values (oldest → newest). */
  trend?: number[];
  unit?: 'count' | 'money' | 'percent' | 'hours';
  hint?: string;
  /** When true, UI shows «н/д» instead of the numeric value. */
  unavailable?: boolean;
}

export interface AnalyticInsight {
  severity: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  body: string;
  action?: string;
}

export interface ClubAnalyticsMoney {
  revenue: AnalyticMetric;
  byPayment: {
    cashMinor: number;
    cardMinor: number;
    cashlessMinor: number;
    personalAccountMinor: number;
    corpoMinor: number;
    otherMinor: number;
  };
  bySegment: Array<{
    key: string;
    label: string;
    amountMinor: number;
    share: number;
  }>;
  avgCheck: AnalyticMetric;
  refunds: AnalyticMetric;
  debtOutstanding: AnalyticMetric;
  /** Snapshot open debt split (not period-bound). */
  debtBreakdown: {
    clientsMinor: number;
    staffMinor: number;
  };
  /**
   * Open installment schedules from 1C Analytics `scope=installments`.
   * Snapshot (not period-bound). Null when Analytics is unavailable.
   */
  installments: {
    /** Unpaid plan amount with planDate in the current calendar month (Minsk). */
    dueThisMonthMinor: number;
    /** Sum of open installment sale totals (full schedule). */
    soldTotalMinor: number;
    /** Unpaid plan amount with planDate before today (Minsk). */
    overdueMinor: number;
  } | null;
}

export interface ClubAnalyticsMembers {
  active: AnalyticMetric;
  newClients: AnalyticMetric;
  renewals: AnalyticMetric;
  renewalRate: AnalyticMetric;
  churn: AnalyticMetric;
  frozen: AnalyticMetric;
  expiring7: AnalyticMetric;
  expiring30: AnalyticMetric;
}

export interface ClubAnalyticsVisits {
  total: AnalyticMetric;
  uniqueClients: AnalyticMetric;
  avgPerActiveMembership: AnalyticMetric;
  sleeping: AnalyticMetric;
  /** [weekday 0=Mon..6=Sun][hour 0..23] visit counts */
  heatmap: number[][];
  /** Inclusive hour range shown in UI (club working hours or hours with visits). */
  heatmapHours: { from: number; to: number };
  /** Weekday indices 0=Mon..6=Sun that have at least one open day in club hours. */
  heatmapDays: number[];
}

export interface ClubAnalyticsServices {
  group: {
    sessions: AnalyticMetric;
    avgFillPct: AnalyticMetric;
    topDirections: Array<{ title: string; sessions: number; avgAttended: number; fillPct: number }>;
    bottomDirections: Array<{ title: string; sessions: number; avgAttended: number; fillPct: number }>;
  };
  pt: {
    completed: AnalyticMetric;
    giftSharePct: AnalyticMetric;
  };
  spa: {
    completed: AnalyticMetric;
    quota: number;
    paid: number;
    allsports: number;
  };
}

export interface ClubAnalyticsPayrollFot {
  fotMinor: AnalyticMetric;
  fotShareOfRevenuePct: AnalyticMetric;
  revenuePerStaffMinor: AnalyticMetric;
}

export interface ClubAnalyticsReport {
  from: string;
  to: string;
  compareFrom: string;
  compareTo: string;
  compareMode: AnalyticsCompareMode;
  currency: string;
  /** Earliest sale/revenue cache date — renewals/new clients limited by this. */
  dataSince: string | null;
  money: ClubAnalyticsMoney;
  members: ClubAnalyticsMembers;
  visits: ClubAnalyticsVisits;
  services: ClubAnalyticsServices;
  /** Present only when includePay=true and viewer may see payroll. */
  fot?: ClubAnalyticsPayrollFot | null;
  insights: AnalyticInsight[];
  trainerRankings: Array<{
    trainerId: string;
    name: string;
    score: number;
    completedPt: number;
    paidPt: number;
    debtPt: number;
    activeClients: number;
    amountMinor: number;
  }>;
  integrationHealth?: {
    provider: string;
    clubExternalId: string | null;
    ok: boolean;
  };
}

export interface StaffPayColumns {
  totalEarnedMinor: number;
  advancePaidMinor: number;
  settlementPaidMinor: number;
  periodPaidTotalMinor: number;
  toPayMinor: number;
  baseSalaryMinor: number;
  motivationMinor: number;
  bonusMinor: number;
  fineMinor: number;
}

export interface AdminStaffKpi {
  kind: 'ADMIN';
  salesBySegment: {
    membershipMinor: number;
    spaMinor: number;
    shopMinor: number;
    corporateMinor: number;
    totalMinor: number;
  };
  salesPerHourMinor: number | null;
  tasksAssigned: number;
  tasksDone: number;
  tasksDonePct: number;
  tasksOverdue: number;
  medianCloseHours: number | null;
  renewalFunnel: Record<string, number>;
  bookingApprovalsGroup: number;
  bookingApprovalsSession: number;
  attendanceMarks: number;
  remarksOpened: number;
  remarksClosed: number;
  approvalSharePct: number | null;
  avgApprovalLagHours: number | null;
}

export interface GroupTrainerStaffKpi {
  kind: 'GROUP_TRAINER';
  sessionsConducted: number;
  avgAttendees: number;
  avgFillPct: number | null;
  cancelRatePct: number | null;
  noShowPct: number | null;
  cancelledSessions: number;
  topDirections: Array<{ title: string; count: number }>;
}

export interface PtTrainerStaffKpi {
  kind: 'PT_TRAINER';
  sessionsConducted: number;
  paidSessions: number;
  giftSessions: number;
  newClients: number;
  /** New clients with ≥1 paid PT within 30d after first session. */
  conversionPct: number | null;
  /** Cohort: first PT 60–150d ago; share with PT in days 60–90 after first. */
  retention90Pct: number | null;
  retentionCohortFrom: string | null;
  retentionCohortTo: string | null;
  activeClients30d: number;
  ptSalesMinor: number;
}

export interface SpaStaffKpi {
  kind: 'SPECIALIST';
  servicesTotal: number;
  quotaCount: number;
  paidCount: number;
  allsportsCount: number;
  unknownPayCount: number;
  newClients: number;
  /** New clients who returned within 60d. */
  repeatPct: number | null;
  paidRevenueMinor: number;
}

export interface TechStaffKpi {
  kind: 'TECH';
  shifts: number;
  overtimeMinutes: number;
}

export interface ManagerStaffKpi {
  kind: 'MANAGER';
  corporateSalesMinor: number;
  motivationSalesMinor: number;
}

export type StaffDepartmentKpi =
  | AdminStaffKpi
  | GroupTrainerStaffKpi
  | PtTrainerStaffKpi
  | SpaStaffKpi
  | TechStaffKpi
  | ManagerStaffKpi;

export interface StaffKpiRow {
  userId: string;
  name: string;
  /** 1C employee UUID or code for sales / booking-control drill-down. */
  employeeExternalId?: string | null;
  department: Exclude<AnalyticsDepartment, 'ALL'>;
  roles: string[];
  hours: number;
  openRemarks: number;
  openExceptions: number;
  flags: KpiFlag[];
  kpi: StaffDepartmentKpi;
  pay?: StaffPayColumns | null;
}

export interface ManagerEfficiencyIndicator {
  id: string;
  label: string;
  /** green | yellow | red */
  status: 'green' | 'yellow' | 'red';
  value: number | string;
  compareValue?: number | string | null;
  hint?: string;
}

export interface ManagerEfficiencyBlock {
  indicators: ManagerEfficiencyIndicator[];
  openBookingControl: number;
  oldestPendingApprovalHours: number | null;
  adminTasksDonePct: number | null;
  openRemarks: number;
  payrollExceptions: number;
}

export interface StaffAnalyticsReport {
  from: string;
  to: string;
  currency: string;
  includePay: boolean;
  department: AnalyticsDepartment;
  rows: StaffKpiRow[];
  problemCount: number;
  achievementCount: number;
  /** SUPER_ADMIN only. */
  managerEfficiency?: ManagerEfficiencyBlock | null;
  totals: {
    staffCount: number;
    hours: number;
    totalEarnedMinor?: number;
    toPayMinor?: number;
  };
}
