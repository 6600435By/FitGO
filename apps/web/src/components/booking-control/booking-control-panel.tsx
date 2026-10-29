'use client';

import {
  bookingControlIssueReasons,
  bookingControlMatchesSelectedReasons,
  bookingControlQueueSegment,
  humanDocumentNumber,
  paymentLabelRu,
  payTagLabelRu,
  type BookingControlDetail,
  type BookingControlIssueReason,
  type BookingControlKind,
  type BookingControlListItem,
  type BookingControlQueueSegment,
  type BookingControlStatus,
  type GroupApprovalNoteItem,
} from '@fitgo/shared-types';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminStickyTable } from '@/components/admin/admin-sticky-table';
import {
  ManagerReworkSheet,
  type ManagerReworkAssignee,
  type ManagerReworkTargetOption,
} from '@/components/manager-rework/manager-rework-sheet';
import { DateField } from '@/components/ui/date-field';
import { getUser } from '@/lib/auth';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { isIsoDay } from '@/lib/view-memory';
import { formatDateTime, formatVisitClock } from '@/lib/utils';

type BookingViewMem = {
  from: string;
  to: string;
  kind: string;
  status: string;
  payment: string;
  payTag: string;
  flag: string;
  performerId: string;
  /** @deprecated migrated to queue + reasons */
  needsReview?: boolean;
  queue: BookingControlQueueSegment;
  reasons: BookingControlIssueReason[];
  clientFilter: string;
  clientIdFilter: string;
};

const ISSUE_REASON_ALL: BookingControlIssueReason[] = [
  'review',
  'unpaid',
  'not1c',
  'journal',
];

function parseIssueReasons(raw: string | null | undefined): BookingControlIssueReason[] {
  if (!raw?.trim()) return [];
  const allowed = new Set<string>(ISSUE_REASON_ALL);
  const out: BookingControlIssueReason[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim().toLowerCase();
    if (allowed.has(t) && !out.includes(t as BookingControlIssueReason)) {
      out.push(t as BookingControlIssueReason);
    }
  }
  return out;
}

