/** Super-admin «Нестыковки» — shared DTOs. */

export type DiscrepancyTab = 'segments' | 'sales' | 'spa' | 'gp' | 'pt';

export type DiscrepancyProductStatus =
  | 'OK'
  | 'GUESSED'
  | 'UNASSIGNED'
  | 'CONFLICT';

export type DiscrepancySegmentKey =
  | 'membership'
  | 'spa'
  | 'shop'
  | 'solarium'
  | 'training';

export type BookingControlFlag = 'EXPIRING_PACKAGE' | 'LATE_ADD';

export interface DiscrepancyEmployeeOption {
  id: string;
  name: string;
  count: number;
}

export interface DiscrepancySummary {
  from: string;
  to: string;
  segments: number;
  sales: number;
  spa: number;
  gp: number;
  pt: number;
}

export interface DiscrepancySegmentBucket {
  key: DiscrepancySegmentKey;
  title: string;
  items: number;
  salesCount: number;
  amount: number;
}

export interface DiscrepancySegmentProduct {
  itemKey: string;
  fingerprint: string;
  name: string;
  uuid?: string | null;
  code?: string | null;
  groupName?: string | null;
  oneCSaleType?: string | null;
  status: DiscrepancyProductStatus;
  currentBucket: string;
  matchedSegments: DiscrepancySegmentKey[];
  suggestedSegment?: DiscrepancySegmentKey | null;
  salesCount: number;
  amount: number;
  sellers: Array<{ id: string; name: string; count: number }>;
  lastSoldAt: string | null;
  acked?: boolean;
  ackNote?: string | null;
}

export interface DiscrepancyMissingEmployee {
  externalId: string;
  name: string;
  salesCount: number;
  sessionsCount: number;
}

export interface DiscrepancySegmentsResponse {
  from: string;
  to: string;
  segments: DiscrepancySegmentBucket[];
  problems: {
    unassigned: number;
    guessed: number;
    conflict: number;
  };
  products: DiscrepancySegmentProduct[];
  missingEmployees: DiscrepancyMissingEmployee[];
  employees: DiscrepancyEmployeeOption[];
}

export interface DiscrepancySalesDay {
  itemKey: string;
  fingerprint: string;
  acked?: boolean;
  date: string;
  kassaCash: number;
  oneCCash: number;
  kassaCard: number;
  oneCCard: number;
  diffCash: number;
  diffCard: number;
}

/** One nomenclature line of a 1C sale document (mixed sales have several). */
export interface DiscrepancySaleLine {
  productName: string;
  segment: DiscrepancySegmentKey | null;
  amount: number;
}

export interface DiscrepancyNearestOneC {
  documentId: string | null;
  occurredAt: string;
  amount: number;
  diff: number;
  lines: DiscrepancySaleLine[];
}

export interface DiscrepancyUnmatchedKassa {
  itemKey: string;
  fingerprint: string;
  receiptId: string;
  occurredAt: string;
  amount: number;
  cash: number;
  cashless: number;
  cashier?: string | null;
  receiptType: string;
  /** Closest unmatched 1C payment in the time window (hint for manual check). */
  nearestOneC?: DiscrepancyNearestOneC | null;
  acked?: boolean;
}

export interface DiscrepancyUnmatchedOneC {
  itemKey: string;
  fingerprint: string;
  externalId: string;
  documentId?: string | null;
  occurredAt: string;
  amount: number;
  cash: number;
  card: number;
  /** Joined line names (back-compat). */
  productName?: string | null;
  lines: DiscrepancySaleLine[];
  clientName?: string | null;
  employeeName?: string | null;
  acked?: boolean;
}

