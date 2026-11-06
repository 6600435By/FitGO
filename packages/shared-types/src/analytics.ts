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
  /** Sum of bySegment amounts (before refunds). */
  segmentSumMinor: number;
  /** money-in − segmentSum; non-zero means classification gap. */
  segmentGapMinor: number;
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

/** Money filters applied to club / staff / nomenclature reports. */
export interface AnalyticsAppliedFilters {
  segment: string | null;
  employee: string | null;
  performer: string | null;
  product: string | null;
  payment: string | null;
  q: string | null;
  active: boolean;
}

export interface AnalyticsDataCoverage {
  revenueSince: string | null;
  visitsSince: string | null;
  visitsUntil: string | null;
  revenueSyncedAt: string | null;
  visitsSyncedAt: string | null;
  membersSource: 'summary' | 'snapshots' | 'none';
  membersPartial: boolean;
  compareCovered: boolean;
  compareHint?: string;
}

export interface NomenclatureProductRow {
  productExternalId: string | null;
  productName: string;
  segment: string;
  segmentLabel: string;
  amountMinor: number;
  shareOfSegment: number;
  lines: number;
  docs: number;
  avgCheckMinor: number;
  deltaPct: number | null;
  topSellers: Array<{
    employeeExternalId: string | null;
    employeeName: string;
    amountMinor: number;
  }>;
}

export interface NomenclatureSegmentBlock {
  key: string;
  label: string;
  amountMinor: number;
  share: number;
  products: NomenclatureProductRow[];
  /** Shop-only: rows beyond top-N rolled up. */
  shopRemainder?: {
    productCount: number;
    amountMinor: number;
    shareOfSegment: number;
  } | null;
  shopTopShareOfSegment?: number | null;
}