function formatRangeLabel(fromIso: string, toIso: string): string {
  const a = new Date(`${fromIso}T12:00:00`);
  const b = new Date(`${toIso}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${fromIso} – ${toIso}`;
  if (fromIso === toIso) {
    return a.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  const sameMonth =
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  if (sameMonth) {
    return `${a.getDate()}–${b.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    })}`;
  }
  return `${a.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })} – ${b.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
}

function chipClass(active: boolean, tone?: 'rose' | 'orange' | 'default'): string {
  const base =
    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors';
  if (!active) {
    return `${base} border border-slate-700 bg-slate-900/40 text-slate-400`;
  }
  if (tone === 'rose') {
    return `${base} bg-rose-500/20 text-rose-200 ring-1 ring-inset ring-rose-400/35`;
  }
  if (tone === 'orange') {
    return `${base} bg-orange-500/20 text-orange-200 ring-1 ring-inset ring-orange-400/35`;
  }
  return `${base} bg-fitgo-500 text-white`;
}

export type BookingControlPerformerOption = {
  id: string;
  name: string;
};

export type BookingControlApi = {
  list: (params: {
    from: string;
    to: string;
    kind?: string;
    status?: string;
    needsReview?: boolean;
    payment?: string;
    performerId?: string;
    payTag?: string;
    flag?: string;
    hall?: string;
    reformer?: string;
    client?: string;
    clientId?: string;
    notIn1c?: boolean;
    missingJournal?: boolean;
  }) => Promise<BookingControlListItem[]>;
  detail: (sessionKey: string) => Promise<BookingControlDetail>;
  openRemark: (
    sessionKey: string,
    comment: string,
    assigneeId?: string,
  ) => Promise<unknown>;
  resolveRemark?: (
    sessionKey: string,
    adminComment?: string,
  ) => Promise<unknown>;
  /** Club admins/managers for remark assignee picker (manager/SA). */
  listRemarkAssignees?: () => Promise<BookingControlPerformerOption[]>;
  /** Manager/SA: set who should check and mark «Отработано». */
  assignRemark?: (
    sessionKey: string,
    assigneeId: string | null,
  ) => Promise<unknown>;
  /** Staff for «Сотрудник» filter (admin / SA). */
  listPerformers?: () => Promise<BookingControlPerformerOption[]>;
  /** Pull Документ.Занятие for selected period from 1C. */
  refreshFrom1c?: (
    from: string,
    to: string,
  ) => Promise<{
    message: string;
    sessionsUpserted?: number;
    ptSalesUpserted?: number;
  }>;
  /** Mark GROUP member arrived / no-show in 1C. */
  setAttendance?: (
    sessionKey: string,
    clientExternalId: string,
    attendance: 'ATTENDED' | 'NO_SHOW',
  ) => Promise<BookingControlDetail>;
  /** Trainer: FitGO checkmarks for who was present (+ optional draft comment). */
  saveTrainerSeen?: (
    sessionKey: string,
    seenClientIds: string[],
    comment?: string,
  ) => Promise<BookingControlDetail>;
  /** Trainer / admin / SA: confirm GROUP for payroll chain. */
  approveGroup?: (
    sessionKey: string,
    comment?: string,
  ) => Promise<BookingControlDetail>;
  /**
   * Performer: update while PENDING_ADMIN, or request re-review after APPROVED.
   */
  reviseSession?: (
    sessionKey: string,
    mode: 'update' | 'rereview',
    comment?: string,
  ) => Promise<BookingControlDetail>;
  /** Admin / SA: return GROUP to trainer. */
  returnGroupApproval?: (
    sessionKey: string,
    comment?: string,
  ) => Promise<BookingControlDetail>;
  /** Manager / SA: targeted rework (trainer / admin / staff task). */
  managerRework?: (body: {
    sessionKey: string;
    target: 'trainer' | 'admin' | 'staff';
    assigneeId?: string;
    comment: string;
    dueAt?: string;
  }) => Promise<{
    mode: 'approval' | 'task';
    detail?: BookingControlDetail;
    task?: { id: string; title: string };
    warning?: string;
  }>;
  listReworkAssignees?: () => Promise<
    Array<{
      id: string;
      name: string;
      roles: string[];
      externalId: string | null;
    }>
  >;
  listReworkTasks?: (
    sessionKey: string,
  ) => Promise<Array<{ id: string; title: string; assigneeId: string | null }>>;
  /** Manager / super-admin: confirm many unapproved GROUP sessions. */
  bulkApproveGroups?: (body: {
    from: string;
    to: string;
    role: 'trainer' | 'admin';
    sessionKeys: string[];
  }) => Promise<{ confirmed: number; skipped: number }>;
  /** Admin/manager/SA/trainer: hall NVR photos for GROUP. */
  listHallSnapshots?: (
    sessionKey: string,
  ) => Promise<import('@fitgo/shared-types').HallClassSnapshotItem[]>;
  /** Returns object URL for JPEG (caller must revoke). */
  loadHallSnapshotImage?: (snapshotId: string) => Promise<string>;
  /** Admin: save phone on unlinked SPA booking and retry 1C link. */
  updateSpaGuestPhone?: (
    bookingId: string,
    guestPhone: string,
  ) => Promise<void>;
  /** Admin / specialist: change SPA nomenclature on the FitGO booking. */
  updateSpaService?: (
    bookingId: string,
    serviceId: string,
  ) => Promise<void>;
  /** Services for nomenclature select. */
  listSpaServices?: () => Promise<Array<{ id: string; name: string }>>;
  /** Admin: link ClubRevenueEntry sale to FitGO SPA booking. */
  linkSpaSale?: (
    bookingId: string,
    saleExternalId: string,
    applyServiceId?: string,
  ) => Promise<BookingControlDetail>;
  /** Admin: link Onex SPA visit to FitGO booking. */
  linkSpaVisit?: (
    bookingId: string,
    onexExternalId: string,
  ) => Promise<BookingControlDetail>;
  /** Admin: clear linked sale / soft crmDocRef. */
  unlinkSpaDocument?: (bookingId: string) => Promise<BookingControlDetail>;
  /** Payroll line under «На проверке» (held from motivation). */
  payrollHoldPreview?: (sessionKey: string) => Promise<{
    line: string;
    held: boolean;
    earnMinor?: number;
    ratePercent?: number;
    priceMinor?: number;
  } | null>;
  /** Create FitGO journal row from a 1C SPA visit (no re-post to 1C). */
  adoptSpaToJournal?: (
    sessionKey: string,
    serviceId?: string,
  ) => Promise<BookingControlDetail>;
  /** Adopt unambiguous missing-journal rows. */
  bulkAdoptSpaToJournal?: (
    sessionKeys: string[],
  ) => Promise<{
    added: number;
    skipped: Array<{ sessionKey: string; reason: string }>;
  }>;
};

type Props = {
  api: BookingControlApi;
  /** Admin can resolve remarks */
  canResolve?: boolean;
  /** Manager / SA: pick who should check and mark «Отработано» */
  canAssignRemark?: boolean;
  /** Admin/manager/SA: mark GROUP attendance and refresh from 1C */
  canMarkAttendance?: boolean;
  /** Trainer: checkboxes for who was present */
  canTrainerSeen?: boolean;
  /** Confirm GROUP / SPA / PT (trainer / specialist / admin / SA) */
  canApproveGroup?: boolean;
  /**
   * Who this surface confirms as in the dual-approval chain.
   * performer = specialist/trainer; admin = club admin; override = manager/SA.
   */
  approvalActor?: 'performer' | 'admin' | 'override';
  /** Admin/SA: return to trainer */
  canReturnApproval?: boolean;
  /** Manager / SA: sheet with trainer / admin / staff targets */
  canManagerRework?: boolean;
  /** Manager / super-admin: bulk confirm unapproved GROUP in the period */
  canBulkApprove?: boolean;
  /** Admin/manager/SA/trainer: show Photo button on GROUP detail */
  canViewHallPhotos?: boolean;
  /** Open this session on mount (e.g. from admin tasks). */
  initialSessionKey?: string;
  /** Optional date range from deep-link (schedule → booking-control). */
  initialFrom?: string;
  initialTo?: string;
  /** Deep-link from payroll hints. */
  initialNeedsReview?: boolean;
  initialPayment?: 'PAID' | 'DEBT' | 'GIFT' | 'ALL';
  initialKind?: string;
  initialStatus?: string;
  initialPerformerId?: string;
  initialPayTag?: string;
  /** Discrepancy deep-link: EXPIRING_PACKAGE | LATE_ADD */
  initialFlag?: string;
  /** Client name / id deep-link from booking card. */
  initialClient?: string;
  initialClientId?: string;
  /** Hide kind filter (specialist SPA-only) */
  fixedKind?: BookingControlKind;
  /**
   * Trainer surface: All / GP / PT chips instead of the full kind select
   * (no SPA / solarium).
   */
  trainerKindFilter?: boolean;
  /**
   * Deep-link from home «провёл за месяц»: show completed list without
   * cutting by «На контроле / Прошли контроль» segments.
   */
  initialConducted?: boolean;
  /** Reformer hall deep-link. */
  initialHall?: 'REFORMER';
  /** Personal reformer PT deep-link. */
  initialReformer?: 'personal';
  title?: string;
  subtitle?: string;
  /**
   * Only show the detail modal (no list/filters). Used from Расписание
   * so the card opens like Контроль записей without leaving the page.
   */
  detailOnly?: boolean;
  onDetailClose?: () => void;
  /** Cancel FitGO SPA booking that is not locked in 1C. */
  cancelSpaBooking?: (bookingId: string) => Promise<void>;
  /**
   * GP trainer: «На контроле» / «Прошли контроль» segments.
   * Past sessions only; default period last 14 days.
   */
  approvalSegments?: boolean;
  /**
   * Super-admin only: ops/env hints (FITNESS_PROVIDER, FORMA_FITGO_URL, etc.).
   * Hidden from trainer / specialist / admin surfaces.
   */
  showOpsHints?: boolean;
  /**
   * Specialist: deep-link to edit the SPA booking in the journal.
   * Admin/SA do not need this.
   */
  spaBookingEditHref?: (bookingId: string) => string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** First calendar day of the current month (local), ISO yyyy-mm-dd. */
function monthStartIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** Last calendar day of the current month (local), ISO yyyy-mm-dd. */
function monthEndIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function approvalNoteActionRu(action: GroupApprovalNoteItem['action']) {
  return action === 'RETURN' ? 'на доработку' : 'подтвердил';
}

function statusRu(s: BookingControlStatus) {
  if (s === 'COMPLETED') return 'Выполнено';
  if (s === 'CANCELLED') return 'Отменено';
  return 'Запланировано';
}

function kindRu(k: BookingControlKind) {
  if (k === 'GROUP') return 'ГП';
  if (k === 'PT') return 'ПТ';
  if (k === 'SOLARIUM') return 'Соляр.';
  return 'SPA';
}

function attendanceOf(item: BookingControlListItem) {
  const booked = item.bookedCount ?? item.attendeeCount ?? 0;
  const arrived = item.arrivedCount ?? item.attendeeCount ?? 0;
  const noShow =
    item.noShowCount ?? Math.max(0, booked - arrived);
  return { booked, arrived, noShow };
}

function shownPriceMinor(item: {
  priceMinor?: number;
  spaSettlement?: { amountMinor?: number };
}): number | null {
  if (item.priceMinor != null && item.priceMinor > 0) return item.priceMinor;
  const fromSale = item.spaSettlement?.amountMinor;
  if (fromSale != null && fromSale > 0) return fromSale;
  return null;
}

function paymentCell(item: BookingControlListItem): string {
  if (item.kind === 'GROUP') return '—';
  const parts: string[] = [];
  if (item.source === 'SALE' || item.payTag === 'SALE') {
    parts.push('продажа');
  } else if (item.payTag === 'PACKAGE') {
    parts.push('абонемент');
  }
  if (item.payment && item.payment !== 'N_A' && item.payment !== 'UNKNOWN') {
    parts.push(paymentLabelRu(item.payment));
  }
  if (item.priceMinor != null && item.priceMinor > 0) {
    parts.push(`${(item.priceMinor / 100).toFixed(2)}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

/**
 * Status hint colors for booking-control badges.
 * Distinct hues so floor staff can scan who must act next;
 * tuned for dark slate surfaces (apps/web) with enough chroma to stay
 * readable in bright rooms and at night.
 *
 * - trainer → sky (floor performer)
 * - specialist → violet (SPA)
 * - admin → amber (desk queue)
 * - notIn1c → orange (sync gap, not a person-wait)
 */
type HintTone = 'trainer' | 'specialist' | 'admin' | 'notIn1c' | 'default';

function approvalHintTone(label: string | undefined | null): HintTone {
  if (!label) return 'default';
  if (label.includes('тренера')) return 'trainer';
  if (label.includes('специалиста')) return 'specialist';
  if (label.includes('администратора')) return 'admin';
  return 'default';
}

const HINT_BADGE_COLOR: Record<HintTone, string> = {
  trainer: 'bg-sky-500/20 text-sky-300 ring-1 ring-inset ring-sky-400/30',
  specialist:
    'bg-violet-500/20 text-violet-300 ring-1 ring-inset ring-violet-400/30',
  admin: 'bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-400/35',
  notIn1c:
    'bg-orange-500/20 text-orange-300 ring-1 ring-inset ring-orange-400/35',
  default: 'bg-slate-500/20 text-slate-300 ring-1 ring-inset ring-slate-400/25',
};

const HINT_TEXT_COLOR: Record<HintTone, string> = {
  trainer: 'text-sky-300',
  specialist: 'text-violet-300',
  admin: 'text-amber-200',
  notIn1c: 'text-orange-300',
  default: 'text-slate-300',
};

const HINT_PANEL_COLOR: Record<HintTone, string> = {
  trainer:
    'rounded-lg border border-sky-500/35 bg-sky-500/10 p-2 text-xs text-slate-300',
  specialist:
    'rounded-lg border border-violet-500/35 bg-violet-500/10 p-2 text-xs text-slate-300',
  admin:
    'rounded-lg border border-amber-500/35 bg-amber-500/10 p-2 text-xs text-slate-300',
  notIn1c:
    'rounded-lg border border-orange-500/35 bg-orange-500/10 p-2 text-xs text-slate-300',
  default:
    'rounded-lg border border-slate-500/30 bg-slate-500/10 p-2 text-xs text-slate-300',
};

function hintBadgeClass(tone: HintTone, compact = false): string {
  const pad = compact
    ? 'ml-1 rounded px-1 py-0.5 text-[10px]'
    : 'rounded px-1.5 py-0.5 text-[10px]';
  return `${pad} ${HINT_BADGE_COLOR[tone]}`;
}

function spaPendingLabel(
  label: string | undefined,
  phase: string | undefined,
): string {
  return (
    label ??
    (phase === 'PENDING_ADMIN' ? 'Ждёт администратора' : 'Ждёт специалиста')
  );
}

/** Error vs success banner inside booking-control (list + detail). */
function isBookingControlErrorMessage(message: string): boolean {
  return /ошибк|не удалось|нет прав|чуж|не законч|сначала|не найден|не оказывает|пересека|выберите|нельзя|запрещ|конфликт|не выбран|нет запис/i.test(
    message,
  );
}

export function BookingControlPanel({
  api,
  canResolve = false,
  canAssignRemark = false,
  canMarkAttendance = false,
  canTrainerSeen = false,
  canApproveGroup = false,
  approvalActor = 'admin',
  canReturnApproval = false,
  canManagerRework = false,
  canBulkApprove = false,
  canViewHallPhotos = false,
  initialSessionKey,
  initialFrom,
  initialTo,
  initialNeedsReview = false,
  initialPayment = 'ALL',
  initialKind,
  initialStatus,
  initialPerformerId,
  initialPayTag,
  initialFlag,
  initialClient,
  initialClientId,
  fixedKind,
  trainerKindFilter = false,
  initialConducted = false,
  initialHall,
  initialReformer,
  title = 'Контроль занятий',
  subtitle = 'Занятия из 1С и разовые ПТ из продаж. Запись FitGO без 1С — в ЗП не идёт.',
  detailOnly = false,
  onDetailClose,
  cancelSpaBooking,
  approvalSegments: _approvalSegments = false,
  showOpsHints = false,
  spaBookingEditHref,
}: Props) {
  void _approvalSegments;
  const pathname = usePathname();
  const ownerId = getUser()?.id ?? '';
  const hasDeepLink = Boolean(
    initialFrom?.trim() ||
      initialTo?.trim() ||
      initialSessionKey?.trim() ||
      initialNeedsReview ||
      initialKind ||
      initialStatus ||
      initialConducted ||
      initialPerformerId?.trim() ||
      initialPayTag?.trim() ||
      initialFlag?.trim() ||
      initialClient?.trim() ||
      initialClientId?.trim() ||
      (initialPayment && initialPayment !== 'ALL'),
  );

  const boot = useMemo(() => {
    const pendingLookbackFrom = daysAgoIso(45);
    const defaults: BookingViewMem = {
      from: monthStartIso(),
      to: todayIso(),
      kind: fixedKind ?? 'ALL',
      status: 'ALL',
      payment: 'ALL',
      payTag: '',
      flag: '',
      performerId: '',
      queue: 'pending',
      reasons: [],
      clientFilter: '',
      clientIdFilter: '',
    };
    if (hasDeepLink || detailOnly) {
      const needsAttention = Boolean(initialNeedsReview);
      const unpaidDeep = initialPayment === 'DEBT';
      const reasons: BookingControlIssueReason[] = [];
      if (needsAttention) reasons.push('review');
      if (unpaidDeep) reasons.push('unpaid');
      return {
        ...defaults,
        from:
          initialFrom?.trim() ||
          (needsAttention || unpaidDeep ? pendingLookbackFrom : defaults.from),
        to: initialTo?.trim() || defaults.to,
        kind: fixedKind ?? initialKind?.toUpperCase() ?? defaults.kind,
        status:
          initialStatus?.toUpperCase() ||
          (initialConducted ? 'COMPLETED' : defaults.status),
        // DEBT deep-link → unpaid chip, not payment select
        payment: unpaidDeep ? 'ALL' : initialPayment || defaults.payment,
        payTag: initialPayTag?.toUpperCase() || '',
        flag:
          initialFlag?.toUpperCase() === 'EXPIRING_PACKAGE' ||
          initialFlag?.toUpperCase() === 'LATE_ADD'
            ? initialFlag.toUpperCase()
            : '',
        performerId: initialPerformerId?.trim() || '',
        queue: needsAttention || unpaidDeep ? 'pending' : defaults.queue,
        reasons,
        clientFilter: initialClient?.trim() || '',
        clientIdFilter: initialClientId?.trim() || '',
      };
    }
    const saved = resolveViewFilters<BookingViewMem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search: new URLSearchParams(),
      urlKeys: [],
      fromUrl: () => ({}),
      defaults,
    });
    const reasons =
      Array.isArray(saved.reasons) && saved.reasons.length
        ? parseIssueReasons(saved.reasons.join(','))
        : saved.needsReview
          ? (['review'] as BookingControlIssueReason[])
          : [];
    const queue: BookingControlQueueSegment =
      saved.queue === 'done' || saved.queue === 'upcoming'
        ? saved.queue
        : 'pending';
    return { ...defaults, ...saved, queue, reasons };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const [from, setFrom] = useState(() =>
    isIsoDay(boot.from) ? boot.from : todayIso(),
  );
  const [to, setTo] = useState(() =>
    isIsoDay(boot.to) ? boot.to : todayIso(),
  );
  const [kind, setKind] = useState<string>(
    fixedKind ?? (typeof boot.kind === 'string' ? boot.kind : 'ALL'),
  );
  const [status, setStatus] = useState(
    typeof boot.status === 'string' ? boot.status : 'ALL',
  );
  const [payment, setPayment] = useState(
    boot.payment === 'PAID' ||
      boot.payment === 'DEBT' ||
      boot.payment === 'GIFT' ||
      boot.payment === 'ALL'
      ? boot.payment
      : 'ALL',
  );
  const [payTag, setPayTag] = useState(
    typeof boot.payTag === 'string' ? boot.payTag : '',
  );
  const [flag, setFlag] = useState(
    boot.flag === 'EXPIRING_PACKAGE' || boot.flag === 'LATE_ADD'
      ? boot.flag
      : '',
  );
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'SALE' | '1C'>('ALL');
  const [performerId, setPerformerId] = useState(
    typeof boot.performerId === 'string' ? boot.performerId : '',
  );
  const [performers, setPerformers] = useState<BookingControlPerformerOption[]>(
    [],
  );
  const [queue, setQueue] = useState<BookingControlQueueSegment>(
    boot.queue === 'done' || boot.queue === 'upcoming' ? boot.queue : 'pending',
  );
  const [reasons, setReasons] = useState<BookingControlIssueReason[]>(
    Array.isArray(boot.reasons) ? boot.reasons : [],
  );
  const [datesOpen, setDatesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [conductedMode, setConductedMode] = useState(Boolean(initialConducted));
  const [hallFilter, setHallFilter] = useState<'REFORMER' | ''>(
    initialHall === 'REFORMER' ? 'REFORMER' : '',
  );
  const [reformerFilter, setReformerFilter] = useState<'personal' | ''>(
    initialReformer === 'personal' ? 'personal' : '',
  );
  const [clientFilter, setClientFilter] = useState(
    typeof boot.clientFilter === 'string' ? boot.clientFilter : '',
  );
  const [clientIdFilter, setClientIdFilter] = useState(
    typeof boot.clientIdFilter === 'string' ? boot.clientIdFilter : '',
  );
  const showQueue = !detailOnly && !conductedMode;
  const showSpaIssueChips = !trainerKindFilter;

  // Deep link from табель / ЗП: useSearchParams can be empty on the first
  // paint of a static page, and saved filters would hide the session.
  useEffect(() => {
    const live = new URLSearchParams(window.location.search);
    const sessionKey =
      live.get('sessionKey')?.trim() || live.get('session')?.trim() || '';
    const fromL = live.get('from')?.trim() || '';
    const toL = live.get('to')?.trim() || '';
    const needsReviewL =
      live.get('needsReview') === '1' || live.get('needsReview') === 'true';
    const queueL = live.get('queue')?.trim().toLowerCase();
    const reasonsL = parseIssueReasons(live.get('reasons'));
    const paymentL = live.get('payment')?.trim().toUpperCase();
    const unpaidDeep = paymentL === 'DEBT';
    const drill = Boolean(sessionKey);
    if (
      !drill &&
      !isIsoDay(fromL) &&
      !isIsoDay(toL) &&
      !needsReviewL &&
      !unpaidDeep &&
      !queueL &&
      !reasonsL.length &&
      !live.get('client') &&
      !live.get('performerId')
    ) {
      return;
    }
    if (isIsoDay(fromL)) setFrom(fromL);
    else if (needsReviewL || unpaidDeep) setFrom(daysAgoIso(45));
    if (isIsoDay(toL)) setTo(toL);
    else if (needsReviewL || unpaidDeep) setTo(todayIso());
    const nextReasons: BookingControlIssueReason[] = [...reasonsL];
    if (needsReviewL && !nextReasons.includes('review')) nextReasons.push('review');
    if (unpaidDeep && !nextReasons.includes('unpaid')) nextReasons.push('unpaid');
    if (nextReasons.length) setReasons(nextReasons);
    if (
      queueL === 'done' ||
      queueL === 'upcoming' ||
      queueL === 'pending'
    ) {
      setQueue(queueL);
    } else if (needsReviewL || unpaidDeep) {
      setQueue('pending');
    }
    const kindL = live.get('kind')?.trim().toUpperCase();
    if (kindL && !fixedKind) setKind(kindL);
    const statusL = live.get('status')?.trim().toUpperCase();
    if (statusL) setStatus(statusL);
    else if (drill) setStatus('ALL');
    if (unpaidDeep) {
      setPayment('ALL');
    } else if (
      paymentL === 'PAID' ||
      paymentL === 'GIFT' ||
      paymentL === 'ALL'
    ) {
      setPayment(paymentL);
    } else if (drill) {
      setPayment('ALL');
    }
    if (live.has('performerId')) {
      setPerformerId(live.get('performerId')?.trim() || '');
    }
    if (live.has('client')) setClientFilter(live.get('client')?.trim() || '');
    if (live.has('clientId')) {
      setClientIdFilter(live.get('clientId')?.trim() || '');
    }
    if (live.has('payTag')) {
      setPayTag(live.get('payTag')?.trim().toUpperCase() || '');
    } else if (drill) setPayTag('');
    if (live.has('flag')) {
      setFlag(live.get('flag')?.trim().toUpperCase() || '');
    } else if (drill) setFlag('');
    const hallL = live.get('hall')?.trim().toUpperCase();
    if (hallL === 'REFORMER') setHallFilter('REFORMER');
    const reformerL = live.get('reformer')?.trim().toLowerCase();
    if (reformerL === 'personal') setReformerFilter('personal');
    if (
      live.get('conducted') === '1' ||
      live.get('conducted') === 'true'
    ) {
      setConductedMode(true);
    }
    if (sessionKey) void openDetail(sessionKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once from the address bar
  }, []);

  usePersistViewMemory<BookingViewMem>({
    enabled: !detailOnly,
    data: {
      from,
      to,
      kind,
      status,
      payment,
      payTag,
      flag,
      performerId,
      queue,
      reasons,
      clientFilter,
      clientIdFilter,
    },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.from) q.set('from', d.from);
      if (d.to) q.set('to', d.to);
      if (d.kind && d.kind !== 'ALL' && !fixedKind) q.set('kind', d.kind);
      if (d.status && d.status !== 'ALL') q.set('status', d.status);
      if (d.payment && d.payment !== 'ALL') q.set('payment', d.payment);
      if (d.payTag) q.set('payTag', d.payTag);
      if (d.flag) q.set('flag', d.flag);
      if (d.performerId) q.set('performerId', d.performerId);
      if (d.queue && d.queue !== 'pending') q.set('queue', d.queue);
      if (d.reasons?.length) q.set('reasons', d.reasons.join(','));
      if (d.clientFilter) q.set('client', d.clientFilter);
      if (d.clientIdFilter) q.set('clientId', d.clientIdFilter);
      if (typeof window !== 'undefined') {
        const live = new URLSearchParams(window.location.search);
        const sessionKey = live.get('sessionKey')?.trim();
        const session = live.get('session')?.trim();
        if (sessionKey) q.set('sessionKey', sessionKey);
        else if (session) q.set('session', session);
        const hall = live.get('hall')?.trim().toUpperCase();
        if (hall === 'REFORMER') q.set('hall', 'REFORMER');
        const reformer = live.get('reformer')?.trim().toLowerCase();
        if (reformer === 'personal') q.set('reformer', 'personal');
        if (live.get('conducted') === '1') q.set('conducted', '1');
      }
      return q;
    },
  });
  const [items, setItems] = useState<BookingControlListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendanceBusyId, setAttendanceBusyId] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [bulkRole, setBulkRole] = useState<'trainer' | 'admin'>('admin');
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [adoptBusyKey, setAdoptBusyKey] = useState<string | null>(null);
  const [adoptServiceId, setAdoptServiceId] = useState('');
  const [bulkAdoptBusy, setBulkAdoptBusy] = useState(false);
  const [pendingGroupsOpen, setPendingGroupsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<BookingControlDetail | null>(null);
  const [comment, setComment] = useState('');
  const [adminComment, setAdminComment] = useState('');
  const [remarkAssignees, setRemarkAssignees] = useState<
    BookingControlPerformerOption[]
  >([]);
  const [remarkAssigneeId, setRemarkAssigneeId] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkBusy, setReworkBusy] = useState(false);
  const [reworkAssignees, setReworkAssignees] = useState<
    ManagerReworkAssignee[]
  >([]);
  const [reworkWarning, setReworkWarning] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [photosOpen, setPhotosOpen] = useState(false);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photos, setPhotos] = useState<
    import('@fitgo/shared-types').HallClassSnapshotItem[]
  >([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photosError, setPhotosError] = useState('');
  const [localSeen, setLocalSeen] = useState<Set<string>>(new Set());
  const [seenSaveError, setSeenSaveError] = useState('');
  const [seenSaving, setSeenSaving] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const seenSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeenRef = useRef<{
    sessionKey: string;
    ids: string[];
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [approvalNotesOpen, setApprovalNotesOpen] = useState(false);
  const [linkPhone, setLinkPhone] = useState('');
  const [linkPhoneBusy, setLinkPhoneBusy] = useState(false);
  const [linkPhoneMsg, setLinkPhoneMsg] = useState('');
  const [spaServices, setSpaServices] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [linkDocBusy, setLinkDocBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [holdPreview, setHoldPreview] = useState<{
    line: string;
    held: boolean;
  } | null>(null);

  const showSpaLinkHints =
    approvalActor === 'admin' || approvalActor === 'override';

  useEffect(() => {
    if (!selected?.remark || !api.payrollHoldPreview) {
      setHoldPreview(null);
      return;
    }
    let cancelled = false;
    void api
      .payrollHoldPreview(selected.sessionKey)
      .then((p) => {
        if (!cancelled) setHoldPreview(p);
      })
      .catch(() => {
        if (!cancelled) setHoldPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.sessionKey, selected?.remark?.id, api.payrollHoldPreview]);

  const groupSessionEndMs = (d: {
    startAt: string;
    endAt?: string | null;
  }) =>
    d.endAt ? new Date(d.endAt).getTime() : new Date(d.startAt).getTime();

  const flushTrainerSeen = useCallback(
    async (sessionKey: string, ids: string[]) => {
      if (!api.saveTrainerSeen) return;
      setSeenSaving(true);
      setSeenSaveError('');
      try {
        const updated = await api.saveTrainerSeen(sessionKey, ids);
        setSelected((prev) =>
          prev?.sessionKey === sessionKey ? updated : prev,
        );
      } catch (e) {
        setSeenSaveError(
          e instanceof Error ? e.message : 'Отметки не сохранились',
        );
      } finally {
        setSeenSaving(false);
      }
    },
    [api],
  );

  const scheduleTrainerSeenSave = useCallback(
    (sessionKey: string, ids: string[]) => {
      if (!api.saveTrainerSeen) return;
      pendingSeenRef.current = { sessionKey, ids };
      if (seenSaveTimerRef.current) clearTimeout(seenSaveTimerRef.current);
      seenSaveTimerRef.current = setTimeout(() => {
        seenSaveTimerRef.current = null;
        const pending = pendingSeenRef.current;
        pendingSeenRef.current = null;
        if (pending) void flushTrainerSeen(pending.sessionKey, pending.ids);
      }, 400);
    },
    [api.saveTrainerSeen, flushTrainerSeen],
  );

  const flushPendingTrainerSeen = useCallback(() => {
    if (seenSaveTimerRef.current) {
      clearTimeout(seenSaveTimerRef.current);
      seenSaveTimerRef.current = null;
    }
    const pending = pendingSeenRef.current;
    pendingSeenRef.current = null;
    if (pending && api.saveTrainerSeen) {
      void flushTrainerSeen(pending.sessionKey, pending.ids);
    }
  }, [api.saveTrainerSeen, flushTrainerSeen]);

  useEffect(() => {
    return () => {
      if (seenSaveTimerRef.current) clearTimeout(seenSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selected || selected.kind !== 'GROUP') return;
    const endMs = groupSessionEndMs(selected);
    if (endMs <= Date.now()) return;
    const id = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [selected?.sessionKey, selected?.endAt, selected?.startAt, selected?.kind]);

  const load = useCallback(() => {
    if (detailOnly) {
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setMessage('');
    return api
      .list({
        from,
        to,
        kind: fixedKind ?? kind,
        // Queue / reasons / performer / client filter on the client so
        // segment counters stay stable for the period + kind.
        ...(payTag ? { payTag } : {}),
        ...(flag ? { flag } : {}),
        ...(hallFilter ? { hall: hallFilter } : {}),
        ...(reformerFilter ? { reformer: reformerFilter } : {}),
      })
      .then(setItems)
      .catch((e) =>
        setMessage(e instanceof Error ? e.message : 'Ошибка загрузки'),
      )
      .finally(() => setLoading(false));
  }, [
    api,
    from,
    to,
    kind,
    payTag,
    flag,
    hallFilter,
    reformerFilter,
    fixedKind,
    detailOnly,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (detailOnly || !api.listPerformers) return;
    let cancelled = false;
    api
      .listPerformers()
      .then((rows) => {
        if (!cancelled) setPerformers(rows);
      })
      .catch(() => {
        if (!cancelled) setPerformers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, detailOnly]);

  useEffect(() => {
    if (!canAssignRemark || !api.listRemarkAssignees) return;
    let cancelled = false;
    api
      .listRemarkAssignees()
      .then((rows) => {
        if (!cancelled) setRemarkAssignees(rows);
      })
      .catch(() => {
        if (!cancelled) setRemarkAssignees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, canAssignRemark]);

  useEffect(() => {
    if (!api.listSpaServices || spaServices.length > 0) return;
    if (!items.some((i) => i.missingJournal)) return;
    let cancelled = false;
    api
      .listSpaServices()
      .then((rows) => {
        if (!cancelled) setSpaServices(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, items, spaServices.length]);

  useEffect(() => {
    if (!initialSessionKey) return;
    void openDetail(initialSessionKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once from URL
  }, [initialSessionKey]);

  const performerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of performers) {
      if (p.id) map.set(p.id, p.name);
    }
    for (const i of items) {
      if (i.performerId && i.performerName && i.performerName !== '—') {
        map.set(i.performerId, i.performerName);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [performers, items]);

  const nowMs = Date.now();

  /** Period rows after kind/source (and trainer SPA hide) — before queue chips. */
  const scopedItems = useMemo(() => {
    let rows = items;
    if (trainerKindFilter) {
      rows = rows.filter(
        (i) =>
          i.kind !== 'SPA' &&
          i.kind !== 'SOLARIUM' &&
          !/соляр|solarium|tanning/i.test(i.title ?? ''),
      );
    }
    if (!conductedMode) {
      if (sourceFilter === 'SALE') {
        rows = rows.filter((i) => i.source === 'SALE' || i.payTag === 'SALE');
      } else if (sourceFilter === '1C') {
        rows = rows.filter((i) => i.source !== 'SALE');
      }
    }
    return rows;
  }, [items, trainerKindFilter, conductedMode, sourceFilter]);

  const pendingCount = useMemo(
    () =>
      scopedItems.filter(
        (i) => bookingControlQueueSegment(i, nowMs) === 'pending',
      ).length,
    [scopedItems, nowMs],
  );

  const doneCount = useMemo(
    () =>
      scopedItems.filter(
        (i) => bookingControlQueueSegment(i, nowMs) === 'done',
      ).length,
    [scopedItems, nowMs],
  );

  const upcomingCount = useMemo(
    () =>
      scopedItems.filter(
        (i) => bookingControlQueueSegment(i, nowMs) === 'upcoming',
      ).length,
    [scopedItems, nowMs],
  );

  const reasonCounts = useMemo(() => {
    const counts: Record<BookingControlIssueReason, number> = {
      review: 0,
      unpaid: 0,
      not1c: 0,
      journal: 0,
    };
    for (const i of scopedItems) {
      if (bookingControlQueueSegment(i, nowMs) !== 'pending') continue;
      for (const r of bookingControlIssueReasons(i)) {
        counts[r] += 1;
      }
    }
    return counts;
  }, [scopedItems, nowMs]);

  const visible = useMemo(() => {
    let rows = scopedItems;

    if (status && status !== 'ALL') {
      rows = rows.filter((i) => i.status === status);
    }
    if (payment && payment !== 'ALL') {
      rows = rows.filter((i) => {
        if (i.kind === 'GROUP') return false;
        if (payment === 'GIFT') return i.payment === 'GIFT';
        if (payment === 'PAID') {
          return (
            i.payment === 'PAID' ||
            i.payment === 'QUOTA' ||
            i.payment === 'PARTNER' ||
            i.payment === 'GIFT'
          );
        }
        return i.payment === 'DEBT' || i.payment === 'UNKNOWN';
      });
    }

    if (performerId) {
      const selectedName = (
        performerOptions.find((p) => p.id === performerId)?.name ?? ''
      )
        .trim()
        .toLowerCase();
      rows = rows.filter((i) => {
        if (i.performerId === performerId) return true;
        if (
          selectedName &&
          (i.performerName ?? '').trim().toLowerCase() === selectedName
        ) {
          return true;
        }
        return false;
      });
    }

    const clientQ = clientFilter.trim().toLowerCase();
    if (clientIdFilter.trim()) {
      const id = clientIdFilter.trim();
      rows = rows.filter((i) => i.clientId === id);
    } else if (clientQ) {
      rows = rows.filter((i) =>
        (i.clientName ?? '').toLowerCase().includes(clientQ),
      );
    }

    if (showQueue) {
      // Status «Отменено» bypasses queue so cancelled rows stay reachable.
      if (status !== 'CANCELLED') {
        rows = rows.filter(
          (i) => bookingControlQueueSegment(i, nowMs) === queue,
        );
      }
      if (queue === 'pending' && reasons.length > 0) {
        rows = rows.filter((i) =>
          bookingControlMatchesSelectedReasons(i, reasons),
        );
      }
    }
    return rows;
  }, [
    scopedItems,
    performerId,
    performerOptions,
    showQueue,
    queue,
    reasons,
    status,
    payment,
    clientFilter,
    clientIdFilter,
    nowMs,
  ]);

  const journalAdoptCount = useMemo(
    () =>
      visible.filter(
        (i) => i.missingJournal && i.source === '1C' && i.kind === 'SPA',
      ).length,
    [visible],
  );

  const toggleReason = (reason: BookingControlIssueReason) => {
    setReasons((prev) =>
      prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason],
    );
  };

  const today = todayIso();
  const periodPreset =
    from === today && to === today
      ? 'today'
      : from === daysAgoIso(6) && to === today
        ? 'week'
        : from === monthStartIso() && to === today
          ? 'month'
          : 'custom';
  const moreActive =
    (status && status !== 'ALL') ||
    (payment && payment !== 'ALL') ||
    sourceFilter !== 'ALL' ||
    Boolean(flag);

  const saleCount = useMemo(
    () => items.filter((i) => i.source === 'SALE').length,
    [items],
  );

  const pendingGroups = useMemo(
    () =>
      items.filter(
        (i) =>
          i.kind === 'GROUP' &&
          i.source === '1C' &&
          i.status !== 'CANCELLED' &&
          (i.approvalPhase === 'PENDING_TRAINER' ||
            i.approvalPhase === 'PENDING_ADMIN'),
      ),
    [items],
  );
  const pendingKey = pendingGroups.map((i) => i.sessionKey).join('|');

  useEffect(() => {
    setBulkSelected(new Set(pendingKey ? pendingKey.split('|') : []));
  }, [pendingKey]);

  const applyDetail = (d: BookingControlDetail) => {
    setSelected(d);
    setAdoptServiceId('');
    setLinkPhone(d.guestPhone ?? '');
    setComment(d.groupApproval?.trainerComment ?? '');
    setRemarkAssigneeId(d.remark?.assigneeId ?? '');
    const seen = new Set(
      d.groupApproval?.trainerSeenClientIds ??
        d.members.filter((m) => m.trainerSeen).map((m) => m.externalId),
    );
    setLocalSeen(seen);
    if (d.kind === 'SPA' && api.listSpaServices && spaServices.length === 0) {
      void api.listSpaServices().then(setSpaServices).catch(() => undefined);
    }
  };

  const openDetail = async (sessionKey: string) => {
    flushPendingTrainerSeen();
    setComment('');
    setAdminComment('');
    setRemarkAssigneeId('');
    setHistoryOpen(false);
    setApprovalNotesOpen(false);
    setDetailError('');
    setSeenSaveError('');
    setLinkPhone('');
    setLinkPhoneMsg('');
    closePhotos();
    const listItem = items.find((i) => i.sessionKey === sessionKey);

    // List row first: avoid blank modal / hard-fail when detail 404s briefly.
    if (listItem) {
      const payment = listItem.payment;
      setSelected({
        ...listItem,
        members:
          listItem.kind === 'GROUP'
            ? []
            : [
                {
                  externalId: listItem.number || listItem.sessionKey,
                  clientName: listItem.clientName || '—',
                  attendance:
                    payment === 'PAID' || payment === 'QUOTA'
                      ? 'ATTENDED'
                      : 'EXPECTED',
                  payment,
                },
              ],
        remark: null,
        remarksHistory: [],
        crmDocRef: listItem.number,
        groupApproval:
          listItem.kind === 'GROUP'
            ? {
                trainerSeenClientIds: [],
                phase:
                  (listItem.approvalPhase as
                    | 'PENDING_TRAINER'
                    | 'PENDING_ADMIN'
                    | 'APPROVED'
                    | undefined) ?? 'PENDING_TRAINER',
                trainerSeenCount: 0,
                payrollEligible: false,
                locked: false,
              }
            : undefined,
      });
      setLocalSeen(new Set());
      setDetailLoading(true);
      try {
        const d = await api.detail(sessionKey);
        applyDetail(d);
      } catch (e) {
        const text = e instanceof Error ? e.message : 'Ошибка';
        if (listItem.source === 'SALE' && listItem.title) {
          /* keep provisional sale row */
        } else if (detailOnly) {
          setDetailError(text);
        } else {
          setMessage(text);
        }
      } finally {
        setDetailLoading(false);
      }
      return;
    }

    setDetailLoading(true);
    setSelected(null);
    try {
      const d = await api.detail(sessionKey);
      applyDetail(d);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Ошибка';
      setSelected(null);
      if (detailOnly) setDetailError(text);
      else setMessage(text);
    } finally {
      setDetailLoading(false);
    }
  };

  const changeSpaService = async (serviceId: string) => {
    if (!selected?.fitgoBookingId || !api.updateSpaService || !serviceId) return;
    if (serviceId === selected.serviceId) return;
    setServiceBusy(true);
    setMessage('');
    try {
      await api.updateSpaService(selected.fitgoBookingId, serviceId);
      const d = await api.detail(selected.sessionKey);
      setSelected(d);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось сменить услугу');
    } finally {
      setServiceBusy(false);
    }
  };

  const linkSelectedSale = async (
    saleExternalId: string,
    applyServiceId?: string,
  ) => {
    if (!selected?.fitgoBookingId || !api.linkSpaSale) return;
    setLinkDocBusy(true);
    setMessage('');
    try {
      const d = await api.linkSpaSale(
        selected.fitgoBookingId,
        saleExternalId,
        applyServiceId,
      );
      setSelected(d);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось привязать');
    } finally {
      setLinkDocBusy(false);
    }
  };

  const linkSelectedVisit = async (onexExternalId: string) => {
    if (!selected?.fitgoBookingId || !api.linkSpaVisit) return;
    setLinkDocBusy(true);
    setMessage('');
    try {
      const d = await api.linkSpaVisit(
        selected.fitgoBookingId,
        onexExternalId,
      );
      setSelected(d);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось привязать');
    } finally {
      setLinkDocBusy(false);
    }
  };

  const unlinkSelectedSpa = async () => {
    if (!selected?.fitgoBookingId || !api.unlinkSpaDocument) return;
    setLinkDocBusy(true);
    setMessage('');
    try {
      const d = await api.unlinkSpaDocument(selected.fitgoBookingId);
      setSelected(d);
      load();
      setMessage(
        d.spaLinkHint?.candidates?.length
          ? 'Документ отвязан — выберите продажу'
          : 'Документ отвязан',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось отвязать');
    } finally {
      setLinkDocBusy(false);
    }
  };

  const adoptToJournal = async (sessionKey: string, serviceId?: string) => {
    if (!api.adoptSpaToJournal) return;
    setAdoptBusyKey(sessionKey);
    setMessage('');
    try {
      const d = await api.adoptSpaToJournal(
        sessionKey,
        serviceId?.trim() || undefined,
      );
      setSelected(d);
      setAdoptServiceId('');
      await load();
      setMessage('Добавлено в журнал');
    } catch (e) {
      const text =
        e instanceof Error ? e.message : 'Не удалось добавить в журнал';
      // From the list chip there is no service picker — open detail so the
      // error is visible and the user can choose a service.
      if (!selected || selected.sessionKey !== sessionKey) {
        try {
          await openDetail(sessionKey);
        } catch {
          /* keep text below */
        }
      }
      setMessage(text);
    } finally {
      setAdoptBusyKey(null);
    }
  };

  const bulkAdoptMissingJournal = async () => {
    if (!api.bulkAdoptSpaToJournal) return;
    const keys = visible
      .filter((i) => i.missingJournal && i.source === '1C' && i.kind === 'SPA')
      .map((i) => i.sessionKey);
    if (!keys.length) {
      setMessage('Нет записей без журнала в текущем списке');
      return;
    }
    setBulkAdoptBusy(true);
    setMessage('');
    try {
      const res = await api.bulkAdoptSpaToJournal(keys);
      await load();
      const skipNote =
        res.skipped.length > 0
          ? ` · пропущено ${res.skipped.length} (нужен выбор услуги или занят слот)`
          : '';
      setMessage(`В журнал: ${res.added}${skipNote}`);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Не удалось добавить в журнал',
      );
    } finally {
      setBulkAdoptBusy(false);
    }
  };

  const closePhotos = () => {
    setPhotosOpen(false);
    setPhotos([]);
    setPhotosError('');
    setPhotoUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      return {};
    });
  };

  const closeDetail = () => {
    flushPendingTrainerSeen();
    closePhotos();
    setHistoryOpen(false);
    setApprovalNotesOpen(false);
    setDetailError('');
    setSeenSaveError('');
    setLinkPhone('');
    setLinkPhoneMsg('');
    setSelected(null);
    onDetailClose?.();
  };

  const filterToClientBookings = (name: string, clientId?: string) => {
    const n = name.trim();
    if (!n && !clientId) return;
    setFrom(monthStartIso());
    setTo(monthEndIso());
    setClientFilter(n);
    setClientIdFilter(clientId?.trim() || '');
    setStatus('ALL');
    setReasons([]);
    setQueue('pending');
    closeDetail();
  };

  const saveSpaGuestPhone = async () => {
    if (!selected?.fitgoBookingId || !api.updateSpaGuestPhone) return;
    const phone = linkPhone.trim();
    if (!phone) {
      setLinkPhoneMsg('Введите номер телефона');
      return;
    }
    setLinkPhoneBusy(true);
    setLinkPhoneMsg('');
    try {
      await api.updateSpaGuestPhone(selected.fitgoBookingId, phone);
      const d = await api.detail(selected.sessionKey);
      setSelected(d);
      setLinkPhone(d.guestPhone ?? phone);
      if (d.spaSettlement?.status === 'AWAITING_CLIENT_LINK') {
        setLinkPhoneMsg('В 1С не найден, номер сохранён');
      } else {
        setLinkPhoneMsg('Клиент привязан');
      }
      load();
    } catch (e) {
      setLinkPhoneMsg(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setLinkPhoneBusy(false);
    }
  };

  const spaEditableInApp =
    selected?.kind === 'SPA' &&
    selected.status !== 'CANCELLED' &&
    Boolean(selected.fitgoBookingId) &&
    (selected.spaSettlement?.editableInApp === true ||
      selected.source === 'FITGO' ||
      selected.spaSettlement?.status === 'NOT_IN_1C' ||
      selected.spaSettlement?.status === 'AWAITING_CLIENT_LINK' ||
      selected.spaSettlement?.status === 'MANUAL_PAID' ||
      selected.spaSettlement?.status === 'DELETED_IN_1C' ||
      selected.spaSettlement?.status === 'CANCELLED_IN_1C');

  const cancelSelectedSpa = async () => {
    if (!selected?.fitgoBookingId || !cancelSpaBooking) return;
    if (!window.confirm('Удалить (отменить) эту SPA-запись в FitGO?')) return;
    setMessage('');
    try {
      await cancelSpaBooking(selected.fitgoBookingId);
      setMessage('Запись отменена');
      closeDetail();
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось отменить');
    }
  };

  const openPhotos = async () => {
    if (!selected || !api.listHallSnapshots) return;
    setPhotosOpen(true);
    setPhotosLoading(true);
    setPhotosError('');
    setPhotoUrls((prev) => {
      for (const url of Object.values(prev)) {
        URL.revokeObjectURL(url);
      }
      return {};
    });
    try {
      const list = await api.listHallSnapshots(selected.sessionKey);
      setPhotos(list);
      if (api.loadHallSnapshotImage) {
        const urls: Record<string, string> = {};
        for (const snap of list) {
          if (snap.status !== 'CAPTURED') continue;
          try {
            urls[snap.id] = await api.loadHallSnapshotImage(snap.id);
          } catch {
            /* show status without image */
          }
        }
        setPhotoUrls(urls);
      }
    } catch (e) {
      setPhotosError(e instanceof Error ? e.message : 'Ошибка загрузки фото');
    } finally {
      setPhotosLoading(false);
    }
  };

  const submitRemark = async () => {
    if (!selected || !comment.trim()) return;
    try {
      await api.openRemark(
        selected.sessionKey,
        comment.trim(),
        canAssignRemark && remarkAssigneeId
          ? remarkAssigneeId
          : undefined,
      );
      setMessage(
        canAssignRemark && remarkAssigneeId
          ? 'Отправлено на проверку выбранному сотруднику'
          : 'Замечание отправлено — занятие на проверке',
      );
      setComment('');
      setRemarkAssigneeId('');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const assignOpenRemark = async () => {
    if (!selected || !api.assignRemark || !remarkAssigneeId) return;
    setAssignBusy(true);
    setMessage('');
    try {
      await api.assignRemark(selected.sessionKey, remarkAssigneeId);
      setMessage('Исполнитель назначен — запись на проверке у него');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка назначения');
    } finally {
      setAssignBusy(false);
    }
  };

  const resolve = async () => {
    if (!selected || !api.resolveRemark) return;
    try {
      await api.resolveRemark(
        selected.sessionKey,
        adminComment.trim() || undefined,
      );
      setMessage('Замечание отработано');
      setAdminComment('');
      setRemarkAssigneeId('');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const markAttendance = async (
    clientExternalId: string,
    attendance: 'ATTENDED' | 'NO_SHOW',
  ) => {
    if (!selected || !api.setAttendance) return;
    setAttendanceBusyId(clientExternalId);
    setMessage('');
    try {
      const updated = await api.setAttendance(
        selected.sessionKey,
        clientExternalId,
        attendance,
      );
      setSelected(updated);
      setMessage(
        attendance === 'ATTENDED'
          ? 'Отмечено: Прибыл (сохранено в 1С)'
          : 'Отмечено: Не прибыл (сохранено в 1С)',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка записи явки');
    } finally {
      setAttendanceBusyId(null);
    }
  };

  /** FitGO checkmarks — autosave while class is in progress (debounced). */
  const toggleTrainerSeen = (clientExternalId: string) => {
    if (!selected || selected.groupApproval?.locked) {
      return;
    }
    const next = new Set(localSeen);
    if (next.has(clientExternalId)) next.delete(clientExternalId);
    else next.add(clientExternalId);
    setLocalSeen(next);
    setSeenSaveError('');
    if (selected.kind === 'GROUP' && selected.source === '1C') {
      scheduleTrainerSeenSave(selected.sessionKey, [...next]);
    }
  };

  const approveGroup = async () => {
    if (!selected || !api.approveGroup) return;
    setApproveBusy(true);
    setMessage('');
    try {
      if (api.saveTrainerSeen && selected.kind === 'GROUP') {
        if (seenSaveTimerRef.current) {
          clearTimeout(seenSaveTimerRef.current);
          seenSaveTimerRef.current = null;
        }
        pendingSeenRef.current = null;
        try {
          await api.saveTrainerSeen(selected.sessionKey, [...localSeen]);
          setSeenSaveError('');
        } catch {
          /* non-critical — confirm still proceeds */
        }
      }
      const updated = await api.approveGroup(
        selected.sessionKey,
        comment.trim() || undefined,
      );
      setSelected(updated);
      setComment('');
      const phase =
        updated.groupApproval?.phase ?? updated.approvalPhase;
      setMessage(
        phase === 'APPROVED'
          ? 'Подтверждено — занятие в ЗП'
          : selected.kind === 'SPA'
            ? 'Подтверждено. Ждёт администратора.'
            : 'Подтверждено тренером — ждёт администратора',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка подтверждения');
    } finally {
      setApproveBusy(false);
    }
  };

  const reviseSelected = async (mode: 'update' | 'rereview') => {
    if (!selected || !api.reviseSession) return;
    if (mode === 'rereview' && comment.trim().length < 2) {
      setMessage('Укажите комментарий для повторной проверки');
      return;
    }
    setApproveBusy(true);
    setMessage('');
    try {
      const updated = await api.reviseSession(
        selected.sessionKey,
        mode,
        comment.trim() || undefined,
      );
      setSelected(updated);
      setComment('');
      setMessage(
        mode === 'rereview'
          ? 'Отправлено на повторную проверку администратору'
          : 'Изменения сохранены — админ увидит новую версию',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setApproveBusy(false);
    }
  };

  const selectedGroupEnded =
    !selected || selected.kind !== 'GROUP'
      ? true
      : groupSessionEndMs(selected) <= nowTick;

  const canConfirmSelected = (() => {
    if (!canApproveGroup || !api.approveGroup || !selected) return false;
    if (selected.kind === 'SPA' || selected.kind === 'PT') {
      // FitGO PT/SPA (and 1C rows with fitgoBookingId) use SessionApproval.
      // Pure 1C PT without FitGO link has no phase — not confirmable here.
      const phase = selected.approvalPhase;
      const canPt =
        selected.kind === 'PT' &&
        Boolean(selected.fitgoBookingId || selected.source === 'FITGO');
      if (selected.kind === 'PT' && !canPt) return false;
      if (!phase || phase === 'APPROVED') {
        // No row yet → performer still needs to confirm (same as SPA list).
        if (
          selected.kind === 'PT' &&
          canPt &&
          approvalActor === 'performer' &&
          selected.status !== 'CANCELLED'
        ) {
          return true;
        }
        if (selected.kind === 'SPA' && !phase && approvalActor === 'performer') {
          return true;
        }
        return false;
      }
      if (approvalActor === 'override') return true;
      if (approvalActor === 'performer') {
        return (
          phase === 'PENDING_PERFORMER' ||
          phase === 'PENDING_TRAINER'
        );
      }
      return phase === 'PENDING_ADMIN';
    }
    if (selected.kind === 'GROUP' && selected.source === '1C') {
      const phase = selected.groupApproval?.phase;
      if (!phase || phase === 'APPROVED' || selected.groupApproval?.locked) {
        return false;
      }
      if (!selectedGroupEnded) return false;
      if (approvalActor === 'override') return true;
      if (approvalActor === 'performer') return phase === 'PENDING_TRAINER';
      return phase === 'PENDING_ADMIN';
    }
    return false;
  })();

  /** Performer may update confirmation while admin still reviews. */
  const canReviseUpdate = (() => {
    if (
      approvalActor !== 'performer' ||
      !api.reviseSession ||
      !selected ||
      selected.status === 'CANCELLED'
    ) {
      return false;
    }
    if (selected.kind === 'GROUP' && selected.source === '1C') {
      return (
        selected.groupApproval?.phase === 'PENDING_ADMIN' &&
        !selected.groupApproval.locked
      );
    }
    if (selected.kind === 'SPA' || selected.kind === 'PT') {
      const canPt =
        selected.kind === 'PT' &&
        Boolean(selected.fitgoBookingId || selected.source === 'FITGO');
      if (selected.kind === 'PT' && !canPt) return false;
      return selected.approvalPhase === 'PENDING_ADMIN';
    }
    return false;
  })();

  /** Performer requests admin re-check after APPROVED (required comment). */
  const canReviseRereview = (() => {
    if (
      approvalActor !== 'performer' ||
      !api.reviseSession ||
      !selected ||
      selected.status === 'CANCELLED'
    ) {
      return false;
    }
    if (selected.kind === 'GROUP' && selected.source === '1C') {
      return (
        selected.groupApproval?.phase === 'APPROVED' &&
        !selected.groupApproval.locked
      );
    }
    if (selected.kind === 'SPA' || selected.kind === 'PT') {
      const canPt =
        selected.kind === 'PT' &&
        Boolean(selected.fitgoBookingId || selected.source === 'FITGO');
      if (selected.kind === 'PT' && !canPt) return false;
      return selected.approvalPhase === 'APPROVED';
    }
    return false;
  })();

  const showConfirmAfterEndHint =
    Boolean(
      canTrainerSeen &&
        selected &&
        selected.kind === 'GROUP' &&
        selected.source === '1C' &&
        !selected.groupApproval?.locked &&
        !selectedGroupEnded &&
        (selected.groupApproval?.phase === 'PENDING_TRAINER' ||
          !selected.groupApproval?.phase),
    );

  /** Comment box before/during class (draft) or with confirm/return after end. */
  const showGroupCommentBox = Boolean(
    selected &&
      selected.kind === 'GROUP' &&
      selected.source === '1C' &&
      !selected.groupApproval?.locked &&
      (canConfirmSelected ||
        canReviseUpdate ||
        canReviseRereview ||
        canReturnApproval ||
        canManagerRework ||
        showConfirmAfterEndHint ||
        (canTrainerSeen &&
          (selected.groupApproval?.phase === 'PENDING_TRAINER' ||
            !selected.groupApproval?.phase))),
  );

  /** PT/SPA performer: comment for update / rereview (or confirm). */
  const showPtSpaReviseBox = Boolean(
    selected &&
      (selected.kind === 'PT' || selected.kind === 'SPA') &&
      (canReviseUpdate || canReviseRereview),
  );

  const saveDraftComment = async () => {
    if (!selected || !api.saveTrainerSeen) return;
    setApproveBusy(true);
    setMessage('');
    try {
      const updated = await api.saveTrainerSeen(
        selected.sessionKey,
        [...localSeen],
        comment.trim(),
      );
      applyDetail(updated);
      setMessage('Комментарий сохранён');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setApproveBusy(false);
    }
  };

  const returnApproval = async () => {
    if (!selected || !api.returnGroupApproval) return;
    setApproveBusy(true);
    setMessage('');
    try {
      const updated = await api.returnGroupApproval(
        selected.sessionKey,
        comment.trim() || undefined,
      );
      setSelected(updated);
      setLocalSeen(
        new Set(updated.groupApproval?.trainerSeenClientIds ?? []),
      );
      setComment('');
      setMessage('Отправлено на доработку тренеру');
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка возврата');
    } finally {
      setApproveBusy(false);
    }
  };

  const openManagerRework = async () => {
    if (!selected || !api.managerRework) return;
    setReworkWarning(null);
    setReworkOpen(true);
    if (api.listReworkAssignees && reworkAssignees.length === 0) {
      try {
        setReworkAssignees(await api.listReworkAssignees());
      } catch {
        /* ignore — sheet still works with empty list */
      }
    }
    if (api.listReworkTasks) {
      try {
        const open = await api.listReworkTasks(selected.sessionKey);
        if (open.length > 0) {
          setReworkWarning(
            `Уже есть открытая задача по этой записи (${open.length}) — можно поставить ещё`,
          );
        }
      } catch {
        /* ignore */
      }
    }
  };

  const reworkTargets: ManagerReworkTargetOption[] = useMemo(() => {
    if (!selected) return [];
    const isSale = selected.source === 'SALE';
    const phase =
      selected.groupApproval?.phase ?? selected.approvalPhase ?? null;
    const trainerDone =
      phase === 'PENDING_ADMIN' ||
      phase === 'APPROVED' ||
      Boolean(selected.groupApproval?.trainerApprovedAt);
    const hasChain =
      !isSale &&
      (selected.kind === 'GROUP' ||
        selected.kind === 'PT' ||
        selected.kind === 'SPA');

    const performerMatch = reworkAssignees.find(
      (a) =>
        a.id === selected.performerId ||
        (selected.performerId && a.externalId === selected.performerId),
    );
    const adminExt = selected.employeeExternalId?.trim() || null;
    const adminMatch = reworkAssignees.find(
      (a) =>
        adminExt &&
        a.externalId === adminExt &&
        (a.roles ?? []).some((r) => r === 'ADMIN' || r === 'MANAGER'),
    );

    if (isSale || !hasChain) {
      return [
        {
          id: 'trainer',
          label: 'Исполнителю',
          needsAssignee: !performerMatch,
          presetAssigneeId: performerMatch?.id ?? null,
          roleFilter: ['TRAINER', 'SPECIALIST'],
          hint: performerMatch
            ? performerMatch.name
            : 'Выберите, если исполнитель не найден в FitGO',
        },
        {
          id: 'admin',
          label: 'Администратору',
          needsAssignee: !adminMatch,
          presetAssigneeId: adminMatch?.id ?? null,
          roleFilter: ['ADMIN', 'MANAGER'],
          hint: adminMatch
            ? adminMatch.name
            : 'Выберите администратора документа',
        },
        {
          id: 'staff',
          label: 'Сотруднику (задача)',
          needsAssignee: true,
          hint: 'Подтверждение и ЗП не меняются',
        },
      ];
    }

    const targets: ManagerReworkTargetOption[] = [
      {
        id: 'trainer',
        label: 'Тренеру / исполнителю',
        hint: 'Снимет подтверждение, ЗП на удержании',
      },
    ];
    if (trainerDone) {
      targets.push({
        id: 'admin',
        label: 'Администратору',
        hint: 'Оставит отметку тренера, снимет админа',
      });
    }
    targets.push({
      id: 'staff',
      label: 'Сотруднику (задача)',
      needsAssignee: true,
      hint: 'Подтверждение и ЗП не меняются',
    });
    return targets;
  }, [selected, reworkAssignees]);

  const submitManagerRework = async (input: {
    targetId: string;
    assigneeId?: string;
    comment: string;
    dueAt?: string;
  }) => {
    if (!selected || !api.managerRework) return;
    const target =
      input.targetId === 'admin' || input.targetId === 'staff'
        ? input.targetId
        : 'trainer';
    if (
      target === 'admin' &&
      selected.source !== 'SALE' &&
      !(
        selected.groupApproval?.trainerApprovedAt ||
        selected.approvalPhase === 'PENDING_ADMIN' ||
        selected.approvalPhase === 'APPROVED'
      )
    ) {
      throw new Error('Сначала нужно подтверждение тренера / исполнителя');
    }
    setReworkBusy(true);
    try {
      const result = await api.managerRework({
        sessionKey: selected.sessionKey,
        target,
        assigneeId: input.assigneeId,
        comment: input.comment,
        dueAt: input.dueAt,
      });
      if (result.detail) {
        setSelected(result.detail);
        setLocalSeen(
          new Set(result.detail.groupApproval?.trainerSeenClientIds ?? []),
        );
      }
      setComment('');
      setReworkOpen(false);
      setReworkWarning(null);
      setMessage(
        [
          result.mode === 'task'
            ? `Задача поставлена${result.task ? `: ${result.task.title}` : ''}`
            : target === 'admin'
              ? 'Отправлено на доработку администратору'
              : 'Отправлено на доработку тренеру',
          result.warning,
        ]
          .filter(Boolean)
          .join('. '),
      );
      load();
    } finally {
      setReworkBusy(false);
    }
  };

  const setToday = () => {
    const d = todayIso();
    setFrom(d);
    setTo(d);
  };

  const setWeek = () => {
    setFrom(daysAgoIso(6));
    setTo(todayIso());
  };

  const setMonth = () => {
    setFrom(monthStartIso());
    setTo(todayIso());
  };

  const clearConductedMode = () => {
    setConductedMode(false);
    setStatus('ALL');
    setReasons([]);
    setQueue('pending');
    setFrom(monthStartIso());
    setTo(todayIso());
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      for (const key of [
        'conducted',
        'kind',
        'status',
        'from',
        'to',
        'needsReview',
        'queue',
        'reasons',
      ]) {
        url.searchParams.delete(key);
      }
      const next = url.searchParams.toString();
      window.history.replaceState(
        {},
        '',
        next ? `${url.pathname}?${next}` : url.pathname,
      );
    }
  };

  const refreshPeriodFrom1c = async () => {
    if (!api.refreshFrom1c || refreshBusy) return;
    setRefreshBusy(true);
    setMessage('');
    try {
      // Month-long pull ≈ 800 занятий; one Nest call exceeds Next proxy (~150s)
      // → HTTP 500. Chunk into ≤5-day windows (backend also day-by-day vs 1C).
      const chunks = splitIsoRangeInclusive(from, to, 5);
      let sessions = 0;
      let pt = 0;
      let lastMsg = '';
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          setMessage(
            `Обновляем из 1С… ${i + 1}/${chunks.length} (${chunks[i].from} – ${chunks[i].to})`,
          );
        }
        const res = await api.refreshFrom1c(chunks[i].from, chunks[i].to);
        sessions += res.sessionsUpserted ?? 0;
        pt += res.ptSalesUpserted ?? 0;
        lastMsg = res.message || lastMsg;
      }
      await load();
      if (chunks.length > 1) {
        setMessage(
          `Период обновлён из 1С (${chunks.length} частей): занятий ${sessions}, ПТ ${pt}.`,
        );
      } else {
        setMessage(lastMsg || 'Период обновлён из 1С');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось обновить из 1С');
    } finally {
      setRefreshBusy(false);
    }
  };

  const toggleBulk = (sessionKey: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionKey)) next.delete(sessionKey);
      else next.add(sessionKey);
      return next;
    });
  };

  const confirmBulk = async () => {
    if (!api.bulkApproveGroups) return;
    const sessionKeys = pendingGroups
      .map((i) => i.sessionKey)
      .filter((k) => bulkSelected.has(k));
    if (!sessionKeys.length) return;
    setBulkBusy(true);
    setMessage('');
    try {
      const res = await api.bulkApproveGroups({
        from,
        to,
        role: bulkRole,
        sessionKeys,
      });
      setMessage(
        `Подтверждено ${res.confirmed}` +
          (res.skipped ? `, пропущено ${res.skipped}` : '') +
          '. Занятия идут в расчёт ЗП.',
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка массового подтверждения');
    } finally {
      setBulkBusy(false);
    }
  };

  const detailPriceMinor = selected ? shownPriceMinor(selected) : null;
  const spaDocNumber = humanDocumentNumber(selected?.spaSettlement?.visitNum);

  return (
    <div className={detailOnly ? '' : 'space-y-3'}>
      {!detailOnly && (
      <>
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 hidden text-sm text-slate-400 sm:block">
            {subtitle}
          </p>
        ) : null}
      </div>

      {conductedMode ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-fitgo-500/15 px-3 py-1 text-xs font-medium text-fitgo-300">
            Проведённые за месяц
          </span>
          <button
            type="button"
            onClick={clearConductedMode}
            className="text-xs text-slate-400 underline-offset-2 hover:text-fitgo-400 hover:underline"
          >
            сбросить
          </button>
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        {showQueue ? (
          <div className="sticky top-0 z-20 -mx-3 -mt-3 space-y-1 border-b border-slate-800/80 bg-slate-950/95 px-3 pb-3 pt-3 backdrop-blur-sm">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setQueue('pending')}
                className={`min-h-11 min-w-0 rounded-2xl px-3 py-2 text-center text-sm leading-tight ${
                  queue === 'pending'
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <span className="block font-medium">На контроле</span>
                <span className="mt-0.5 block text-xs opacity-90">
                  {pendingCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setQueue('done')}
                className={`min-h-11 min-w-0 rounded-2xl px-3 py-2 text-center text-sm leading-tight ${
                  queue === 'done'
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <span className="block font-medium">Прошли контроль</span>
                <span className="mt-0.5 block text-xs opacity-90">
                  {doneCount}
                </span>
              </button>
            </div>
            {upcomingCount > 0 ? (
              <button
                type="button"
                onClick={() => setQueue('upcoming')}
                className={`w-full rounded-xl px-3 py-1.5 text-left text-xs ${
                  queue === 'upcoming'
                    ? 'bg-slate-800 text-fitgo-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Ещё не начались · {upcomingCount}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={
              periodPreset === 'today' ? 'btn-primary px-3 py-2 text-sm' : 'btn-secondary px-3 py-2 text-sm'
            }
            onClick={setToday}
          >
            Сегодня
          </button>
          <button
            type="button"
            className={
              periodPreset === 'week' ? 'btn-primary px-3 py-2 text-sm' : 'btn-secondary px-3 py-2 text-sm'
            }
            onClick={setWeek}
          >
            Неделя
          </button>
          <button
            type="button"
            className={
              periodPreset === 'month' ? 'btn-primary px-3 py-2 text-sm' : 'btn-secondary px-3 py-2 text-sm'
            }
            onClick={setMonth}
          >
            Месяц
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 text-sm ${
              periodPreset === 'custom' || datesOpen
                ? 'bg-slate-800 text-fitgo-300 ring-1 ring-inset ring-fitgo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setDatesOpen((v) => !v)}
            aria-expanded={datesOpen}
          >
            {formatRangeLabel(from, to)}
          </button>
        </div>

        {datesOpen ? (
          <div className="grid grid-cols-2 gap-2">
            <DateField
              label="С"
              value={from}
              onChange={setFrom}
              className="min-w-0"
              inputClassName="text-sm"
            />
            <DateField
              label="По"
              value={to}
              onChange={setTo}
              className="min-w-0"
              inputClassName="text-sm"
            />
          </div>
        ) : null}

        {!fixedKind ? (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            {(trainerKindFilter
              ? ([
                  ['ALL', 'Все'],
                  ['GROUP', 'ГП'],
                  ['PT', 'ПТ'],
                ] as const)
              : ([
                  ['ALL', 'Все'],
                  ['GROUP', 'ГП'],
                  ['PT', 'ПТ'],
                  ['SPA', 'SPA'],
                  ['SOLARIUM', 'Солярий'],
                ] as const)
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={chipClass(kind === value)}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {showQueue && queue === 'pending' ? (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            {(
              [
                ['review', 'На проверке', 'rose'],
                ['unpaid', 'Нет оплаты', 'rose'],
                ...(showSpaIssueChips
                  ? ([
                      ['not1c', 'Нет в 1С', 'orange'],
                      ['journal', 'Нет в журнале', 'orange'],
                    ] as const)
                  : []),
              ] as const
            ).map(([id, label, tone]) => (
              <button
                key={id}
                type="button"
                className={chipClass(reasons.includes(id), tone)}
                onClick={() => toggleReason(id)}
              >
                {label}
                <span className="tabular-nums opacity-80">
                  {reasonCounts[id]}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-[11px] text-slate-500">
            Клиент
            <input
              className="input mt-1 block w-full min-w-0 text-sm"
              value={clientFilter}
              onChange={(e) => {
                setClientFilter(e.target.value);
                if (!e.target.value.trim()) setClientIdFilter('');
              }}
              placeholder="ФИО или часть имени"
            />
          </label>
          {!detailOnly && (performerOptions.length > 0 || api.listPerformers) ? (
            <label className="min-w-0 text-[11px] text-slate-500">
              Сотрудник
              <select
                className="input mt-1 block w-full min-w-0 text-sm"
                value={performerId}
                onChange={(e) => setPerformerId(e.target.value)}
              >
                <option value="">Все</option>
                {performerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 text-xs ${
              moreActive || moreOpen
                ? 'text-fitgo-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
          >
            Ещё
            {moreActive ? (
              <span className="h-1.5 w-1.5 rounded-full bg-fitgo-400" aria-hidden />
            ) : null}
            <span aria-hidden>{moreOpen ? '▾' : '▸'}</span>
          </button>
          {payment !== 'ALL' ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300"
              onClick={() => setPayment('ALL')}
            >
              {payment === 'PAID'
                ? 'Оплачено'
                : payment === 'DEBT'
                  ? 'Нет оплаты'
                  : 'Подарок'}
              <span aria-hidden>×</span>
            </button>
          ) : null}
          {status !== 'ALL' ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300"
              onClick={() => setStatus('ALL')}
            >
              {status === 'SCHEDULED'
                ? 'Запланировано'
                : status === 'COMPLETED'
                  ? 'Выполнено'
                  : 'Отменено'}
              <span aria-hidden>×</span>
            </button>
          ) : null}
          {sourceFilter !== 'ALL' ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300"
              onClick={() => setSourceFilter('ALL')}
            >
              {sourceFilter === 'SALE' ? 'Продажи ПТ' : 'Занятия 1С'}
              <span aria-hidden>×</span>
            </button>
          ) : null}
          {flag ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-amber-700/60 bg-amber-950/40 px-2.5 py-1 text-[11px] text-amber-200"
              onClick={() => setFlag('')}
              title="Снять фильтр нестыковки"
            >
              {flag === 'EXPIRING_PACKAGE'
                ? 'Истекающий пакет'
                : 'Добавлены после занятия'}
              <span aria-hidden>×</span>
            </button>
          ) : null}
        </div>

        {moreOpen ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(kind === 'PT' ||
              kind === 'SPA' ||
              kind === 'SOLARIUM' ||
              kind === 'ALL' ||
              fixedKind) && (
              <label className="min-w-0 text-[11px] text-slate-500">
                Оплата
                <select
                  className="input mt-1 block w-full min-w-0 text-sm"
                  value={payment}
                  onChange={(e) =>
                    setPayment(
                      e.target.value as 'PAID' | 'DEBT' | 'GIFT' | 'ALL',
                    )
                  }
                >
                  <option value="ALL">Все</option>
                  <option value="PAID">Оплачено</option>
                  <option value="DEBT">Нет оплаты</option>
                  <option value="GIFT">Подарок</option>
                </select>
              </label>
            )}
            <label className="min-w-0 text-[11px] text-slate-500">
              Статус
              <select
                className="input mt-1 block w-full min-w-0 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="ALL">Все</option>
                <option value="SCHEDULED">Запланировано</option>
                <option value="COMPLETED">Выполнено</option>
                <option value="CANCELLED">Отменено</option>
              </select>
            </label>
            {!fixedKind ? (
              <label className="min-w-0 text-[11px] text-slate-500">
                Источник
                <select
                  className="input mt-1 block w-full min-w-0 text-sm"
                  value={sourceFilter}
                  onChange={(e) =>
                    setSourceFilter(e.target.value as 'ALL' | 'SALE' | '1C')
                  }
                >
                  <option value="ALL">Все</option>
                  <option value="1C">Занятия 1С</option>
                  <option value="SALE">
                    Продажи ПТ{saleCount ? ` (${saleCount})` : ''}
                  </option>
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {api.bulkAdoptSpaToJournal && journalAdoptCount > 0 ? (
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm"
              disabled={bulkAdoptBusy}
              title="Добавить в журнал все однозначные записи из 1С без дубля"
              onClick={() => void bulkAdoptMissingJournal()}
            >
              {bulkAdoptBusy ? 'Добавляем…' : `В журнал · ${journalAdoptCount}`}
            </button>
          ) : null}
          {canBulkApprove && api.bulkApproveGroups && pendingGroups.length > 0 ? (
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm"
              onClick={() => setPendingGroupsOpen(true)}
            >
              Подтвердить ГП · {pendingGroups.length}
            </button>
          ) : null}
          {api.refreshFrom1c ? (
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm sm:ml-auto"
              disabled={refreshBusy || !from || !to || from > to}
              title={`Перечитать занятия 1С и разовые ПТ за ${from} – ${to}`}
              onClick={() => void refreshPeriodFrom1c()}
            >
              {refreshBusy ? 'Обновляем…' : 'Обновить из 1С'}
            </button>
          ) : null}
        </div>
      </div>

      {canBulkApprove &&
      api.bulkApproveGroups &&
      pendingGroupsOpen &&
      pendingGroups.length > 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={pendingGroupsOpen}
            onClick={() => setPendingGroupsOpen(false)}
          >
            <span className="text-sm font-medium text-white">
              Неподтверждённые ГП за период · {pendingGroups.length}
            </span>
            <span className="shrink-0 text-xs text-slate-500">▾</span>
          </button>
          <p className="text-xs text-slate-500">
            Выполненные занятия без подтверждения. Отметка тренером или админом
            сразу включает их в расчёт ЗП.
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={
                pendingGroups.length > 0 &&
                pendingGroups.every((i) => bulkSelected.has(i.sessionKey))
              }
              onChange={(e) => {
                setBulkSelected(
                  e.target.checked
                    ? new Set(pendingGroups.map((i) => i.sessionKey))
                    : new Set(),
                );
              }}
            />
            Выбрать все
          </label>
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 text-sm">
            {pendingGroups.map((item) => (
              <li
                key={item.sessionKey}
                className="flex items-center gap-2 border-b border-slate-900 px-2 py-1.5 last:border-0"
              >
                <input
                  type="checkbox"
                  checked={bulkSelected.has(item.sessionKey)}
                  onChange={() => toggleBulk(item.sessionKey)}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-slate-200"
                  onClick={() => openDetail(item.sessionKey)}
                >
                  {formatDateTime(item.startAt)} · {item.title}
                  {item.performerName ? ` · ${item.performerName}` : ''}
                </button>
                <span
                  className={`shrink-0 text-[11px] ${HINT_TEXT_COLOR[approvalHintTone(item.approvalLabel)]}`}
                >
                  {item.approvalLabel}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="bulk-role"
                checked={bulkRole === 'trainer'}
                onChange={() => setBulkRole('trainer')}
              />
              Подтвердить тренером
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="bulk-role"
                checked={bulkRole === 'admin'}
                onChange={() => setBulkRole('admin')}
              />
              Подтвердить админом
            </label>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={
                bulkBusy ||
                pendingGroups.every((i) => !bulkSelected.has(i.sessionKey))
              }
              onClick={confirmBulk}
            >
              {bulkBusy ? 'Подтверждаем…' : 'Подтвердить'}
            </button>
          </div>
        </div>
      ) : null}

      {message && !selected ? (
        <p
          className={
            isBookingControlErrorMessage(message)
              ? 'rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
              : 'text-sm text-fitgo-300'
          }
          role="status"
        >
          {message}
        </p>
      ) : null}
      {showOpsHints &&
      !loading &&
      !fixedKind &&
      saleCount === 0 &&
      (kind === 'ALL' || kind === 'PT') ? (
        <p className="text-xs text-slate-500">
          Разовых ПТ из продаж за период нет. Нажмите «Обновить период из 1С»
          выше (по выбранным датам), расширьте период (Неделя / Месяц) или
          проверьте FITNESS_PROVIDER=forma и FORMA_FITGO_URL.
        </p>
      ) : null}

      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : visible.length === 0 ? (
        <p className="text-slate-400">
          {showQueue && queue === 'pending'
            ? 'На контроле за период пусто'
            : showQueue && queue === 'done'
              ? 'Прошедших контроль за период нет'
              : showQueue && queue === 'upcoming'
                ? 'В периоде нет записей, которые ещё не начались'
                : 'Нет записей за период'}
          {showQueue &&
          queue === 'pending' &&
          from === to &&
          pendingCount === 0
            ? ' — расширьте период: «Неделя» или «Месяц»'
            : ''}
        </p>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {visible.map((item) => {
              const a = attendanceOf(item);
              const pay = paymentCell(item);
              return (
                <li key={item.sessionKey}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(item.sessionKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openDetail(item.sessionKey);
                      }
                    }}
                    className="card w-full cursor-pointer text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs text-slate-400">
                        {formatDay(item.startAt)} · {formatClock(item.startAt)}
                        {!fixedKind ? ` · ${kindRu(item.kind)}` : ''}
                      </p>
                      <p className="shrink-0 text-xs text-slate-300">
                        {statusRu(item.status)}
                      </p>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-snug text-slate-100">
                      {item.title}
                    </p>
                    {item.clientName && item.kind !== 'GROUP' ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {item.clientName}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      записано {a.booked} · пришло {a.arrived}
                      {a.noShow > 0 ? ` · не пришло ${a.noShow}` : ''}
                      {item.performerName && item.performerName !== '—'
                        ? ` · ${item.performerName}`
                        : ''}
                    </p>
                    {pay !== '—' ||
                    item.needsReview ||
                    item.approvalLabel ||
                    item.source === 'SALE' ||
                    item.source === 'FITGO' ||
                    item.missingJournal ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pay !== '—' ? (
                          <span
                            className={
                              item.payment === 'DEBT'
                                ? 'text-xs text-rose-300'
                                : 'text-xs text-slate-300'
                            }
                          >
                            {pay}
                          </span>
                        ) : null}
                        {item.source === 'SALE' ? (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            продажа
                          </span>
                        ) : null}
                        {item.source === 'FITGO' && !item.oneCLinked ? (
                          <span className={hintBadgeClass('notIn1c')}>
                            нет в 1С
                          </span>
                        ) : null}
                        {item.missingJournal ? (
                          <span className={hintBadgeClass('notIn1c')}>
                            нет в журнале
                          </span>
                        ) : null}
                        {item.needsReview ? (
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300 ring-1 ring-inset ring-rose-400/30">
                            проверка
                          </span>
                        ) : null}
                        {item.approvalLabel ? (
                          <span
                            className={hintBadgeClass(
                              approvalHintTone(item.approvalLabel),
                            )}
                          >
                            {item.approvalLabel}
                          </span>
                        ) : null}
                        {item.missingJournal && api.adoptSpaToJournal ? (
                          <button
                            type="button"
                            className="rounded bg-fitgo-500/25 px-1.5 py-0.5 text-[10px] text-fitgo-200 ring-1 ring-inset ring-fitgo-400/40"
                            disabled={adoptBusyKey === item.sessionKey}
                            onClick={(e) => {
                              e.stopPropagation();
                              void adoptToJournal(item.sessionKey);
                            }}
                          >
                            {adoptBusyKey === item.sessionKey
                              ? '…'
                              : 'В журнал'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <AdminStickyTable className="hidden md:block" tableClassName="w-full">
              <thead className="bg-slate-900/80 text-xs font-medium text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2">Дата время</th>
                  <th className="px-3 py-2">Вид</th>
                  <th className="px-3 py-2">Наименование</th>
                  <th className="px-3 py-2">Сотрудник</th>
                  <th className="px-3 py-2 text-right">Записано</th>
                  <th className="px-3 py-2 text-right">Прибыло</th>
                  <th className="px-3 py-2 text-right">Не прибыло</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Оплата</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const a = attendanceOf(item);
                  const pay = paymentCell(item);
                  const title = [
                    item.title,
                    item.clientName && item.kind !== 'GROUP'
                      ? item.clientName
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <tr
                      key={item.sessionKey}
                      className="cursor-pointer border-t border-slate-800/80 hover:bg-slate-900/60"
                      onClick={() => openDetail(item.sessionKey)}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {formatDateTime(item.startAt)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {kindRu(item.kind)}
                        {item.source === 'SALE' ? (
                          <span className="ml-1 rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-300">
                            продажа
                          </span>
                        ) : null}
                        {item.source === 'FITGO' && !item.oneCLinked ? (
                          <span className={hintBadgeClass('notIn1c', true)}>
                            нет в 1С
                          </span>
                        ) : null}
                        {item.missingJournal ? (
                          <span className={hintBadgeClass('notIn1c', true)}>
                            нет в журнале
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-white">
                        <span className="block max-w-[16rem] truncate" title={title}>
                          {item.title}
                          {item.clientName && item.kind !== 'GROUP' ? (
                            <span className="text-slate-500">
                              {' '}
                              · {item.clientName}
                            </span>
                          ) : null}
                        </span>
                        {item.needsReview ? (
                          <span className="ml-1 rounded bg-rose-500/20 px-1 py-0.5 text-[10px] text-rose-300">
                            проверка
                          </span>
                        ) : null}
                        {item.approvalLabel ? (
                          <span
                            className={hintBadgeClass(
                              approvalHintTone(item.approvalLabel),
                              true,
                            )}
                          >
                            {item.approvalLabel}
                          </span>
                        ) : null}
                        {item.missingJournal && api.adoptSpaToJournal ? (
                          <button
                            type="button"
                            className="ml-1 rounded bg-fitgo-500/25 px-1.5 py-0.5 text-[10px] text-fitgo-200 ring-1 ring-inset ring-fitgo-400/40"
                            disabled={adoptBusyKey === item.sessionKey}
                            onClick={(e) => {
                              e.stopPropagation();
                              void adoptToJournal(item.sessionKey);
                            }}
                          >
                            {adoptBusyKey === item.sessionKey
                              ? '…'
                              : 'В журнал'}
                          </button>
                        ) : null}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-slate-300">
                        {item.performerName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                        {a.booked}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                        {a.arrived}
                      </td>
                      <td
                        className={
                          a.noShow > 0
                            ? 'px-3 py-2 text-right tabular-nums text-amber-300'
                            : 'px-3 py-2 text-right tabular-nums text-slate-500'
                        }
                      >
                        {a.noShow}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                        {statusRu(item.status)}
                      </td>
                      <td
                        className={
                          item.payment === 'DEBT'
                            ? 'px-3 py-2 text-rose-300'
                            : 'px-3 py-2 text-slate-300'
                        }
                      >
                        <span className="block max-w-[10rem] truncate" title={pay}>
                          {pay}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </AdminStickyTable>
        </>
      )}
      </>
      )}

      {detailOnly && message && !selected ? (
        <p
          className={
            isBookingControlErrorMessage(message)
              ? 'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-rose-500/40 bg-slate-900 px-3 py-2 text-sm text-rose-200 shadow-lg'
              : 'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-sm text-fitgo-300 shadow-lg'
          }
          role="status"
        >
          {message}
        </p>
      ) : null}

      {(selected || detailLoading || detailError) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:items-center">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
            {!selected ? (
              <div className="space-y-3">
                {detailError && !detailLoading ? (
                  <p className="text-sm text-rose-300">{detailError}</p>
                ) : (
                  <p className="text-slate-400">Загрузка…</p>
                )}
                {detailOnly || detailError ? (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={closeDetail}
                  >
                    Закрыть
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                {detailLoading ? (
                  <p className="text-xs text-slate-500">Обновляем данные…</p>
                ) : null}
                {message ? (
                  <p
                    className={
                      isBookingControlErrorMessage(message)
                        ? 'rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
                        : 'rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'
                    }
                    role="status"
                  >
                    {message}
                  </p>
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">
                      {kindRu(selected.kind)} · {statusRu(selected.status)}
                      {selected.number ? ` · № ${selected.number}` : ''}
                      {selected.payTag
                        ? ` · ${payTagLabelRu(selected.payTag, {
                            packageName:
                              selected.spaSettlement?.membershipName,
                          })}`
                        : ''}
                      {selected.history && selected.history.length > 0 ? (
                        <span className="relative ml-1.5 inline-block">
                          <button
                            type="button"
                            className="text-sky-400/90 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
                            aria-expanded={historyOpen}
                            aria-label="История записи"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryOpen((v) => !v);
                            }}
                          >
                            история
                          </button>
                          {historyOpen ? (
                            <span
                              role="tooltip"
                              className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-2 text-left text-[11px] leading-snug text-slate-300 shadow-lg"
                            >
                              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                История
                              </span>
                              <ul className="space-y-1">
                                {selected.history.map((ev, i) => (
                                  <li key={`${ev.at}-${i}`}>
                                    <span className="text-slate-400">
                                      {formatDateTime(ev.at)}
                                    </span>
                                    {' · '}
                                    {ev.action}
                                    {ev.byName ? ` · ${ev.byName}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </p>
                    <h2 className="truncate text-lg font-semibold">
                      {selected.title}
                    </h2>
                    {selected.kind === 'SPA' &&
                    selected.fitgoBookingId &&
                    api.updateSpaService &&
                    spaServices.length > 0 ? (
                      <label className="mt-1 block space-y-1 text-sm">
                        <span className="text-[11px] text-slate-500">
                          Услуга
                        </span>
                        <select
                          className="input w-full text-sm"
                          disabled={serviceBusy}
                          value={selected.serviceId ?? ''}
                          onChange={(e) =>
                            void changeSpaService(e.target.value)
                          }
                        >
                          {!selected.serviceId ? (
                            <option value="">— выберите —</option>
                          ) : null}
                          {spaServices.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selected.kind === 'SPA' &&
                    selected.fitgoBookingId &&
                    spaBookingEditHref ? (
                      <p className="mt-1">
                        <a
                          className="text-sm text-fitgo-400 underline-offset-2 hover:underline"
                          href={spaBookingEditHref(selected.fitgoBookingId)}
                        >
                          Открыть запись
                        </a>
                      </p>
                    ) : null}
                    {selected.kind === 'SPA' &&
                    showSpaLinkHints &&
                    selected.oneCTitle ? (
                      <p className="mt-1 text-xs text-slate-500">
                        в 1С: {selected.oneCTitle}
                      </p>
                    ) : null}
                    <p className="text-sm text-slate-400">
                      {formatDateTime(selected.startAt)}
                      {selected.endAt
                        ? ` – ${formatDateTime(selected.endAt)}`
                        : ''}
                      {selected.roomTitle ? ` · ${selected.roomTitle}` : ''}
                    </p>
                    <p className="text-sm text-slate-400">
                      {selected.performerName}
                      {selected.kind !== 'GROUP' && selected.clientName
                        ? ` · ${selected.clientName}`
                        : ''}
                    </p>
                    {selected.kind !== 'GROUP' && selected.clientName ? (
                      <p className="mt-1 text-sm">
                        <button
                          type="button"
                          className="text-fitgo-400 underline-offset-2 hover:underline"
                          onClick={() =>
                            filterToClientBookings(
                              selected.clientName!,
                              selected.clientId,
                            )
                          }
                        >
                          Записи клиента
                        </button>
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-slate-300">
                      Записано {selected.bookedCount ?? attendanceOf(selected).booked}
                      {' · '}
                      <span className="text-emerald-300">
                        прибыло{' '}
                        {selected.arrivedCount ??
                          attendanceOf(selected).arrived}
                      </span>
                      {' · '}
                      <span
                        className={
                          (selected.noShowCount ??
                            attendanceOf(selected).noShow) > 0
                            ? 'text-amber-300'
                            : 'text-slate-500'
                        }
                      >
                        не прибыло{' '}
                        {selected.noShowCount ??
                          attendanceOf(selected).noShow}
                      </span>
                    </p>
                    {selected.missingJournal ? (
                      <p className={`mt-2 ${HINT_PANEL_COLOR.notIn1c}`}>
                        Есть в 1С, нет в журнале FitGO. Добавьте запись — дубль
                        в контроле исчезнет, повторного списания в 1С не будет.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {canViewHallPhotos &&
                      selected.kind === 'GROUP' &&
                      selected.source === '1C' &&
                      api.listHallSnapshots && (
                        <button
                          type="button"
                          className="btn-secondary text-sm"
                          onClick={() => void openPhotos()}
                        >
                          Фото
                        </button>
                      )}
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={closeDetail}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
                {selected.missingJournal && api.adoptSpaToJournal ? (
                  <div className="flex flex-wrap items-end gap-2 rounded-xl border border-orange-500/35 bg-orange-500/10 p-3">
                    {api.listSpaServices ? (
                      <label className="min-w-[12rem] flex-1 space-y-1 text-sm">
                        <span className="text-[11px] text-slate-500">
                          Услуга (если не подобралась сама)
                        </span>
                        <select
                          className="input"
                          value={adoptServiceId}
                          onChange={(e) => setAdoptServiceId(e.target.value)}
                        >
                          <option value="">Авто</option>
                          {spaServices.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      disabled={adoptBusyKey === selected.sessionKey}
                      onClick={() =>
                        void adoptToJournal(
                          selected.sessionKey,
                          adoptServiceId || undefined,
                        )
                      }
                    >
                      {adoptBusyKey === selected.sessionKey
                        ? 'Добавляем…'
                        : 'Добавить в журнал'}
                    </button>
                  </div>
                ) : null}
                {photosOpen && (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Фото зала (+20 / +40 мин)
                      </p>
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:text-slate-200"
                        onClick={closePhotos}
                      >
                        Скрыть
                      </button>
                    </div>
                    {photosLoading && (
                      <p className="text-sm text-slate-400">Загрузка…</p>
                    )}
                    {photosError ? (
                      <p className="text-sm text-rose-300">{photosError}</p>
                    ) : null}
                    {!photosLoading && !photosError && photos.length === 0 && (
                      <p className="text-sm text-slate-400">
                        Снимков пока нет. Агент снимет кадры через 20 и 40 минут
                        после начала, если зал привязан к камере.
                      </p>
                    )}
                    <ul className="space-y-3">
                      {photos.map((snap) => (
                        <li
                          key={snap.id}
                          className="rounded-lg border border-slate-800 p-2 text-sm"
                        >
                          <p className="text-slate-300">
                            +{snap.offsetMin} мин ·{' '}
                            {formatDateTime(snap.slotAt)}
                            {snap.cameraLabel
                              ? ` · ${snap.cameraLabel}`
                              : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {snap.status === 'CAPTURED'
                              ? 'снято'
                              : snap.status === 'FAILED'
                                ? `не снято${snap.errorMessage ? `: ${snap.errorMessage}` : ''}`
                                : snap.captureAttempts &&
                                    snap.captureAttempts > 0
                                  ? `повтор${snap.nextAttemptAt ? ` ~${formatDateTime(snap.nextAttemptAt)}` : ''}${snap.errorMessage ? ` · ${snap.errorMessage}` : ''}`
                                  : 'ожидается'}
                          </p>
                          {photoUrls[snap.id] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photoUrls[snap.id]}
                              alt={`Снимок +${snap.offsetMin} мин`}
                              className="mt-2 max-h-64 w-full rounded-md object-contain"
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.source === 'SALE' && selected.payment === 'PAID' && (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    Разовая ПТ из строки продажи 1С (исполнитель + сумма). В ЗП:
                    сумма × % из карточки мотивации ПТ.
                  </p>
                )}
                {selected.source === 'SALE' && selected.payment === 'DEBT' && (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    Нет оплаты — в ЗП не входит, пока продажа не оплачена в 1С.
                  </p>
                )}
                {selected.kind !== 'GROUP' && (
                  <p
                    className={
                      selected.payment === 'DEBT'
                        ? 'text-sm font-medium text-rose-300'
                        : 'text-sm text-slate-300'
                    }
                  >
                    {paymentLabelRu(selected.payment)}
                    {selected.payTag
                      ? ` · ${payTagLabelRu(selected.payTag, {
                          packageName:
                            selected.spaSettlement?.membershipName,
                        })}`
                      : ''}
                    {detailPriceMinor != null
                      ? ` · ${(detailPriceMinor / 100).toFixed(2)} BYN`
                      : ''}
                  </p>
                )}
                {selected.kind === 'SPA' && selected.spaSettlement ? (
                  <p
                    className={
                      selected.spaSettlement.status === 'PAID' ||
                      selected.spaSettlement.status === 'QUOTA_CONSUMED' ||
                      selected.spaSettlement.status === 'MANUAL_PAID'
                        ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'
                        : selected.spaSettlement.status === 'AWAITING_PAYMENT' ||
                            selected.spaSettlement.status === 'NOT_IN_1C' ||
                            selected.spaSettlement.status ===
                              'AWAITING_CLIENT_LINK' ||
                            selected.spaSettlement.status === 'DELETED_IN_1C'
                          ? 'rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200'
                          : selected.spaSettlement.status === 'CANCELLED_IN_1C'
                            ? 'rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
                            : 'rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-300'
                    }
                  >
                    {selected.spaSettlement.label}
                    {!selected.spaSettlement.membershipName && spaDocNumber
                      ? ` · док. ${spaDocNumber}`
                      : ''}
                  </p>
                ) : null}
                {selected.kind === 'SPA' &&
                showSpaLinkHints &&
                selected.spaLinkHint &&
                selected.spaLinkHint.kind !== 'LINKED' ? (
                  <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm">
                    <p className="text-slate-200">
                      {selected.spaLinkHint.message}
                    </p>
                    <ul className="space-y-1.5">
                      {selected.spaLinkHint.candidates.map((c) => (
                        <li
                          key={c.externalId}
                          className="flex flex-wrap items-center gap-2 text-xs text-slate-400"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {c.kind === 'sale' && c.occurredAt
                              ? `${formatDateTime(c.occurredAt)} · `
                              : ''}
                            {c.label}
                            {c.performerName
                              ? ` · ${c.performerName}`
                              : ''}
                          </span>
                          {c.kind === 'sale' &&
                          api.linkSpaSale &&
                          selected.fitgoBookingId &&
                          selected.spaLinkHint ? (
                            <span className="inline-flex flex-wrap gap-1">
                              {selected.spaLinkHint.kind ===
                                'SALE_OTHER_NOMENCLATURE' &&
                              c.serviceId ? (
                                <button
                                  type="button"
                                  className="btn-secondary px-2 py-0.5 text-[11px]"
                                  disabled={linkDocBusy}
                                  onClick={() =>
                                    void linkSelectedSale(
                                      c.externalId,
                                      c.serviceId,
                                    )
                                  }
                                >
                                  Поставить эту услугу
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="btn-primary px-2 py-0.5 text-[11px]"
                                disabled={linkDocBusy}
                                onClick={() =>
                                  void linkSelectedSale(c.externalId)
                                }
                              >
                                {selected.spaLinkHint.kind === 'RELINK' ||
                                selected.linkedSaleExternalId
                                  ? 'Заменить'
                                  : 'Привязать'}
                              </button>
                            </span>
                          ) : null}
                          {c.kind === 'visit' &&
                          api.linkSpaVisit &&
                          selected.fitgoBookingId ? (
                            <button
                              type="button"
                              className="btn-primary px-2 py-0.5 text-[11px]"
                              disabled={linkDocBusy}
                              onClick={() =>
                                void linkSelectedVisit(c.externalId)
                              }
                            >
                              Привязать
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {selected.kind === 'SPA' &&
                showSpaLinkHints &&
                selected.fitgoBookingId &&
                api.unlinkSpaDocument &&
                (selected.linkedSaleExternalId ||
                  (selected.oneCLinked &&
                    selected.source === 'FITGO' &&
                    selected.crmDocRef &&
                    !selected.spaSettlement?.visitPosted)) ? (
                  <p>
                    <button
                      type="button"
                      className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
                      disabled={linkDocBusy}
                      onClick={() => void unlinkSelectedSpa()}
                    >
                      Отвязать документ 1С
                    </button>
                  </p>
                ) : null}
                {selected.kind === 'SPA' &&
                selected.fitgoBookingId &&
                api.updateSpaGuestPhone &&
                selected.spaSettlement?.status === 'AWAITING_CLIENT_LINK' ? (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                    <p className="text-sm text-slate-300">
                      Телефон для привязки к 1С
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 space-y-1 text-sm">
                        <span className="text-[11px] text-slate-500">
                          Номер
                        </span>
                        <input
                          className="input"
                          value={linkPhone}
                          onChange={(e) => setLinkPhone(e.target.value)}
                          placeholder="+375…"
                        />
                      </label>
                      <button
                        type="button"
                        className="btn-primary text-sm"
                        disabled={linkPhoneBusy}
                        onClick={() => void saveSpaGuestPhone()}
                      >
                        {linkPhoneBusy ? '…' : 'Сохранить номер'}
                      </button>
                    </div>
                    {linkPhoneMsg ? (
                      <p className="text-xs text-slate-400">{linkPhoneMsg}</p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Номер сохранится в записи. Если клиент есть в 1С —
                        привязка выполнится автоматически.
                      </p>
                    )}
                  </div>
                ) : null}
                {selected.members.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Состав (
                      {selected.arrivedCount ??
                        selected.members.filter((m) => m.attendance === 'ATTENDED')
                          .length}{' '}
                      пришли · записано{' '}
                      {selected.bookedCount ??
                        selected.members.filter((m) => m.attendance !== 'CANCELLED')
                          .length}
                      )
                    </p>
                    {selected.kind === 'GROUP' &&
                    selected.groupApproval &&
                    selected.groupApproval.trainerSeenCount !==
                      (selected.arrivedCount ?? 0) ? (
                      <p className="text-xs text-amber-300/90">
                        Тренер отметил {selected.groupApproval.trainerSeenCount}{' '}
                        · в 1С прибыло {selected.arrivedCount ?? 0}
                      </p>
                    ) : null}
                    {canTrainerSeen &&
                    selected.kind === 'GROUP' &&
                    selected.source === '1C' &&
                    (seenSaving || seenSaveError) ? (
                      <p
                        className={
                          seenSaveError
                            ? 'text-xs text-rose-300/90'
                            : 'text-xs text-slate-500'
                        }
                      >
                        {seenSaving
                          ? 'Сохраняем отметки…'
                          : `Не сохранилось — нажмите галочку ещё раз. ${seenSaveError}`}
                      </p>
                    ) : null}
                    <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 text-sm">
                      {selected.members.map((m) => (
                        <li
                          key={m.externalId}
                          className="flex flex-wrap items-center gap-2 border-b border-slate-900 px-2 py-1.5 last:border-0"
                        >
                          {canTrainerSeen &&
                          selected.kind === 'GROUP' &&
                          selected.source === '1C' &&
                          m.attendance !== 'CANCELLED' &&
                          !selected.groupApproval?.locked ? (
                            <label className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-[11px] text-slate-400">
                              <input
                                type="checkbox"
                                className="rounded border-slate-600"
                                checked={localSeen.has(m.externalId)}
                                onChange={() => toggleTrainerSeen(m.externalId)}
                                aria-label="Был на занятии"
                              />
                            </label>
                          ) : (
                            <span className="flex w-[4.5rem] shrink-0 flex-col gap-0.5 text-[11px] leading-tight text-slate-500">
                              <span>
                                {m.attendance === 'ATTENDED'
                                  ? 'Прибыл'
                                  : m.attendance === 'NO_SHOW'
                                    ? 'не пришёл'
                                    : m.attendance === 'CANCELLED'
                                      ? 'отмена'
                                      : 'ожид.'}
                              </span>
                              {localSeen.has(m.externalId) || m.trainerSeen ? (
                                <span className="text-amber-300/90">тренер</span>
                              ) : null}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {m.clientName}
                            {m.paymentBasis ? (
                              <span className="text-slate-500">
                                {' '}
                                · {m.paymentBasis}
                              </span>
                            ) : null}
                          </span>
                          {canMarkAttendance &&
                          api.setAttendance &&
                          selected.kind === 'GROUP' &&
                          selected.source === '1C' &&
                          m.attendance !== 'CANCELLED' &&
                          !selected.groupApproval?.locked ? (
                            <span
                              className="inline-flex shrink-0 overflow-hidden rounded border border-slate-700"
                              role="group"
                              aria-label="Явка клиента"
                            >
                              <button
                                type="button"
                                className={
                                  m.attendance === 'ATTENDED'
                                    ? 'bg-emerald-500/25 px-1.5 py-0.5 text-[11px] font-medium text-emerald-200'
                                    : 'px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                                }
                                disabled={attendanceBusyId === m.externalId}
                                aria-pressed={m.attendance === 'ATTENDED'}
                                onClick={() => {
                                  if (m.attendance === 'ATTENDED') return;
                                  void markAttendance(m.externalId, 'ATTENDED');
                                }}
                              >
                                Прибыл
                              </button>
                              <button
                                type="button"
                                className={
                                  m.attendance === 'NO_SHOW'
                                    ? 'border-l border-slate-700 bg-rose-500/25 px-1.5 py-0.5 text-[11px] font-medium text-rose-200'
                                    : 'border-l border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300'
                                }
                                disabled={attendanceBusyId === m.externalId}
                                aria-pressed={m.attendance === 'NO_SHOW'}
                                onClick={() => {
                                  if (m.attendance === 'NO_SHOW') return;
                                  void markAttendance(m.externalId, 'NO_SHOW');
                                }}
                              >
                                Не прибыл
                              </button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.kind === 'GROUP' && selected.groupApproval && (
                  <div
                    className={
                      selected.groupApproval.phase === 'APPROVED'
                        ? 'space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-slate-300'
                        : `space-y-2 ${HINT_PANEL_COLOR[selected.groupApproval.phase === 'PENDING_ADMIN' ? 'admin' : 'trainer']}`
                    }
                  >
                    {selected.groupApproval.phase === 'APPROVED' ? (
                      <p className="text-emerald-300">
                        Подтверждено
                        {selected.groupApproval.overrideName
                          ? ` · ${selected.groupApproval.overrideName}`
                          : selected.groupApproval.adminName
                            ? ` · админ ${selected.groupApproval.adminName}`
                            : ''}
                        {selected.groupApproval.trainerName
                          ? ` · тренер ${selected.groupApproval.trainerName}`
                          : ''}
                      </p>
                    ) : selected.groupApproval.phase === 'PENDING_ADMIN' ? (
                      <p className={HINT_TEXT_COLOR.admin}>
                        Проверено тренером
                        {selected.groupApproval.trainerName
                          ? `: ${selected.groupApproval.trainerName}`
                          : ''}
                        {' · ждёт администратора'}
                      </p>
                    ) : (
                      <p className={HINT_TEXT_COLOR.trainer}>
                        Ждёт подтверждения тренера
                      </p>
                    )}
                    {selected.groupApproval.returnedAt ? (
                      <p className="text-rose-300">
                        Возврат
                        {selected.groupApproval.returnedByName
                          ? ` · ${selected.groupApproval.returnedByName}`
                          : ''}
                        {!selected.groupApproval.approvalNotes?.length &&
                        selected.groupApproval.returnComment
                          ? `: ${selected.groupApproval.returnComment}`
                          : ''}
                      </p>
                    ) : null}
                    {selected.groupApproval.locked ? (
                      <p className="text-slate-500">Период ЗП закрыт — только просмотр</p>
                    ) : null}
                    {selected.groupApproval.approvalNotes?.length ? (
                      <div className="space-y-1 border-t border-slate-700/60 pt-2">
                        {(() => {
                          const notes = selected.groupApproval.approvalNotes!;
                          const last = notes[notes.length - 1]!;
                          const older = notes.length - 1;
                          return (
                            <>
                              <p className="break-words text-slate-300">
                                <span className="text-slate-400">
                                  {last.authorName} ·{' '}
                                  {approvalNoteActionRu(last.action)}:{' '}
                                </span>
                                {last.text}
                              </p>
                              {older > 0 ? (
                                <>
                                  <button
                                    type="button"
                                    className="text-[11px] text-sky-400/90 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
                                    aria-expanded={approvalNotesOpen}
                                    onClick={() =>
                                      setApprovalNotesOpen((v) => !v)
                                    }
                                  >
                                    {approvalNotesOpen
                                      ? 'свернуть'
                                      : `ещё ${older}`}
                                  </button>
                                  {approvalNotesOpen ? (
                                    <ul className="max-h-36 space-y-1.5 overflow-y-auto text-[11px] leading-snug text-slate-400">
                                      {notes.slice(0, -1).map((n, i) => (
                                        <li key={`${n.createdAt}-${i}`}>
                                          <span className="text-slate-500">
                                            {formatDateTime(n.createdAt)} ·{' '}
                                            {n.authorName} ·{' '}
                                            {approvalNoteActionRu(n.action)}:{' '}
                                          </span>
                                          <span className="text-slate-300">
                                            {n.text}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                )}
                {selected.kind === 'SPA' && selected.status !== 'CANCELLED'
                  ? (() => {
                      if (selected.approvalPhase === 'APPROVED') {
                        return (
                          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-slate-300">
                            <p className="text-emerald-300">Подтверждено администратором</p>
                            {selected.returnComment ? (
                              <p className="text-rose-300">
                                Комментарий: {selected.returnComment}
                              </p>
                            ) : null}
                          </div>
                        );
                      }
                      const spaLabel = spaPendingLabel(
                        selected.approvalLabel,
                        selected.approvalPhase,
                      );
                      const spaTone = approvalHintTone(spaLabel);
                      return (
                        <div className={`space-y-2 ${HINT_PANEL_COLOR[spaTone]}`}>
                          <p className={HINT_TEXT_COLOR[spaTone]}>{spaLabel}</p>
                          {selected.returnComment ? (
                            <p className="text-rose-300 text-xs">
                              {selected.returnComment}
                            </p>
                          ) : null}
                          {canConfirmSelected ? (
                            <button
                              type="button"
                              className="btn-primary w-full text-sm"
                              onClick={() => void approveGroup()}
                              disabled={approveBusy}
                            >
                              {approveBusy ? 'Подтверждаем…' : 'Подтвердить'}
                            </button>
                          ) : null}
                        </div>
                      );
                    })()
                  : null}
                {selected.kind === 'PT' && selected.status !== 'CANCELLED'
                  ? (() => {
                      const hasFitgo =
                        Boolean(selected.fitgoBookingId) ||
                        selected.source === 'FITGO';
                      if (!hasFitgo) {
                        return (
                          <p className="rounded-xl border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-400">
                            ПТ из журнала 1С не требует вашей отметки — явка уже
                            в 1С. Замечание ниже только если нужна проверка
                            администратора.
                          </p>
                        );
                      }
                      if (selected.approvalPhase === 'APPROVED') {
                        return (
                          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-slate-300">
                            <p className="text-emerald-300">Подтверждено администратором</p>
                            {selected.returnComment ? (
                              <p className="text-rose-300">
                                Комментарий: {selected.returnComment}
                              </p>
                            ) : null}
                          </div>
                        );
                      }
                      const ptLabel =
                        selected.approvalLabel ||
                        (selected.approvalPhase === 'PENDING_ADMIN'
                          ? 'Ждёт администратора'
                          : 'Ждёт вашей отметки');
                      const ptTone = approvalHintTone(ptLabel);
                      return (
                        <div className={`space-y-2 ${HINT_PANEL_COLOR[ptTone]}`}>
                          <p className={HINT_TEXT_COLOR[ptTone]}>{ptLabel}</p>
                          {selected.returnComment ? (
                            <p className="text-rose-300 text-xs">
                              {selected.returnComment}
                            </p>
                          ) : null}
                          {canConfirmSelected ? (
                            <button
                              type="button"
                              className="btn-primary w-full text-sm"
                              onClick={() => void approveGroup()}
                              disabled={approveBusy}
                            >
                              {approveBusy ? 'Подтверждаем…' : 'Подтвердить'}
                            </button>
                          ) : null}
                        </div>
                      );
                    })()
                  : null}
                {(selected.kind === 'PT' || selected.kind === 'SPA') &&
                selected.approvalNotes?.length ? (
                  <div className="space-y-1 rounded-lg border border-slate-700/60 bg-slate-900/40 p-2 text-xs">
                    {(() => {
                      const notes = selected.approvalNotes!;
                      const last = notes[notes.length - 1]!;
                      const older = notes.length - 1;
                      return (
                        <>
                          <p className="break-words text-slate-300">
                            <span className="text-slate-400">
                              {last.authorName} ·{' '}
                              {approvalNoteActionRu(last.action)}:{' '}
                            </span>
                            {last.text}
                          </p>
                          {older > 0 ? (
                            <>
                              <button
                                type="button"
                                className="text-[11px] text-sky-400/90 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
                                aria-expanded={approvalNotesOpen}
                                onClick={() =>
                                  setApprovalNotesOpen((v) => !v)
                                }
                              >
                                {approvalNotesOpen
                                  ? 'свернуть'
                                  : `ещё ${older}`}
                              </button>
                              {approvalNotesOpen ? (
                                <ul className="max-h-36 space-y-1.5 overflow-y-auto text-[11px] leading-snug text-slate-400">
                                  {notes.slice(0, -1).map((n, i) => (
                                    <li key={`${n.createdAt}-${i}`}>
                                      <span className="text-slate-500">
                                        {formatDateTime(n.createdAt)} ·{' '}
                                        {n.authorName} ·{' '}
                                        {approvalNoteActionRu(n.action)}:{' '}
                                      </span>
                                      <span className="text-slate-300">
                                        {n.text}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                ) : null}
                {showPtSpaReviseBox ? (
                  <div className="space-y-2">
                    <textarea
                      className="input min-h-[3rem] w-full text-sm"
                      placeholder={
                        canReviseRereview
                          ? 'Комментарий для администратора (обязательно)'
                          : 'Комментарий (необязательно)'
                      }
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    {canReviseUpdate ? (
                      <button
                        type="button"
                        className="btn-secondary w-full text-sm"
                        onClick={() => void reviseSelected('update')}
                        disabled={approveBusy}
                      >
                        {approveBusy ? 'Сохраняем…' : 'Сохранить изменения'}
                      </button>
                    ) : null}
                    {canReviseRereview ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary w-full text-sm"
                          onClick={() => void reviseSelected('rereview')}
                          disabled={approveBusy || comment.trim().length < 2}
                        >
                          {approveBusy
                            ? 'Отправляем…'
                            : 'Запросить повторную проверку'}
                        </button>
                        <p className="text-[11px] text-amber-200/80">
                          Запись снова ждёт администратора и временно не в ЗП
                        </p>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {selected.kind === 'GROUP' &&
                selected.source === '1C' &&
                !selected.groupApproval?.locked &&
                showConfirmAfterEndHint ? (
                  <p className="text-xs text-slate-400">
                    Отметки и комментарий сохраняются. Подтвердить можно после{' '}
                    {formatVisitClock(
                      selected.endAt ?? selected.startAt,
                    ) ?? 'окончания'}
                    .
                  </p>
                ) : null}
                {showGroupCommentBox ? (
                  <div className="space-y-2">
                    <textarea
                      className="input min-h-[3rem] w-full text-sm"
                      placeholder="Комментарий (необязательно)"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <div className="flex flex-col gap-2">
                      {showConfirmAfterEndHint &&
                      api.saveTrainerSeen &&
                      canTrainerSeen ? (
                        <button
                          type="button"
                          className="btn-secondary w-full text-sm"
                          onClick={() => void saveDraftComment()}
                          disabled={approveBusy || !comment.trim()}
                        >
                          {approveBusy ? 'Сохраняем…' : 'Сохранить комментарий'}
                        </button>
                      ) : null}
                      {canConfirmSelected ? (
                        <button
                          type="button"
                          className="btn-primary w-full text-sm"
                          onClick={() => void approveGroup()}
                          disabled={approveBusy}
                        >
                          {approveBusy ? 'Подтверждаем…' : 'Подтвердить'}
                        </button>
                      ) : null}
                      {canReviseUpdate ? (
                        <button
                          type="button"
                          className="btn-secondary w-full text-sm"
                          onClick={() => void reviseSelected('update')}
                          disabled={approveBusy}
                        >
                          {approveBusy ? 'Сохраняем…' : 'Сохранить изменения'}
                        </button>
                      ) : null}
                      {canReviseRereview ? (
                        <button
                          type="button"
                          className="btn-primary w-full text-sm"
                          onClick={() => void reviseSelected('rereview')}
                          disabled={approveBusy || comment.trim().length < 2}
                        >
                          {approveBusy
                            ? 'Отправляем…'
                            : 'Запросить повторную проверку'}
                        </button>
                      ) : null}
                      {canReviseRereview ? (
                        <p className="text-[11px] text-amber-200/80">
                          Запись снова ждёт администратора и временно не в ЗП
                        </p>
                      ) : null}
                      {canManagerRework && api.managerRework ? (
                        <button
                          type="button"
                          className="btn-secondary w-full text-sm"
                          onClick={() => void openManagerRework()}
                          disabled={approveBusy || reworkBusy}
                        >
                          На доработку
                        </button>
                      ) : canReturnApproval && api.returnGroupApproval ? (
                        <button
                          type="button"
                          className="btn-secondary w-full text-sm"
                          onClick={returnApproval}
                          disabled={approveBusy}
                        >
                          На доработку
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {selected.kind !== 'GROUP' && selected.remark && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                    <p className="font-medium text-rose-200">На проверке</p>
                    <p className="mt-1 text-slate-300">
                      {selected.remark.staffName}: {selected.remark.staffComment}
                    </p>
                    {selected.remark.assigneeName ? (
                      <p className="mt-1 text-xs text-amber-200/90">
                        Проверить / отработать:{' '}
                        {selected.remark.assigneeName}
                      </p>
                    ) : null}
                    {holdPreview?.line ? (
                      <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">
                        {holdPreview.line.replace(/\t/g, ' · ')}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-rose-200/80">
                      {holdPreview?.held !== false
                        ? 'Снято с расчёта ЗП до «Отработано»'
                        : 'В расчёте ЗП (замечание ещё не учтено — обновите)'}
                    </p>
                  </div>
                )}
                {selected.kind !== 'GROUP' &&
                canManagerRework &&
                api.managerRework ? (
                  <button
                    type="button"
                    className="btn-secondary w-full text-sm"
                    onClick={() => void openManagerRework()}
                    disabled={reworkBusy}
                  >
                    На доработку
                  </button>
                ) : null}
                {selected.kind !== 'GROUP' && !selected.remark && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Замечание снимает занятие с ЗП до ответа администратора
                    </p>
                    <textarea
                      className="input min-h-[4rem] w-full text-sm"
                      placeholder="Комментарий к занятию"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    {canAssignRemark &&
                    api.assignRemark &&
                    remarkAssignees.length > 0 ? (
                      <label className="block text-xs text-slate-500">
                        Кто должен проверить и отработать
                        <select
                          className="input mt-1 block w-full text-sm"
                          value={remarkAssigneeId}
                          onChange={(e) => setRemarkAssigneeId(e.target.value)}
                        >
                          <option value="">Общая очередь</option>
                          {remarkAssignees.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="btn-secondary w-full text-sm"
                      onClick={submitRemark}
                      disabled={!comment.trim()}
                    >
                      Отправить на проверку
                    </button>
                  </div>
                )}
                {spaEditableInApp && cancelSpaBooking ? (
                  <button
                    type="button"
                    className="btn-secondary w-full text-sm text-rose-300"
                    onClick={() => void cancelSelectedSpa()}
                  >
                    Удалить запись (нет живого документа в 1С)
                  </button>
                ) : null}
                {selected.kind !== 'GROUP' &&
                  canResolve &&
                  selected.remark?.status === 'OPEN' &&
                  api.resolveRemark && (
                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      {canAssignRemark &&
                      api.assignRemark &&
                      remarkAssignees.length > 0 ? (
                        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                          <p className="text-xs font-medium text-slate-300">
                            На доработку — кто проверит
                          </p>
                          <select
                            className="input w-full text-sm"
                            value={remarkAssigneeId}
                            onChange={(e) =>
                              setRemarkAssigneeId(e.target.value)
                            }
                          >
                            <option value="">Выберите сотрудника</option>
                            {remarkAssignees.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-secondary w-full text-sm"
                            onClick={() => void assignOpenRemark()}
                            disabled={assignBusy || !remarkAssigneeId}
                          >
                            {assignBusy ? 'Назначаем…' : 'Передать на проверку'}
                          </button>
                        </div>
                      ) : null}
                      <textarea
                        className="input min-h-[4rem] w-full text-sm"
                        placeholder="Ответ администратора (необязательно)"
                        value={adminComment}
                        onChange={(e) => setAdminComment(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary w-full text-sm"
                        onClick={() => void resolve()}
                      >
                        Отработано
                      </button>
                    </div>
                  )}
                {/* Legacy open remark on GROUP still visible */}
                {selected.kind === 'GROUP' && selected.remark?.status === 'OPEN' && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                    <p className="font-medium text-rose-200">Открытое замечание</p>
                    <p className="mt-1 text-slate-300">
                      {selected.remark.staffName}: {selected.remark.staffComment}
                    </p>
                    {selected.remark.assigneeName ? (
                      <p className="mt-1 text-xs text-amber-200/90">
                        Проверить / отработать:{' '}
                        {selected.remark.assigneeName}
                      </p>
                    ) : null}
                    {canResolve && api.resolveRemark ? (
                      <div className="mt-2 space-y-2">
                        {canAssignRemark &&
                        api.assignRemark &&
                        remarkAssignees.length > 0 ? (
                          <div className="space-y-2">
                            <select
                              className="input w-full text-sm"
                              value={remarkAssigneeId}
                              onChange={(e) =>
                                setRemarkAssigneeId(e.target.value)
                              }
                            >
                              <option value="">Выберите сотрудника</option>
                              {remarkAssignees.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn-secondary w-full text-sm"
                              onClick={() => void assignOpenRemark()}
                              disabled={assignBusy || !remarkAssigneeId}
                            >
                              {assignBusy
                                ? 'Назначаем…'
                                : 'Передать на проверку'}
                            </button>
                          </div>
                        ) : null}
                        <textarea
                          className="input min-h-[3rem] w-full text-sm"
                          placeholder="Ответ администратора (необязательно)"
                          value={adminComment}
                          onChange={(e) => setAdminComment(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-primary w-full text-sm"
                          onClick={() => void resolve()}
                        >
                          Отработано
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <ManagerReworkSheet
        open={reworkOpen}
        title="На доработку"
        subtitle={selected?.title}
        targets={reworkTargets}
        assignees={reworkAssignees}
        warning={reworkWarning}
        busy={reworkBusy}
        onClose={() => setReworkOpen(false)}
        onSubmit={submitManagerRework}
      />
    </div>
  );
}

/** Inclusive ISO day ranges, each at most `maxDays` long (YYYY-MM-DD, UTC). */
function splitIsoRangeInclusive(
  from: string,
  to: string,
  maxDays: number,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  if (!from || !to || from > to || maxDays < 1) return out;
  const cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return out;
  while (cur <= end) {
    const chunkFrom = cur.toISOString().slice(0, 10);
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    out.push({ from: chunkFrom, to: chunkEnd.toISOString().slice(0, 10) });
    cur.setTime(chunkEnd.getTime());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