export interface DiscrepancySalesResponse {
  from: string;
  to: string;
  days: DiscrepancySalesDay[];
  unmatchedKassa: DiscrepancyUnmatchedKassa[];
  unmatchedOneC: DiscrepancyUnmatchedOneC[];
  oneCCashless: number;
  oneCPersonalAccount: number;
  problemDays: number;
  matchedCount: number;
  /** Matched cheques whose 1C document has 2+ nomenclature lines. */
  mixedMatched: number;
  /** Matched by combining several 1C payments / several cheques. */
  combinedMatched: number;
  webkassa: {
    lastSuccessAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastCount: number;
  };
  employees: DiscrepancyEmployeeOption[];
}

/** One SPA/PT session with expiring-package write-offs. */
export interface DiscrepancySpaPtSessionRow {
  sessionKey: string;
  startAt: string;
  title: string;
  clientNames: string[];
  writeOffCount: number;
  redCount: number;
  approximate?: boolean;
}

export interface DiscrepancyPerformerRow {
  /** `perf:{performerId}:{from}:{to}` — scoped to the viewed period. */
  itemKey: string;
  fingerprint: string;
  acked?: boolean;
  /** Stable key (1C employee code or name) — used by the employee filter. */
  performerId: string;
  /** FitGO user id for review-queue deep links; null when staff not linked. */
  performerUserId?: string | null;
  performerName: string;
  count: number;
  redCount: number;
  approximate?: boolean;
  sessions: DiscrepancySpaPtSessionRow[];
}

export interface DiscrepancySpaPtResponse {
  from: string;
  to: string;
  performers: DiscrepancyPerformerRow[];
  total: number;
  redTotal: number;
  employees: DiscrepancyEmployeeOption[];
}

export interface DiscrepancyGroupSessionRow {
  itemKey: string;
  fingerprint: string;
  acked?: boolean;
  sessionKey: string;
  startAt: string;
  title: string;
  bookedAtStart: number;
  confirmed: number;
  lateAdds: number;
  duringAdds: number;
  approximate?: boolean;
}

export interface DiscrepancyGroupPerformer {
  performerId: string;
  performerUserId?: string | null;
  performerName: string;
  lateAddCount: number;
  sessions: DiscrepancyGroupSessionRow[];
}

export interface DiscrepancyTrustException {
  id: string;
  title: string;
  performerName: string;
  startAt: string;
  trustBand: string;
  baselineCount: number;
  attendedCount: number;
  trustReasons: string[];
}

export interface DiscrepancyGroupResponse {
  from: string;
  to: string;
  performers: DiscrepancyGroupPerformer[];
  lateAddTotal: number;
  trustExceptions: DiscrepancyTrustException[];
  employees: DiscrepancyEmployeeOption[];
}

export const DISCREPANCY_SEGMENT_TITLES: Record<DiscrepancySegmentKey, string> =
  {
    membership: 'Абонементы',
    spa: 'SPA',
    shop: 'Магазин',
    solarium: 'Солярий',
    training: 'Тренировки',
  };

// ─── Tasks from «Нестыковки» ────────────────────────────────────────────────

export const DISCREPANCY_TAB_TITLES: Record<DiscrepancyTab, string> = {
  segments: 'Сегменты',
  sales: 'Касса',
  spa: 'SPA',
  gp: 'ГП',
  pt: 'ПТ',
};

/** Who gets an auto task. Manual tasks pick a concrete `user:` / `dept:` value. */
export type DiscrepancyAssignMode =
  | 'LAST_SHIFT'
  | 'ON_SHIFT'
  | 'ADMINS'
  | 'PERFORMER'
  | 'USER';

export type DiscrepancyTaskDept =
  | 'ON_SHIFT'
  | 'ADMINS'
  | 'TRAINERS_GP'
  | 'TRAINERS_PT'
  | 'SPECIALISTS';

export const DISCREPANCY_DEPT_LABELS: Record<DiscrepancyTaskDept, string> = {
  ON_SHIFT: 'Администраторы на смене',
  ADMINS: 'Все администраторы',
  TRAINERS_GP: 'Тренеры ГП',
  TRAINERS_PT: 'Тренеры ПТ',
  SPECIALISTS: 'SPA-специалисты',
};