export interface NomenclatureAnalyticsReport {
  from: string;
  to: string;
  compareFrom: string;
  compareTo: string;
  compareMode: AnalyticsCompareMode;
  currency: string;
  dataSince: string | null;
  appliedFilters: AnalyticsAppliedFilters;
  coverage: AnalyticsDataCoverage;
  segments: NomenclatureSegmentBlock[];
  revenueMinor: number;
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
    /** Membership / VIP write-offs only. */
    quota: number;
    /** One-shot sales + massage blocks. */
    paid: number;
    /** Allsports БИОИМПЕДАНС only. */
    allsports: number;
    /** Could not classify payment source. */
    unknown: number;
  };
  /** Group program fill / attendance rollup for club tab. */
  groupOps?: {
    sessionsConducted: number;
    cancelledSessions: number;
    bookedTotal: number;
    attendedTotal: number;
    avgFillPct: number | null;
    attendancePct: number | null;
    noShowPct: number | null;
    cancelRatePct: number | null;
    fillUnavailable: boolean;
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
  appliedFilters?: AnalyticsAppliedFilters;
  coverage?: AnalyticsDataCoverage;
  money: ClubAnalyticsMoney;
  members: ClubAnalyticsMembers;
  visits: ClubAnalyticsVisits;
  services: ClubAnalyticsServices;
  /** Present only when includePay=true and viewer may see payroll. */
  fot?: ClubAnalyticsPayrollFot | null;
  insights: AnalyticInsight[];
  /** @deprecated Prefer trainerRankingsPt + trainerRankingsGroup. */
  trainerRankings: Array<{
    trainerId: string;
    name: string;
    score: number;
    /** Completed PT sessions (legacy name). */
    completedPt: number;
    paidPt: number;
    debtPt: number;
    activeClients: number;
    amountMinor: number;
  }>;
  /** Top PT trainers for the period. */
  trainerRankingsPt: Array<{
    trainerId: string;
    name: string;
    score: number;
    completed: number;
    paid: number;
    debt: number;
    gift: number;
    activeClients: number;
    amountMinor: number;
    giftToPaidPct?: number | null;
    ladderPercent?: number | null;
    ladderRemaining?: number | null;
    reformerPersonal?: number;
  }>;
  /** Top group-program trainers for the period. */
  trainerRankingsGroup: Array<{
    trainerId: string;
    name: string;
    score: number;
    sessions: number;
    bookedTotal: number;
    arrivedTotal: number;
    /** Mean attended/capacity × 100 for sessions with capacity > 0. */
    avgFillPct: number | null;
    cancelRatePct: number | null;
    activeClients: number;
    reformerGroup?: number;
  }>;
  /** Club-wide group programs ranked by fill (top + bottom). */
  groupPrograms?: Array<{
    title: string;
    sessions: number;
    cancelledSessions: number;
    bookedTotal: number;
    attendedTotal: number;
    uniqueClients: number;
    fillPct: number | null;
    cancelRatePct: number | null;
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

export interface GroupTrainerProgramKpi {
  title: string;
  sessionsConducted: number;
  cancelledSessions: number;
  bookedTotal: number;
  attendedTotal: number;
  /** Distinct ATTENDED clients on this program in the period. */
  uniqueClients: number;
  cancelRatePct: number | null;
  /** Mean attended/capacity × 100 when capacity known. */
  fillPct: number | null;
}

export interface GroupTrainerStaffKpi {
  kind: 'GROUP_TRAINER';
  sessionsConducted: number;
  /** Sum of bookedCount on completed sessions (1C «Записано»). */
  bookedTotal: number;
  /** Sum of attendedCount on completed sessions (confirmed arrivals). */
  attendedTotal: number;
  /** Distinct ATTENDED clients across completed group sessions in the period. */
  uniqueClients: number;
  avgAttendees: number;
  avgFillPct: number | null;
  /** attended / booked × 100 when booked > 0. */
  attendancePct?: number | null;
  cancelRatePct: number | null;
  noShowPct: number | null;
  cancelledSessions: number;
  /** Sessions per worked hour when hours known. */
  sessionsPerHour?: number | null;
  topDirections: Array<{ title: string; count: number }>;
  /** Per-program breakdown for expandable staff row. */
  programs: GroupTrainerProgramKpi[];
  /** ATTENDED members from unlimited/guest/trial memberships (Абон.). */
  abonVisits: number;
  /** ATTENDED members from visit cards / one-offs / partners (КП). */
  kpVisits: number;
  /** Share of abonVisits among attended; null when no attended members. */
  abonPct: number | null;
  /** Always 100 − abonPct when set. */
  kpPct: number | null;
}

/** Per-client PT breakdown under a trainer row (expand). */
export interface PtTrainerClientKpi {
  clientKey: string;
  name: string;
  /** Completed PT units in the period (sessions + one-shot sales). */
  sessions: number;
  paid: number;
  gift: number;
  debt: number;
  /** Sum of PT sale lines for this client in the period (minor). */
  salesMinor: number;
}

export interface PtTrainerStaffKpi {
  kind: 'PT_TRAINER';
  sessionsConducted: number;
  paidSessions: number;
  giftSessions: number;
  giftSharePct?: number | null;
  /** Distinct clients with ≥1 PT in the selected period (sessions + one-shot sales). */
  uniqueClients: number;
  newClients: number;
  /** New clients with ≥1 paid PT within 30d of first session (incl. first if paid). */
  conversionPct: number | null;
  /** Cohort: first PT 60–150d ago; share with PT in days 60–90 after first. */
  retention90Pct: number | null;
  retentionCohortFrom: string | null;
  retentionCohortTo: string | null;
  activeClients30d: number;
  ptSalesMinor: number;
  /** Sales per completed session. */
  salesPerSessionMinor?: number | null;
  /** @deprecated Not shown — kept optional for older clients. */
  sessionsPerHour?: number | null;
  /**
   * Gift clients in period who later had PAID/QUOTA PT or a training sale
   * (not the 30d new-client conversionPct).
   */
  giftToPaid?: {
    giftedClients: number;
    convertedClients: number;
    pct: number | null;
  };
  /** PT % ladder from payroll-trusted volume in the calendar month of `to`. */
  ladder?: {
    volumeCount: number;
    percent: number;
    remaining: number | null;
    isTop: boolean;
  };
  /** Completed group sessions in reformer hall. */
  reformerGroupSessions?: number;
  /** Completed personal reformer PT (title match). */
  reformerPersonalSessions?: number;
  /** Clients of this trainer in the period (sorted by sessions desc). */
  clients?: PtTrainerClientKpi[];
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
  /** Massage/SPA ClubRevenue paidAmount for performer in the period (minor). */
  paidRevenueMinor: number;
  /** Revenue per paid+block service (excludes Allsports zeros). */
  revenuePerPaidServiceMinor?: number | null;
  /** Completed services / published availability hours. */
  utilizationPct?: number | null;
  /** ATTENDED SPA members with VIP / «Все включено» payment basis (Абон.). */
  abonVisits: number;
  /** ATTENDED SPA members not on VIP (КП). */
  kpVisits: number;
  abonPct: number | null;
  kpPct: number | null;
  /** Top services by count for this specialist. */
  topServices?: Array<{ title: string; count: number; amountMinor: number }>;
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
  compareFrom?: string;
  compareTo?: string;
  compareMode?: AnalyticsCompareMode;
  currency: string;
  includePay: boolean;
  department: AnalyticsDepartment;
  appliedFilters?: AnalyticsAppliedFilters;
  coverage?: AnalyticsDataCoverage;
  rows: StaffKpiRow[];
  problemCount: number;
  achievementCount: number;
  /** Club-level indicators (SUPER_ADMIN + MANAGER; no foreign pay). */
  managerEfficiency?: ManagerEfficiencyBlock | null;
  /** Club-wide program table for GROUP_TRAINER view. */
  groupProgramsClub?: GroupTrainerProgramKpi[];
  departmentSummary?: {
    group?: {
      sessionsConducted: number;
      avgFillPct: number | null;
      attendancePct: number | null;
      cancelRatePct: number | null;
    };
    pt?: {
      sessionsConducted: number;
      giftSharePct: number | null;
      /** Sum of gift PT across trainers in the filter. */
      giftSessions?: number;
      conversionPct: number | null;
      uniqueClients: number;
    };
    spa?: {
      servicesTotal: number;
      quotaCount: number;
      paidCount: number;
      allsportsCount: number;
      unknownPayCount: number;
      repeatPct: number | null;
    };
  };
  totals: {
    staffCount: number;
    hours: number;
    totalEarnedMinor?: number;
    toPayMinor?: number;
  };
}

/** Topic keys aligned with admin task-topic display filters. */
export type AdminTaskWorkTopic =
  | 'staff_debt'
  | 'client_debt'
  | 'membership'
  | 'installment'
  | 'manager'
  | 'birthday'
  | 'confirmation'
  | 'pt_sale_check'
  | 'other';

export interface AdminTaskWorkQueueAge {
  d0_1: number;
  d2_3: number;
  d4_7: number;
  d8plus: number;
}

/** Snapshot of open queue — independent of selected period. */
export interface AdminTaskWorkSnapshot {
  open: number;
  overdue: number;
  unassigned: number;
  age: AdminTaskWorkQueueAge;
}

export interface AdminTaskWorkFlowMetrics {
  created: AnalyticMetric;
  closed: AnalyticMetric;
  onTimePct: AnalyticMetric;
  medianCloseHours: AnalyticMetric;
}

export interface AdminTaskWorkTopicRow {
  topic: AdminTaskWorkTopic;
  label: string;
  created: number;
  closed: number;
  open: number;
  overdue: number;
  onTimePct: number | null;
}

export interface AdminTaskWorkPersonTask {
  id: string;
  title: string;
  topic: AdminTaskWorkTopic;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  dueAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  overdue: boolean;
}

export interface AdminTaskWorkPersonRow {
  userId: string;
  name: string;
  /** Open + in progress assigned now. */
  openNow: number;
  overdueNow: number;
  closed: number;
  onTimePct: number | null;
  medianCloseHours: number | null;
  /** Median hours from create → first claim / IN_PROGRESS. */
  medianClaimHours: number | null;
  renewalRenewed: number;
  renewalLost: number;
  /** Closed tasks later returned for rework in period. */
  reworkCount: number;
  /** reworkCount / closed when closed > 0. */
  reworkPct: number | null;
  cancelled: number;
  /** 0–100 when closed >= 5; otherwise null («мало данных»). */
  rating: number | null;
  rank: number | null;
  openTasks: AdminTaskWorkPersonTask[];
  closedTasks: AdminTaskWorkPersonTask[];
}

/** Unassigned open queue — shown as «Очередь», excluded from rating. */
export interface AdminTaskWorkUnassignedRow {
  openNow: number;
  overdueNow: number;
  tasks: AdminTaskWorkPersonTask[];
}

/** Person × topic efficiency cell. */
export interface AdminTaskWorkMatrixCell {
  userId: string;
  topic: AdminTaskWorkTopic;
  closed: number;
  onTimePct: number | null;
  medianCloseHours: number | null;
  reworkPct: number | null;
}

export interface AdminTaskWorkReport {
  from: string;
  to: string;
  snapshot: AdminTaskWorkSnapshot;
  flow: AdminTaskWorkFlowMetrics;
  byTopic: AdminTaskWorkTopicRow[];
  byPerson: AdminTaskWorkPersonRow[];
  /** Person × topic matrix for manager control. */
  matrix: AdminTaskWorkMatrixCell[];
  unassigned: AdminTaskWorkUnassignedRow;
  /** Shown in UI so rating is transparent. */
  ratingFormula: string;
}

// ── Membership efficiency (абонементы) ──────────────────────────────────────

export type MembershipEfficiencyBasis = 'ended' | 'active';
export type MembershipEfficiencyView = 'retail' | 'cost';
export type MembershipUtilizationSegment =
  | 'max'
  | 'normal'
  | 'under'
  | 'sleeping';

/** One membership product family (VIP, Единый, …). */
export interface MembershipFamilyConfig {
  id: string;
  label: string;
  /** Case-insensitive substrings matched against productName / paymentBasis. */
  namePatterns: string[];
  /** Fallback term in months when not parsed from title. */
  defaultMonths: number;
  includesGp: boolean;
  includesGym: boolean;
  /** Massage visits included per month of term. */
  massageQuotaPerMonth: number;
  /** Solarium minutes included per month of term. */
  solariumMinutesPerMonth: number;
  /** Personal account credit per month (major currency, e.g. 16 BYN). */
  personalAccountPerMonthMajor: number;
}

export interface MembershipEconomicsSettings {
  families: MembershipFamilyConfig[];
  /** Retail price of one massage (minor). Null = derive from sales. */
  massageRetailMinor: number | null;
  /** Retail price per solarium minute (minor). */
  solariumMinuteRetailMinor: number | null;
  /** Club cost of one massage (minor). Null = SPA motivation rate. */
  massageCostMinor: number | null;
  /** Club cost per solarium minute (minor). */
  solariumMinuteCostMinor: number | null;
  /** Fraction of PA spend that is club COGS (0–1). */
  personalAccountCogsShare: number;
  /** Overhead per visit (minor), optional. */
  overheadPerVisitMinor: number;
  /** Target GP visits per week for utilization index. */
  normVisitsPerWeek: number;
  /** Utilization segment boundaries on index (visits/week ÷ norm). */
  segmentThresholds: {
    max: number;
    normal: number;
    under: number;
  };
  /** Days without visit → sleeping. */
  sleepingDays: number;
}

export interface MembershipDataQuality {
  /** Share of ATTENDED GROUP visits with packageDocId (0–1). */
  packageDocCoverage: number;
  /** Share of membership instances with a matched sale (0–1). */
  saleMatchCoverage: number;
  /** Share of VIP-like instances with PA credit found (0–1). */
  personalAccountCoverage: number;
  warning: string | null;
}

export interface MembershipPriceAllocation {
  paidMinor: number;
  personalAccountAllocatedMinor: number;
  massageAllocatedMinor: number;
  solariumAllocatedMinor: number;
  accessMinor: number;
  accessGpMinor: number;
  accessGymMinor: number;
}

export interface MembershipUsageFacts {
  gpVisits: number;
  gymVisits: number;
  massageUsed: number;
  solariumMinutesUsed: number;
  /** PA spent (positive minor). */
  personalAccountSpentMinor: number;
  /** PA burned / expired (positive minor). */
  personalAccountBurnedMinor: number;
  massageQuota: number;
  solariumMinutesQuota: number;
  personalAccountCreditedMinor: number;
}

export interface MembershipCostBreakdown {
  trainerMinor: number;
  massageMinor: number;
  solariumMinor: number;
  personalAccountCogsMinor: number;
  overheadMinor: number;
  totalMinor: number;
}

export interface MembershipFamilyRow {
  familyId: string;
  label: string;
  count: number;
  avgPaidMinor: number;
  avgMonths: number;
  avgGpPerMonth: number;
  avgGymPerMonth: number;
  avgGpCostPerVisitMinor: number | null;
  avgTrainerPerVisitMinor: number | null;
  avgMarginPerVisitMinor: number | null;
  marginPct: number | null;
  massageUsePct: number | null;
  solariumUsePct: number | null;
  personalAccountUsePct: number | null;
  burnedMinor: number;
  burnedPctOfPaid: number | null;
  /** Visits after which cumulative trainer cost exceeds GP access share. */
  breakevenVisits: number | null;
  status: 'green' | 'yellow' | 'red';
}

export interface MembershipVisitBucket {
  key: string;
  label: string;
  count: number;
  /** Inclusive min GP visits/month for this bucket. */
  minPerMonth: number;
  maxPerMonth: number | null;
}

export interface MembershipWaterfallStep {
  key: string;
  label: string;
  /** Signed delta in minor (first step = paid, then negative costs). */
  deltaMinor: number;
  runningMinor: number;
}

export interface MembershipServicePromiseRow {
  key: 'gp' | 'gym' | 'massage' | 'solarium' | 'personalAccount';
  label: string;
  promisedMinor: number;
  usedMinor: number;
  burnedMinor: number;
}

export interface MembershipEfficiencyKpis {
  avgPaidMinor: AnalyticMetric;
  avgGpPerMonth: AnalyticMetric;
  gpCostPerVisitMinor: AnalyticMetric;
  trainerPerVisitMinor: AnalyticMetric;
  marginPerVisitMinor: AnalyticMetric;
  burnedMinor: AnalyticMetric;
}

export interface MembershipEfficiencyReport {
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  view: MembershipEfficiencyView;
  currency: string;
  instanceCount: number;
  kpis: MembershipEfficiencyKpis;
  families: MembershipFamilyRow[];
  waterfall: MembershipWaterfallStep[];
  servicePromise: MembershipServicePromiseRow[];
  visitDistribution: MembershipVisitBucket[];
  /** Average breakeven GP visits (club). */
  breakevenVisits: number | null;
  insights: AnalyticInsight[];
  dataQuality: MembershipDataQuality;
  settings: MembershipEconomicsSettings;
}

export interface MembershipClassEfficiencyRow {
  title: string;
  sessions: number;
  avgAttended: number;
  avgFillPct: number | null;
  earnMinor: number;
  economicRevenueMinor: number;
  marginMinor: number;
  marginPerPersonMinor: number | null;
  belowBreakeven: boolean;
  minPeopleForBreakeven: number | null;
}

export interface MembershipTrainerEfficiencyRow {
  trainerId: string;
  name: string;
  sessions: number;
  avgAttended: number;
  avgFillPct: number | null;
  earnMinor: number;
  economicRevenueMinor: number;
  marginMinor: number;
  marginPerPersonMinor: number | null;
  belowBreakevenShare: number | null;
  classes: MembershipClassEfficiencyRow[];
}

export interface MembershipTrainersReport {
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  currency: string;
  trainers: MembershipTrainerEfficiencyRow[];
}

export interface MembershipClientRow {
  clientExternalId: string;
  clientName: string;
  familyId: string;
  familyLabel: string;
  packageDocId: string;
  productName: string;
  paidMinor: number;
  priceEstimated: boolean;
  startDate: string | null;
  endDate: string | null;
  months: number;
  gpVisits: number;
  gymVisits: number;
  gpPerMonth: number;
  segment: MembershipUtilizationSegment;
  massageUsed: number;
  massageQuota: number;
  solariumMinutesUsed: number;
  solariumMinutesQuota: number;
  personalAccountSpentMinor: number;
  personalAccountBurnedMinor: number;
  valueReceivedMinor: number;
  burnedMinor: number;
  gpCostPerVisitMinor: number | null;
  trainerCostMinor: number;
  marginMinor: number;
  lastVisitDate: string | null;
  endsWithin30d: boolean;
}

export interface MembershipClientsReport {
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  currency: string;
  total: number;
  page: number;
  pageSize: number;
  clients: MembershipClientRow[];
  bySegment: Record<MembershipUtilizationSegment, number>;
}