export const DISCREPANCY_ASSIGN_MODE_LABELS: Record<
  DiscrepancyAssignMode,
  string
> = {
  LAST_SHIFT: 'Последний админ на смене',
  ON_SHIFT: 'Все админы на смене',
  ADMINS: 'Все администраторы',
  PERFORMER: 'Сам тренер / специалист',
  USER: 'Конкретный сотрудник',
};

/** Departments shown when creating a manual task on this tab. */
export const DISCREPANCY_TAB_DEPTS: Record<
  DiscrepancyTab,
  DiscrepancyTaskDept[]
> = {
  sales: ['ON_SHIFT', 'ADMINS'],
  spa: ['SPECIALISTS', 'ADMINS'],
  pt: ['TRAINERS_PT', 'ADMINS'],
  gp: ['TRAINERS_GP', 'ADMINS'],
  segments: ['ADMINS'],
};

/** Fallback department when the performer has no FitGO login. */
export function discrepancyTabDept(
  tab: DiscrepancyTab,
): DiscrepancyTaskDept | null {
  if (tab === 'spa') return 'SPECIALISTS';
  if (tab === 'pt') return 'TRAINERS_PT';
  if (tab === 'gp') return 'TRAINERS_GP';
  if (tab === 'sales' || tab === 'segments') return 'ADMINS';
  return null;
}

export interface DiscrepancyTaskStaff {
  id: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'TRAINER' | 'SPECIALIST';
}

export interface DiscrepancyTaskOptions {
  staff: DiscrepancyTaskStaff[];
  /** Departments relevant to the current tab. */
  depts: DiscrepancyTaskDept[];
  /** Preselected `user:{id}` or `dept:{code}`. */
  suggested: string;
  /** Why it was preselected, e.g. «последняя на смене до 22:00». */
  suggestedReason: string;
}

export interface DiscrepancyTaskLink {
  tab: DiscrepancyTab;
  itemKey: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
  assignees: string[];
  auto: boolean;
  createdAt: string;
}

export interface DiscrepancyTaskCreateBody {
  tab: DiscrepancyTab;
  itemKey: string;
  fingerprint: string;
  /** `user:{id}` or `dept:{DiscrepancyTaskDept}`. */
  assignee: string;
  title: string;
  description?: string;
  dueHours?: number;
  /** Club day of the problem (shift lookup for dept:ON_SHIFT). */
  date?: string;
}

export interface DiscrepancyTaskRuleDto {
  tab: DiscrepancyTab;
  enabled: boolean;
  threshold: number;
  scope: string;
  assignTo: DiscrepancyAssignMode;
  assigneeId?: string | null;
  dueHours: number;
  lookbackDays: number;
}

export interface DiscrepancyAutoRunResult {
  created: number;
  skipped: number;
  byTab: Partial<Record<DiscrepancyTab, number>>;
}

export type DiscrepancyTaskSubject =
  | {
      kind: 'salesDay';
      date: string;
      diffCash: number;
      diffCard: number;
      kassaCash: number;
      oneCCash: number;
      kassaCard: number;
      oneCCard: number;
    }
  | {
      kind: 'kassa';
      at: string;
      receiptId: string;
      amount: number;
      cashier?: string | null;
    }
  | {
      kind: 'onec';
      at: string;
      amount: number;
      clientName?: string | null;
      productName?: string | null;
      employeeName?: string | null;
    }
  | {
      kind: 'performer';
      tab: 'spa' | 'pt';
      from: string;
      to: string;
      performerName: string;
      count: number;
      redCount: number;
    }
  | {
      kind: 'session';
      at: string;
      title: string;
      performerName: string;
      lateAdds: number;
      bookedAtStart: number;
      confirmed: number;
    }
  | {
      kind: 'product';
      name: string;
      status: DiscrepancyProductStatus;
      salesCount: number;
      amount: number;
    };

function ddmm(iso: string) {
  const d = iso.slice(0, 10);
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}

/** Club wall clock HH:MM (Europe/Minsk, UTC+3). */
function hhmm(iso: string) {
  const t = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  return t.toISOString().slice(11, 16);
}

function byn(n: number) {
  return `${n.toFixed(2).replace('.', ',')} BYN`;
}

/** Club day YYYY-MM-DD of an instant (Europe/Minsk). */
export function discrepancyClubDay(iso: string) {
  return new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Default task text: «дата · проблема» + what to check. */
export function discrepancyTaskText(s: DiscrepancyTaskSubject): {
  title: string;
  description: string;
} {
  const tail = 'Проверьте и закройте задачу с комментарием.';
  switch (s.kind) {
    case 'salesDay': {
      const parts = [
        Math.abs(s.diffCash) > 0.02 ? `нал ${byn(s.diffCash)}` : '',
        Math.abs(s.diffCard) > 0.02 ? `карта ${byn(s.diffCard)}` : '',
      ].filter(Boolean);
      return {
        title: `${ddmm(s.date)} · Касса: расхождение ${parts.join(', ') || '—'}`,
        description: [
          `Касса нал ${byn(s.kassaCash)} / 1С нал ${byn(s.oneCCash)}.`,
          `Касса карта ${byn(s.kassaCard)} / 1С карта ${byn(s.oneCCard)}.`,
          `Сверьте чеки Webkassa с оплатами в 1С. ${tail}`,
        ].join('\n'),
      };
    }
    case 'kassa':
      return {
        title: `${ddmm(discrepancyClubDay(s.at))} ${hhmm(s.at)} · Чек без оплаты в 1С: ${byn(s.amount)}`,
        description: `Чек ${s.receiptId}${s.cashier ? `, кассир ${s.cashier}` : ''}. Найдите продажу в 1С или проведите её. ${tail}`,
      };
    case 'onec':
      return {
        title: `${ddmm(discrepancyClubDay(s.at))} ${hhmm(s.at)} · Оплата 1С без чека: ${byn(s.amount)}`,
        description: `${[s.clientName, s.productName, s.employeeName].filter(Boolean).join(' · ')}. Пробит ли чек? ${tail}`,
      };
    case 'performer': {
      const period =
        s.from === s.to ? ddmm(s.from) : `${ddmm(s.from)}–${ddmm(s.to)}`;
      const label = s.tab === 'spa' ? 'SPA' : 'ПТ';
      return {
        title: `${period} · ${label}: списания с истекающих пакетов — ${s.performerName} (${s.count})`,
        description: `${s.count} списаний с пакета, до конца которого оставалось меньше 7 дней${s.redCount ? `, из них красных ${s.redCount}` : ''}. Проверьте, что занятия реально были. ${tail}`,
      };
    }
    case 'session':
      return {
        title: `${ddmm(discrepancyClubDay(s.at))} ${hhmm(s.at)} · ГП: поздние записи — ${s.title} (+${s.lateAdds})`,
        description: `${s.performerName}: на старте ${s.bookedAtStart}, факт ${s.confirmed}, добавлено после занятия ${s.lateAdds}. Проверьте журнал. ${tail}`,
      };
    case 'product':
      return {
        title: `Сегменты: «${s.name}» ${
          s.status === 'CONFLICT'
            ? 'в нескольких сегментах'
            : s.status === 'GUESSED'
              ? '— сегмент угадан'
              : 'вне сегмента'
        }`,
        description: `${s.salesCount} продаж на ${byn(s.amount)}. Добавьте номенклатуру в нужный сегмент 1С. ${tail}`,
      };
  }
}

export const DISCREPANCY_RETENTION_DAYS = 92;
export const DISCREPANCY_EXPIRING_PACKAGE_DAYS = 7;
export const DISCREPANCY_SALES_MATCH_WINDOW_MIN = 10;
/** Cheque↔1C matching report — temporarily off (heavy; day totals stay). */
export const DISCREPANCY_CHEQUE_MATCH_ENABLED = false;
