'use client';

import { SaleDetailDrawer } from '@/components/admin-sales/sale-detail-drawer';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { ClubPayrollReportPanel } from '@/components/payroll/club-payroll-report';
import { MotivationBreakdownList } from '@/components/payroll/motivation-breakdown-list';
import { PayrollPayoutsPanel } from '@/components/payroll/payroll-payouts-panel';
import { TrustBandDot } from '@/components/payroll/trust-band-dot';
import { DateField } from '@/components/ui/date-field';
import type {
  ClubRevenueDetailResponse,
  PayrollAdjustmentDto,
  PayrollPeriodSummary,
  StaffPaySummary,
  WorkUnit,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { createBookingControlApi } from '@/lib/booking-control-api';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import {
  formatCalculatedAt,
  getPayrollSummaryCache,
  isIsoDay,
  setPayrollSummaryCache,
} from '@/lib/view-memory';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

/** Client-paid amount for PT/SPA lines; dash when free / unknown. */
function unitCostLabel(u: WorkUnit, currency: string): string {
  if (u.kind !== 'SPA' && u.kind !== 'PT') return '—';
  if (u.priceMinor == null || u.priceMinor <= 0) return '—';
  return money(u.priceMinor, currency);
}

/**
 * Employee share from motivation (PT / SPA / GROUP).
 * Fixed quota / partner / GP hall rates still show earnMinor.
 */
function unitEarnLabel(u: WorkUnit, currency: string): string {
  if (u.kind !== 'SPA' && u.kind !== 'PT' && u.kind !== 'GROUP') return '—';
  if (u.earnMinor == null) return '—';
  if (u.ratePercent != null && (u.priceMinor ?? 0) > 0) {
    return `${u.ratePercent}% · ${money(u.earnMinor, currency)}`;
  }
  return money(u.earnMinor, currency);
}

function unitShowsPayCols(u: WorkUnit): boolean {
  return u.kind === 'SPA' || u.kind === 'PT' || u.kind === 'GROUP';
}

/** Period totals under «Работы за период». */
function workUnitsPeriodTotals(units: WorkUnit[]) {
  let earnedMinor = 0;
  let soldMinor = 0;
  let classCount = 0;
  for (const u of units) {
    if (u.kind === 'GROUP') classCount += 1;
    if (!u.payrollTrusted || u.isComplimentary) continue;
    if (u.earnMinor != null) earnedMinor += u.earnMinor;
    else if (u.kind === 'SHIFT' && u.priceMinor != null) {
      earnedMinor += u.priceMinor;
    }
    if (
      (u.kind === 'SPA' || u.kind === 'PT') &&
      u.priceMinor != null &&
      u.priceMinor > 0
    ) {
      soldMinor += u.priceMinor;
    }
  }
  return { earnedMinor, soldMinor, classCount };
}

function unitDayIso(u: WorkUnit): string {
  return u.occurredAt.slice(0, 10);
}

/** Calendar day of a work unit in club local wall clock (ru-RU, with year). */
function unitDayLabel(u: WorkUnit): string {
  return new Date(u.occurredAt).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatIsoDayRu(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function shiftIsoDays(isoDay: string, deltaDays: number): string {
  const d = new Date(`${isoDay}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** True when sale opens as a single-document card (no tab switch). */
function unitHasSalePeek(u: WorkUnit): boolean {
  return Boolean(u.saleExternalId?.trim());
}

/**
 * Sales list deep-link when there is no single externalId (search by client /
 * program). Label in UI: «Список».
 */
function unitSaleListHref(u: WorkUnit, mode: 'admin' | 'super'): string | null {
  if (u.kind !== 'SPA' && u.kind !== 'PT' && u.kind !== 'GROUP') return null;
  if (unitHasSalePeek(u)) return null;
  const sessionDay = unitDayIso(u);
  const saleDay = u.saleOccurredAt?.slice(0, 10) || undefined;
  const q = new URLSearchParams();
  if (u.kind === 'GROUP') {
    if (!u.title?.trim() || !sessionDay) return null;
    q.set('from', sessionDay);
    q.set('to', sessionDay);
    q.set('q', u.title.trim());
  } else if (u.clientName?.trim()) {
    const looksPack = /\(абонемент\)|\(блок\)|абонемент|пакет|блок/i.test(
      u.title ?? '',
    );
    if (saleDay) {
      q.set('from', saleDay);
      q.set('to', saleDay);
    } else if (sessionDay && looksPack) {
      q.set('from', shiftIsoDays(sessionDay, -120));
      q.set('to', sessionDay);
    } else if (sessionDay) {
      q.set('from', sessionDay);
      q.set('to', sessionDay);
    }
    q.set('q', u.clientName.trim());
  } else if (u.title?.trim()) {
    if (sessionDay) {
      q.set('from', sessionDay);
      q.set('to', sessionDay);
    }
    q.set('q', u.title.trim());
  } else {
    return null;
  }
  const base = mode === 'super' ? '/super-admin/sales' : '/admin/sales';
  return `${base}?${q.toString()}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAYSLIP_SALE_SEGMENTS: Array<{
  label: string;
  sold: (s: PayrollPeriodSummary) => number;
  contrib: (s: PayrollPeriodSummary) => number;
}> = [
  {
    label: 'Абонементы',
    sold: (s) => s.sales?.membershipMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.membershipMinor ?? 0,
  },
  {
    label: 'SPA',
    sold: (s) => s.sales?.massageMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.spaMinor ?? 0,
  },
  {
    label: 'Солярий',
    sold: (s) => s.sales?.solariumMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.solariumMinor ?? 0,
  },
  {
    label: 'Магазин',
    sold: (s) => s.sales?.shopMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.shopMinor ?? 0,
  },
  {
    label: 'Корпо',
    sold: (s) => s.sales?.corporateMinor ?? 0,
    contrib: (s) => s.motivationBreakdown?.corporateMinor ?? 0,
  },
];

function hasPayslipSalesSegments(summary: PayrollPeriodSummary): boolean {
  return summary.sales != null || summary.motivationBreakdown != null;
}

function payslipSalesSegmentHtml(
  summary: PayrollPeriodSummary,
  cur: string,
): string | null {
  if (!hasPayslipSalesSegments(summary)) return null;
  const rows = PAYSLIP_SALE_SEGMENTS.map((seg) => {
    const sold = money(seg.sold(summary), cur);
    const contrib = money(seg.contrib(summary), cur);
    return `<tr><td>${escapeHtml(seg.label)}</td><td class="num">${escapeHtml(sold)}</td><td class="num">${escapeHtml(contrib)}</td></tr>`;
  }).join('');
  return `<h2>Продажи по сегментам</h2><table><thead><tr><th>Сегмент</th><th class="num">Продано</th><th class="num">В мотивацию</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function payslipHeaderOnly(fields: PayslipFields): boolean {
  return (
    (fields.fio || fields.period) &&
    !fields.motivation &&
    !fields.bonus &&
    !fields.fine &&
    !fields.shifts &&
    !fields.totals
  );
}

function payslipHtmlFromSummary(
  summary: PayrollPeriodSummary,
  fields: PayslipFields,
): string {
  const cur = summary.currency;
  const bonuses = summary.adjustments.filter((a) => a.amountMinor > 0);
  const fines = summary.adjustments.filter((a) => a.amountMinor < 0);
  const centered = payslipHeaderOnly(fields);
  const slipClass = centered ? 'slip slip--centered' : 'slip';
  const parts: string[] = [`<section class="${slipClass}">`];
  if (fields.fio || fields.period) {
    parts.push('<div class="header-block">');
    if (fields.fio) {
      parts.push(
        `<p class="meta"><strong>ФИО:</strong> ${escapeHtml(summary.performerName)}</p>`,
      );
    }
    if (fields.period) {
      parts.push(
        `<p class="meta"><strong>Период:</strong> ${escapeHtml(summary.from)} — ${escapeHtml(summary.to)}</p>`,
      );
    }
    parts.push('</div>');
  }
  if (fields.motivation) {
    parts.push('<h2>Начисления</h2><table>');
    parts.push(
      `<tr><td>Оклад / часы</td><td class="num">${escapeHtml(money(summary.baseSalaryMinor, cur))}</td></tr>`,
    );
    parts.push(
      `<tr><td>Мотивация</td><td class="num">${escapeHtml(money(summary.motivationMinor, cur))}</td></tr>`,
    );
    parts.push('</table>');
    const chips =
      summary.payChips?.length > 0 ? summary.payChips : ['Ставки не заданы'];
    parts.push(
      `<p class="chips">${chips.map((c) => escapeHtml(c)).join(' · ')}</p>`,
    );
    const salesBlock = payslipSalesSegmentHtml(summary, cur);
    if (salesBlock) parts.push(salesBlock);
  }
  if (fields.bonus) {
    parts.push('<h2>Премии</h2>');
    if (!bonuses.length) parts.push('<p class="empty">нет</p>');
    else {
      parts.push('<table>');
      for (const a of bonuses) {
        parts.push(
          `<tr><td>${escapeHtml(a.reason)}</td><td class="num">+${escapeHtml(money(a.amountMinor, cur))}</td></tr>`,
        );
      }
      parts.push('</table>');
    }
  }
  if (fields.fine) {
    parts.push('<h2>Штрафы</h2>');
    if (!fines.length) parts.push('<p class="empty">нет</p>');
    else {
      parts.push('<table>');
      for (const a of fines) {
        parts.push(
          `<tr><td>${escapeHtml(a.reason)}</td><td class="num">${escapeHtml(money(a.amountMinor, cur))}</td></tr>`,
        );
      }
      parts.push('</table>');
    }
  }
  if (fields.shifts) {
    const shifts = summary.workUnits.filter((u) => u.kind === 'SHIFT');
    parts.push('<h2>Смены</h2>');
    if (!shifts.length) parts.push('<p class="empty">нет</p>');
    else {
      parts.push('<table>');
      for (const u of shifts) {
        parts.push(
          `<tr><td>${escapeHtml(u.occurredAt.slice(0, 10))} · ${u.quantity} ч</td><td class="num">${escapeHtml(money(u.priceMinor ?? 0, cur))}</td></tr>`,
        );
      }
      parts.push('</table>');
    }
  }
  if (fields.totals) {
    parts.push(
      `<p class="total"><strong>Итого к выплате:</strong> ${escapeHtml(money(summary.totalMinor, cur))}</p>`,
    );
  }
  parts.push('</section>');
  return parts.join('\n');
}

function printHtmlPayslips(sections: Array<{ name: string; html: string }>) {
  if (!sections.length) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'style',
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0',
  );
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  const body = sections.map((s) => s.html).join('\n<div class="page-break"></div>\n');
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Печать</title>
<style>
  @page{size:A4;margin:16mm}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:0;font-size:13px;color:#111;line-height:1.45;background:#fff;margin:0}
  .slip{max-width:640px;margin:0 auto 24px;box-sizing:border-box}
  .slip--centered{max-width:none;width:100%;min-height:calc(297mm - 32mm);display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0}
  .header-block{text-align:center;margin:0 0 16px}
  .slip--centered .header-block{margin:0}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin:16px 0 6px}
  table{width:100%;border-collapse:collapse}
  th{padding:4px 0;border-bottom:1px solid #ccc;font-size:11px;text-align:left;font-weight:600;color:#555}
  th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td{padding:4px 0;border-bottom:1px solid #e5e7eb;vertical-align:top}
  .meta{margin:4px 0;color:#333;font-size:14px}
  .chips{font-size:11px;color:#666;margin-top:6px}
  .empty{color:#999;margin:0}
  .total{margin-top:16px;padding-top:12px;border-top:2px solid #111;font-size:15px}
  .page-break{page-break-after:always;height:0}
  @media print{
    body{padding:0}
    .slip--centered{min-height:calc(297mm - 32mm);page-break-inside:avoid}
    .page-break{break-after:page}
  }
</style></head><body>${body}</body></html>`);
  doc.close();
  const run = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 800);
    }
  };
  setTimeout(run, 200);
}

/** Safe filename: ФИО + period, without forbidden path characters. */
function payslipFilename(name: string, from: string, to: string): string {
  const safe = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
    .slice(0, 80);
  // Keep YYYY-MM-DD as YYYY-MM-DD (hyphen is OK in filenames)
  const period = `${from}_${to}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
  return `Raschet_${safe || 'sotrudnik'}_${period}.txt`;
}

type DeptFilter =
  | 'ALL'
  | 'MANAGER'
  | 'ADMIN'
  | 'TRAINER'
  | 'SPECIALIST'
  | 'TECH'
  | 'EXTERNAL';

const DEPT_FILTERS: { id: DeptFilter; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'MANAGER', label: 'Упр.' },
  { id: 'ADMIN', label: 'Админы' },
  { id: 'TRAINER', label: 'Тренеры' },
  { id: 'SPECIALIST', label: 'SPA' },
  { id: 'TECH', label: 'Техперсонал' },
  { id: 'EXTERNAL', label: 'Сторонние' },
];

const TRACK_HINT: Record<string, string> = {
  ADMIN: 'Часы + % абонементов/доп/магазин/корпо + премии/штрафы (без безнала)',
  MANAGER: 'Оклад + % абонементов/доп клуба + корпо + премии/штрафы (без безнала)',
  GROUP_TRAINER: 'Тиры ставка×зал×люди (из расписания)',
  SPA: '% услуг + блок массажа + фикс из абонемента + биоимпеданс AllSports',
  TECH: 'Часы смены + премии/штрафы отдельно',
  PT: '% от оплаченных ПТ (ступени по объёму; подарки в счёт)',
  CLUB: '% ПТ клубных тренеров, без оклада и аванса',
};

type PayslipFields = {
  fio: boolean;
  period: boolean;
  motivation: boolean;
  bonus: boolean;
  fine: boolean;
  totals: boolean;
  shifts: boolean;
};

/** Defaults when opening the print dialog. */
const DEFAULT_PAYSLIP: PayslipFields = {
  fio: true,
  period: true,
  motivation: false,
  bonus: false,
  fine: false,
  totals: false,
  shifts: false,
};

const ALL_PAYSLIP: PayslipFields = {
  fio: true,
  period: true,
  motivation: true,
  bonus: true,
  fine: true,
  totals: true,
  shifts: true,
};

type Props = {
  mode: 'super' | 'admin';
};

type EmployeeViewMem = {
  userId: string;
  from: string;
  to: string;
  deptFilter: DeptFilter;
  employeeReportOpen: boolean;
  summaryOpen: boolean;
  payoutsOpen: boolean;
};

const DEPT_FILTER_IDS: DeptFilter[] = [
  'ALL',
  'MANAGER',
  'ADMIN',
  'TRAINER',
  'SPECIALIST',
  'TECH',
  'EXTERNAL',
];

function parseDeptFilter(raw: unknown): DeptFilter {
  return typeof raw === 'string' &&
    DEPT_FILTER_IDS.includes(raw as DeptFilter)
    ? (raw as DeptFilter)
    : 'ALL';
}

export function PayrollWorkspace({ mode }: Props) {
  const today = useMemo(() => new Date(), []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ownerId = getUser()?.id ?? '';
  const urlHydrated = useRef(false);

  const boot = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    const defaults: EmployeeViewMem = {
      userId: '',
      from: isoDate(d),
      to: isoDate(today),
      deptFilter: 'ALL',
      employeeReportOpen: mode === 'admin',
      summaryOpen: true,
      payoutsOpen: false,
    };
    return resolveViewFilters<EmployeeViewMem>({
      userId: ownerId,
      pathname,
      slot: 'employee',
      search: searchParams,
      urlKeys: ['userId', 'from', 'to'],
      fromUrl: (s) => {
        const from = s.get('from');
        const to = s.get('to');
        return {
          userId: s.get('userId')?.trim() || '',
          ...(isIsoDay(from) ? { from } : {}),
          ...(isIsoDay(to) ? { to } : {}),
        };
      },
      defaults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const urlUserId = searchParams.get('userId')?.trim() || '';
  const [staff, setStaff] = useState<StaffPaySummary[]>([]);
  const [userId, setUserId] = useState(boot.userId);
  const [from, setFrom] = useState(boot.from);
  const [to, setTo] = useState(boot.to);
  const [summaryCalculatedAt, setSummaryCalculatedAt] = useState<number | null>(
    null,
  );
  const [summary, setSummary] = useState<PayrollPeriodSummary | null>(() => {
    if (!boot.userId || !ownerId) return null;
    const hit = getPayrollSummaryCache<PayrollPeriodSummary>(ownerId, {
      mode,
      userId: boot.userId,
      from: boot.from,
      to: boot.to,
    });
    if (hit) {
      // calculatedAt applied in effect below — keep sync with cache hit
      return hit.summary;
    }
    return null;
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing1c, setSyncing1c] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [editingAdjId, setEditingAdjId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printFields, setPrintFields] = useState<PayslipFields>(DEFAULT_PAYSLIP);
  const [docPreview, setDocPreview] = useState('');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>(() =>
    parseDeptFilter(boot.deptFilter),
  );
  const [batchIds, setBatchIds] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const canEdit = mode === 'super';

  const [employeeReportOpen, setEmployeeReportOpen] = useState(
    Boolean(boot.employeeReportOpen),
  );
  const [summaryOpen, setSummaryOpen] = useState(Boolean(boot.summaryOpen));
  const [payoutsOpen, setPayoutsOpen] = useState(Boolean(boot.payoutsOpen));
  const [peekSession, setPeekSession] = useState<{
    sessionKey: string;
    from: string;
    to: string;
  } | null>(null);
  const [saleDetail, setSaleDetail] =
    useState<ClubRevenueDetailResponse | null>(null);
  const [saleDetailLoading, setSaleDetailLoading] = useState(false);

  const bookingPeekApi = useMemo(
    () =>
      createBookingControlApi(mode === 'super' ? 'super-admin' : 'admin'),
    [mode],
  );

  const openSalePeek = useCallback(async (externalId: string) => {
    const token = getToken();
    if (!token) return;
    setSaleDetailLoading(true);
    try {
      const d = await api.superAdminClubSaleDetail(token, externalId);
      setSaleDetail(d);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось открыть продажу');
    } finally {
      setSaleDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!boot.userId || !ownerId) return;
    const hit = getPayrollSummaryCache<PayrollPeriodSummary>(ownerId, {
      mode,
      userId: boot.userId,
      from: boot.from,
      to: boot.to,
    });
    if (hit) setSummaryCalculatedAt(hit.calculatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from cache
  }, []);

  usePersistViewMemory<EmployeeViewMem>({
    slot: 'employee',
    data: {
      userId,
      from,
      to,
      deptFilter,
      employeeReportOpen,
      summaryOpen,
      payoutsOpen,
    },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.userId) q.set('userId', d.userId);
      if (d.from) q.set('from', d.from);
      if (d.to) q.set('to', d.to);
      return q;
    },
  });

  const clearSummary = () => {
    setSummary(null);
    setSummaryCalculatedAt(null);
  };

  const filteredStaff = useMemo(() => {
    if (deptFilter === 'ALL') return staff;
    return staff.filter((s) => {
      if (deptFilter === 'EXTERNAL') {
        return s.employmentKind === 'EXTERNAL';
      }
      if (s.employmentKind === 'EXTERNAL') return false;
      if (deptFilter === 'MANAGER') {
        return s.roles.includes('MANAGER') || s.track === 'MANAGER';
      }
      if (s.roles.includes(deptFilter)) return true;
      if (deptFilter === 'ADMIN' && s.track === 'ADMIN') return true;
      if (
        deptFilter === 'TRAINER' &&
        (s.track === 'PT' || s.track === 'GROUP_TRAINER')
      )
        return true;
      if (deptFilter === 'SPECIALIST' && s.track === 'SPA') return true;
      if (deptFilter === 'TECH' && s.track === 'TECH') return true;
      return false;
    });
  }, [staff, deptFilter]);

  const selected = filteredStaff.find((s) => s.userId === userId)
    ?? staff.find((s) => s.userId === userId);

  const motivationBreakdownVisible =
    summary?.motivationBreakdown != null &&
    (summary.motivationBreakdown.membershipMinor > 0 ||
      summary.motivationBreakdown.spaMinor > 0 ||
      summary.motivationBreakdown.solariumMinor > 0 ||
      summary.motivationBreakdown.shopMinor > 0 ||
      summary.motivationBreakdown.corporateMinor > 0);

  const trustedGroupUnits = useMemo(
    () =>
      (summary?.workUnits ?? []).filter(
        (u) => u.kind === 'GROUP' && u.payrollTrusted,
      ),
    [summary?.workUnits],
  );

  const workTotals = useMemo(
    () => workUnitsPeriodTotals(summary?.workUnits ?? []),
    [summary?.workUnits],
  );

  const unconfirmedUnits = useMemo(
    () => (summary?.workUnits ?? []).filter((u) => !u.payrollTrusted).length,
    [summary?.workUnits],
  );

  const bookingControlHref = useMemo(() => {
    const base =
      mode === 'super'
        ? '/super-admin/review-queue'
        : '/admin/booking-control';
    const q = new URLSearchParams({
      from,
      to,
      needsReview: '1',
    });
    if (userId) q.set('performerId', userId);
    return `${base}?${q.toString()}`;
  }, [mode, from, to, userId]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const loadStaff =
      mode === 'super' ? api.payrollStaff(token) : api.adminPayrollStaff(token);
    loadStaff
      .then((list) => {
        setStaff(list);
        if (urlUserId && list.some((s) => s.userId === urlUserId)) {
          setUserId(urlUserId);
          urlHydrated.current = true;
        } else if (boot.userId && list.some((s) => s.userId === boot.userId)) {
          setUserId(boot.userId);
        } else if (!urlUserId && !boot.userId && list[0] && !userId) {
          setUserId(list[0].userId);
        }
      })
      .catch((e) => setMessage(e.message || 'Ошибка загрузки сотрудников'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from URL / memory on staff load
  }, [mode]);

  useEffect(() => {
    if (!canEdit) return;
    if (filteredStaff.length === 0) {
      if (!urlUserId && !boot.userId) {
        setUserId('');
        clearSummary();
      }
      return;
    }
    if (!filteredStaff.some((s) => s.userId === userId)) {
      if (
        (urlUserId && staff.some((s) => s.userId === urlUserId)) ||
        (boot.userId && staff.some((s) => s.userId === boot.userId))
      ) {
        // Remembered / URL employee is outside current dept filter — keep id.
        return;
      }
      setUserId(filteredStaff[0]!.userId);
      clearSummary();
    }
  }, [canEdit, filteredStaff, userId, urlUserId, staff, boot.userId]);

  const load = async () => {
    const token = getToken();
    if (!token || !userId) return;
    setLoading(true);
    setMessage('');
    setEmployeeReportOpen(true);
    try {
      const s =
        mode === 'super'
          ? await api.payrollSummary(token, { userId, from, to })
          : await api.adminPayrollSummary(token, { userId, from, to });
      setSummary(s);
      const at = Date.now();
      setSummaryCalculatedAt(at);
      if (ownerId) {
        setPayrollSummaryCache(ownerId, { mode, userId, from, to }, s);
      }
    } catch (e) {
      clearSummary();
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const refreshFrom1c = async () => {
    const token = getToken();
    if (!token || !userId) return;
    setSyncing1c(true);
    setMessage('');
    try {
      const res = await api.classSyncRefreshForPayroll(
        token,
        { from, to, userId },
        mode === 'super' ? 'super' : 'admin',
      );
      setMessage(res.message);
      if (!res.periodLocked) {
        await load();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка обновления из 1С');
    } finally {
      setSyncing1c(false);
    }
  };

  const lock = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId) return;
    try {
      const s = await api.payrollLock(token, { userId, from, to });
      setSummary(s);
      const at = Date.now();
      setSummaryCalculatedAt(at);
      if (ownerId) {
        setPayrollSummaryCache(ownerId, { mode, userId, from, to }, s);
      }
      setMessage('Период зафиксирован');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка lock');
    }
  };

  const saveAdj = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId || !adjReason.trim()) return;
    setMessage('');
    try {
      if (editingAdjId) {
        await api.payrollUpdateAdjustment(token, editingAdjId, {
          amountMinor: Math.round(Number(adjAmount || 0) * 100),
          reason: adjReason.trim(),
        });
        setMessage('Корректировка обновлена');
      } else {
        const created = await api.payrollAdjustment(token, {
          userId,
          amountMinor: Math.round(Number(adjAmount || 0) * 100),
          reason: adjReason.trim(),
          periodFrom: from,
          periodTo: to,
        });
        setMessage(
          created.redirectedFrom
            ? `Период закрыт — корректировка в открытый ${created.periodFrom}–${created.periodTo} (из ${created.redirectedFrom})`
            : 'Корректировка добавлена',
        );
        if (created.redirectedFrom) {
          setFrom(created.periodFrom);
          setTo(created.periodTo);
        }
      }
      setAdjAmount('');
      setAdjReason('');
      setEditingAdjId(null);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const startEditAdj = (a: PayrollAdjustmentDto) => {
    setEditingAdjId(a.id);
    setAdjAmount(String(a.amountMinor / 100));
    setAdjReason(a.reason);
  };

  const cancelEditAdj = () => {
    setEditingAdjId(null);
    setAdjAmount('');
    setAdjReason('');
  };

  const deleteAdj = async (id: string) => {
    if (!canEdit) return;
    if (!window.confirm('Удалить эту корректировку?')) return;
    const token = getToken();
    if (!token) return;
    try {
      await api.payrollDeleteAdjustment(token, id);
      if (editingAdjId === id) cancelEditAdj();
      setMessage('Корректировка удалена');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка удаления');
    }
  };

  const buildPayslipText = (
    fields: PayslipFields,
    source: PayrollPeriodSummary | null = summary,
  ): string => {
    if (!source) {
      const first =
        staff.find((s) => batchIds.has(s.userId))?.name ?? '…';
      const lines: string[] = [];
      if (fields.fio) lines.push(`ФИО: ${first}`);
      if (fields.period) lines.push(`Период: ${from} — ${to}`);
      if (
        fields.motivation ||
        fields.bonus ||
        fields.fine ||
        fields.shifts ||
        fields.totals
      ) {
        lines.push('');
        lines.push(
          `(детальные поля подставятся при печати по ${batchIds.size} сотрудник(ам))`,
        );
      }
      if (batchIds.size > 1) {
        lines.push('');
        lines.push(`Выбрано сотрудников: ${batchIds.size}`);
      }
      lines.push('');
      return lines.join('\n');
    }
    const cur = source.currency;
    const bonuses = source.adjustments.filter((a) => a.amountMinor > 0);
    const fines = source.adjustments.filter((a) => a.amountMinor < 0);
    const lines: string[] = [];
    if (fields.fio) lines.push(`ФИО: ${source.performerName}`);
    if (fields.period) lines.push(`Период: ${source.from} — ${source.to}`);
    if (fields.motivation) {
      lines.push('');
      lines.push('Мотивация / ставки:');
      const chips =
        source.payChips?.length > 0 ? source.payChips : ['Ставки не заданы'];
      for (const c of chips) lines.push(`  · ${c}`);
      lines.push(`  Оклад / часы: ${money(source.baseSalaryMinor, cur)}`);
      lines.push(`  Мотивация: ${money(source.motivationMinor, cur)}`);
      if (hasPayslipSalesSegments(source)) {
        lines.push('');
        lines.push('Продажи по сегментам (продано → в мотивацию):');
        for (const seg of PAYSLIP_SALE_SEGMENTS) {
          lines.push(
            `  ${seg.label}: ${money(seg.sold(source), cur)} → ${money(seg.contrib(source), cur)}`,
          );
        }
      }
    }
    if (fields.bonus) {
      lines.push('');
      lines.push('Премии:');
      if (!bonuses.length) lines.push('  нет');
      else {
        for (const a of bonuses) {
          lines.push(`  + ${money(a.amountMinor, cur)} — ${a.reason}`);
        }
      }
    }
    if (fields.fine) {
      lines.push('');
      lines.push('Штрафы:');
      if (!fines.length) lines.push('  нет');
      else {
        for (const a of fines) {
          lines.push(`  ${money(a.amountMinor, cur)} — ${a.reason}`);
        }
      }
    }
    if (fields.shifts) {
      const shifts = source.workUnits.filter((u) => u.kind === 'SHIFT');
      lines.push('');
      lines.push('Смены:');
      if (!shifts.length) lines.push('  нет');
      else {
        for (const u of shifts) {
          lines.push(
            `  ${u.occurredAt.slice(0, 10)}  ${u.quantity} ч  ${money(u.priceMinor ?? 0, cur)}`,
          );
        }
      }
    }
    if (fields.totals) {
      lines.push('');
      lines.push('-'.repeat(40));
      lines.push(
        `Корректировки всего: ${money(source.adjustmentsMinor, cur)}`,
      );
      lines.push(`ИТОГО К ВЫПЛАТЕ: ${money(source.totalMinor, cur)}`);
    }
    if (batchIds.size > 1) {
      lines.push('');
      lines.push(`Выбрано сотрудников: ${batchIds.size}`);
    }
    lines.push('');
    return lines.join('\n');
  };

  const openPrintDialog = () => {
    if (!canEdit || batchIds.size === 0) return;
    setPrintFields(DEFAULT_PAYSLIP);
    const previewSource =
      summary && batchIds.has(userId) ? summary : null;
    setDocPreview(buildPayslipText(DEFAULT_PAYSLIP, previewSource));
    setPrintOpen(true);
  };

  const refreshPreview = (fields: PayslipFields) => {
    setPrintFields(fields);
    const previewSource =
      summary && batchIds.has(userId) ? summary : null;
    setDocPreview(buildPayslipText(fields, previewSource));
  };

  const savePayslipFile = async () => {
    const text = docPreview || buildPayslipText(printFields);
    if (!text || !summary) return;
    const fileName = payslipFilename(
      summary.performerName,
      summary.from,
      summary.to,
    );
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

    type SavePicker = (opts: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<{
      name: string;
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;

    const showSave = (
      window as Window & { showSaveFilePicker?: SavePicker }
    ).showSaveFilePicker;

    if (typeof showSave === 'function') {
      try {
        const handle = await showSave({
          suggestedName: fileName,
          types: [
            {
              description: 'Текстовый файл',
              accept: { 'text/plain': ['.txt'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setMessage(`Сохранено: ${handle.name}`);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // fall through to download
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage(
      `Файл «${fileName}» скачан в папку загрузок (браузер не дал выбрать место)`,
    );
  };

  const toggleBatchId = (id: string) => {
    setBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const printSelectedPayslips = async () => {
    if (!canEdit || batchIds.size === 0) return;
    const token = getToken();
    if (!token) return;
    setBatchPrinting(true);
    setMessage('');
    try {
      const ids = [...batchIds];
      const sections: Array<{ name: string; html: string }> = [];
      for (const id of ids) {
        const s = await api.payrollSummary(token, { userId: id, from, to });
        sections.push({
          name: s.performerName,
          html: payslipHtmlFromSummary(s, printFields),
        });
      }
      printHtmlPayslips(sections);
      setPrintOpen(false);
      setMessage(`Отправлено на печать: ${sections.length}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка печати');
    } finally {
      setBatchPrinting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 pb-8 md:max-w-none">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Расчёт ЗП
          </h1>
          <p className="mt-0.5 hidden max-w-xl text-sm leading-relaxed text-slate-400 sm:block">
            {mode === 'admin'
              ? 'Ваш расчёт за период по проверенным работам. Ставки настраивает супер-админ.'
              : 'Итог за период по проверенным работам. Ставки и % — в Staff.'}
          </p>
        </div>
        {canEdit && (
          <Link
            href="/super-admin/staff"
            className="text-sm text-fitgo-400 hover:text-fitgo-300"
          >
            Staff → ставки
          </Link>
        )}
      </header>

      {canEdit && (
        <ClubPayrollReportPanel
          staff={staff}
          open={summaryOpen}
          onToggle={() => setSummaryOpen((o) => !o)}
          onSelectEmployee={(id, f, t) => {
            setUserId(id);
            setFrom(f);
            setTo(t);
            setEmployeeReportOpen(true);
            void (async () => {
              const token = getToken();
              if (!token) return;
              setLoading(true);
              setMessage('');
              try {
                const s = await api.payrollSummary(token, {
                  userId: id,
                  from: f,
                  to: t,
                });
                setSummary(s);
                const at = Date.now();
                setSummaryCalculatedAt(at);
                if (ownerId) {
                  setPayrollSummaryCache(
                    ownerId,
                    { mode, userId: id, from: f, to: t },
                    s,
                  );
                }
              } catch (e) {
                clearSummary();
                setMessage(e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setLoading(false);
              }
            })();
          }}
        />
      )}

      {canEdit && (
        <PayrollPayoutsPanel
          staff={staff}
          open={payoutsOpen}
          onToggle={() => setPayoutsOpen((o) => !o)}
        />
      )}

      <section className="rounded-xl border border-slate-800/80 bg-slate-950/80">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left md:px-4"
          onClick={() => setEmployeeReportOpen((o) => !o)}
        >
          <div>
            <h2 className="text-base font-semibold text-white">
              Отчёт по сотруднику
            </h2>
            <p className="text-[11px] text-slate-500">
              {selected
                ? `${selected.name}${
                    summary
                      ? ` · ${formatIsoDayRu(summary.from)}–${formatIsoDayRu(summary.to)} · ${money(summary.totalMinor, summary.currency)}`
                      : ''
                  }`
                : 'Индивидуальный расчёт и проверка'}
            </p>
          </div>
          <span className="text-slate-400">{employeeReportOpen ? '▾' : '▸'}</span>
        </button>

        {employeeReportOpen && (
          <div className="space-y-3 border-t border-slate-800 px-3 pb-3 pt-3 md:px-4">

        {canEdit && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {DEPT_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setDeptFilter(f.id)}
                className={
                  deptFilter === f.id
                    ? 'btn-primary px-2.5 py-1 text-xs'
                    : 'btn-secondary px-2.5 py-1 text-xs'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div
          className={
            canEdit
              ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_auto_auto_auto] lg:items-end'
              : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_7.5rem_7.5rem_auto_auto] lg:items-end'
          }
        >
          {canEdit ? (
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Сотрудник
              <select
                className="input mt-1 w-full py-1.5 text-sm"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  clearSummary();
                }}
              >
                {filteredStaff.length === 0 ? (
                  <option value="">Нет сотрудников в фильтре</option>
                ) : (
                  filteredStaff.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.name}
                      {s.track ? ` · ${s.track}` : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Моя ЗП
              </p>
              <p className="mt-0.5 font-medium text-white">
                {selected?.name ?? '…'}
              </p>
            </div>
          )}
          <DateField
            label="С"
            value={from}
            onChange={(v) => {
              setFrom(v);
              clearSummary();
            }}
            inputClassName="text-sm"
          />
          <DateField
            label="По"
            value={to}
            onChange={(v) => {
              setTo(v);
              clearSummary();
            }}
            inputClassName="text-sm"
          />
          <button
            type="button"
            className="btn-primary w-full lg:min-w-[7.5rem] lg:w-auto"
            disabled={loading || !userId}
            onClick={load}
          >
            {loading ? 'Считаем…' : 'Рассчитать'}
          </button>
          <button
            type="button"
            className="btn-secondary w-full lg:min-w-[9.5rem] lg:w-auto"
            disabled={syncing1c || loading || !userId}
            onClick={() => void refreshFrom1c()}
            title="Перечитать занятия из 1С за выбранный период и пересчитать"
          >
            {syncing1c ? 'Обновляем…' : 'Обновить из 1С'}
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary w-full lg:min-w-[9rem] lg:w-auto"
              disabled={batchPrinting || batchIds.size === 0}
              onClick={openPrintDialog}
              title={
                batchIds.size === 0
                  ? 'Отметьте сотрудников галочками ниже'
                  : undefined
              }
            >
              {batchPrinting ? 'Печать…' : 'Печать'}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn-secondary w-full lg:w-auto"
              disabled={!summary?.canLock}
              onClick={lock}
              title={
                summary && !summary.canLock
                  ? `Открытых нестыковок: ${summary.openExceptions}`
                  : undefined
              }
            >
              Lock
            </button>
          )}
        </div>

        {summary && summaryCalculatedAt != null && (
          <p className="text-[11px] text-slate-500">
            Расчёт на {formatCalculatedAt(summaryCalculatedAt)}. «Рассчитать» или
            «Обновить из 1С» — пересчитать заново.
          </p>
        )}

        {canEdit && filteredStaff.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Пакетная печать расчётников
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-fitgo-300 hover:underline"
                  onClick={() =>
                    setBatchIds(new Set(filteredStaff.map((s) => s.userId)))
                  }
                >
                  Выбрать всех в фильтре
                </button>
                <button
                  type="button"
                  className="text-slate-400 hover:underline"
                  onClick={() => setBatchIds(new Set())}
                >
                  Снять
                </button>
              </div>
            </div>
            <ul className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {filteredStaff.map((s) => (
                <li key={s.userId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-900">
                    <input
                      type="checkbox"
                      checked={batchIds.has(s.userId)}
                      onChange={() => toggleBatchId(s.userId)}
                    />
                    <span className="truncate text-slate-200">{s.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selected && (
          <div className="mt-3 space-y-1.5 border-t border-slate-800/80 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {selected.track && (
                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                  {selected.track}
                </span>
              )}
              {canEdit && (
                <Link
                  href={`/super-admin/staff/${selected.userId}`}
                  className="text-xs text-fitgo-400 hover:underline"
                >
                  Изменить ставки
                </Link>
              )}
            </div>
            {selected.track && TRACK_HINT[selected.track] && (
              <p className="text-xs text-slate-500">
                {TRACK_HINT[selected.track]}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selected.payChips.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-0.5 text-xs text-slate-300"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      
            {message && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
                {message}
              </p>
            )}
      {summary && (
        <>
          <p className="text-xs text-slate-500">
            Расчёт за{' '}
            <span className="tabular-nums text-slate-300">
              {formatIsoDayRu(summary.from)}–{formatIsoDayRu(summary.to)}
            </span>
            {summary.from !== from || summary.to !== to
              ? ' — даты изменены, нажмите «Рассчитать»'
              : null}
          </p>
          <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
            <Stat
              label="Оклад / часы"
              value={money(summary.baseSalaryMinor, summary.currency)}
            />
            <Stat
              label="Мотивация"
              value={money(summary.motivationMinor, summary.currency)}
            />
            <Stat
              label="± Корректировки"
              value={money(summary.adjustmentsMinor, summary.currency)}
            />
            <Stat
              label="Итого"
              value={money(summary.totalMinor, summary.currency)}
              emphasize
            />
          </section>

          {motivationBreakdownVisible && summary.motivationBreakdown ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Из чего мотивация
              </p>
              <MotivationBreakdownList
                breakdown={summary.motivationBreakdown}
                sales={summary.sales}
                currency={summary.currency}
              />
            </section>
          ) : null}

          {summary.groupStats ? (
            <section className="grid grid-cols-2 gap-2.5 md:grid-cols-2">
              <Stat
                label="Занятий в ЗП"
                value={String(summary.groupStats.classCount)}
              />
              <Stat
                label="Среднее людей"
                value={summary.groupStats.avgPeople.toLocaleString('ru-RU', {
                  maximumFractionDigits: 1,
                })}
              />
            </section>
          ) : null}

          {summary.ptStats ? (
            <section className="grid grid-cols-2 gap-2.5 md:grid-cols-2">
              <Stat
                label="ПТ за период"
                value={String(summary.ptStats.sessionCount)}
              />
              <Stat
                label="% по шкале"
                value={`${summary.ptStats.percent}%`}
              />
            </section>
          ) : null}

          {unconfirmedUnits > 0 ? (
            <Link
              href={bookingControlHref}
              className="block rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
            >
              Не подтверждено: {unconfirmedUnits} занятий/услуг → контроль
              записей
            </Link>
          ) : null}

          <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm">
            <span className="font-medium text-white">{summary.performerName}</span>
            <span
              className={
                summary.openExceptions ? 'text-amber-300' : 'text-emerald-400'
              }
            >
              нестыковок: {summary.openExceptions}
            </span>
            <span className="text-slate-500">
              без замечаний {summary.greenCount}
              {summary.resolvedCount > 0
                ? ` · принято ${summary.resolvedCount}`
                : ''}
            </span>
            {summary.locked && (
              <span className="rounded-full bg-fitgo-500/15 px-2 py-0.5 text-xs text-fitgo-300">
                LOCKED
              </span>
            )}
          </section>

          {summary.anomalyHints.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
              {summary.anomalyHints.map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          )}

          {canEdit && (
            <section className="space-y-3 rounded-2xl border border-slate-800 p-4 md:flex md:items-end md:gap-3 md:space-y-0">
              <div className="md:flex-1 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {editingAdjId ? 'Редактировать корректировку' : 'Премия / штраф'}
                </p>
                <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="± BYN"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Причина"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex w-full gap-2 md:w-auto">
                <button
                  type="button"
                  className="btn-secondary flex-1 md:flex-none"
                  onClick={saveAdj}
                >
                  {editingAdjId ? 'Сохранить' : 'Добавить'}
                </button>
                {editingAdjId && (
                  <button
                    type="button"
                    className="btn-secondary flex-1 md:flex-none"
                    onClick={cancelEditAdj}
                  >
                    Отмена
                  </button>
                )}
              </div>
            </section>
          )}

          {(summary.adjustments?.length ?? 0) > 0 && (
            <section className="space-y-2 rounded-2xl border border-slate-800 p-4">
              <h2 className="text-sm font-medium text-slate-300">
                Премии и штрафы
              </h2>
              <ul className="space-y-1 text-sm">
                {summary.adjustments.map((a: PayrollAdjustmentDto) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/80 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-slate-400">{a.reason}</span>
                      <span
                        className={`ml-2 tabular-nums ${
                          a.amountMinor >= 0
                            ? 'text-emerald-400'
                            : 'text-red-300'
                        }`}
                      >
                        {money(a.amountMinor, summary.currency)}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="flex gap-3 text-xs">
                        <button
                          type="button"
                          className="text-sky-300"
                          onClick={() => startEditAdj(a)}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="text-red-300"
                          onClick={() => deleteAdj(a.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.groupStats ? (
            <section className="space-y-2 rounded-2xl border border-slate-800 p-4">
              <h2 className="text-sm font-medium text-slate-300">
                Занятия в расчёте ЗП ({trustedGroupUnits.length})
              </h2>
              {trustedGroupUnits.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Нет подтверждённых групповых занятий
                </p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {trustedGroupUnits.map((u) => (
                    <li
                      key={u.id}
                      className="flex justify-between gap-2 border-b border-slate-900/80 py-1.5 text-slate-300"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="tabular-nums text-slate-500">
                          {unitDayLabel(u)}
                        </span>{' '}
                        · {u.title}
                        {u.roomTitle ? (
                          <span className="text-slate-500">
                            {' '}
                            · {u.roomTitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {u.quantity} чел.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300">
              Работы за период ({summary.workUnits.length})
            </h2>

            <div className="space-y-2 md:hidden">
              {summary.workUnits.length === 0 ? (
                <p className="text-sm text-slate-500">Нет строк</p>
              ) : (
                summary.workUnits.map((u) => (
                  <article
                    key={`${u.kind}-${u.id}`}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{u.title}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(u.occurredAt)}
                          {u.clientName ? ` · ${u.clientName}` : ''}
                        </p>
                      </div>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {u.kind}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>
                        {u.kind === 'SHIFT'
                          ? `${u.quantity} ч`
                          : `×${u.quantity}`}
                      </span>
                      {u.kind === 'GROUP' && u.roomTitle && (
                        <span className="text-slate-500">{u.roomTitle}</span>
                      )}
                      {unitShowsPayCols(u) && (
                        <>
                          <span>
                            {unitCostLabel(u, summary.currency)}
                          </span>
                          <span className="text-slate-300">
                            {unitEarnLabel(u, summary.currency)}
                          </span>
                        </>
                      )}
                      {u.kind === 'SPA' && canEdit && (
                        <button
                          type="button"
                          className={
                            u.partnerSource === 'ALLSPORTS'
                              ? 'rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300'
                              : 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400'
                          }
                          onClick={async () => {
                            const token = getToken();
                            if (!token) return;
                            const next =
                              u.partnerSource === 'ALLSPORTS'
                                ? null
                                : 'ALLSPORTS';
                            try {
                              await api.payrollSetSpaPartner(token, u.id, next);
                              await load();
                            } catch (e) {
                              setMessage(
                                e instanceof Error ? e.message : 'Ошибка',
                              );
                            }
                          }}
                        >
                          {u.partnerSource === 'ALLSPORTS'
                            ? 'AllSports ✓'
                            : 'AllSports'}
                        </button>
                      )}
                      {u.kind === 'SHIFT' && u.priceMinor != null && (
                        <span className="text-emerald-400">
                          {money(u.priceMinor, summary.currency)}
                        </span>
                      )}
                      <TrustBandDot
                        trustBand={u.trustBand}
                        trustHints={u.trustHints}
                      />
                      {u.isComplimentary && (
                        <span className="text-violet-300">подарок</span>
                      )}
                      {u.spaBlockPriceSource === 'CATALOG' && (
                        <span className="text-amber-300">
                          каталог −N%, проверить оплату
                        </span>
                      )}
                      <span
                        className={
                          u.payrollTrusted && !u.isComplimentary
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                        }
                      >
                        {u.isComplimentary
                          ? 'в счёт'
                          : u.payrollTrusted
                            ? 'в ЗП'
                            : 'не в ЗП'}
                      </span>
                    </div>
                    {unitShowsPayCols(u) &&
                      (u.sessionKey ||
                        unitHasSalePeek(u) ||
                        unitSaleListHref(u, mode)) && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs">
                          {u.sessionKey ? (
                            <button
                              type="button"
                              className="text-sky-300 hover:underline"
                              onClick={() =>
                                setPeekSession({
                                  sessionKey: u.sessionKey!,
                                  from: unitDayIso(u),
                                  to: unitDayIso(u),
                                })
                              }
                            >
                              Контроль
                            </button>
                          ) : null}
                          {unitHasSalePeek(u) ? (
                            <button
                              type="button"
                              className="text-sky-300 hover:underline"
                              disabled={saleDetailLoading}
                              onClick={() =>
                                void openSalePeek(u.saleExternalId!.trim())
                              }
                            >
                              Продажа
                            </button>
                          ) : unitSaleListHref(u, mode) ? (
                            <Link
                              href={unitSaleListHref(u, mode)!}
                              className="text-sky-300 hover:underline"
                            >
                              Список
                            </Link>
                          ) : null}
                        </div>
                      )}
                  </article>
                ))
              )}
              {summary.workUnits.length > 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-400">
                  <span className="font-medium uppercase tracking-wide text-slate-500">
                    Итого
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Начислено:{' '}
                      <span className="tabular-nums text-emerald-300">
                        {money(workTotals.earnedMinor, summary.currency)}
                      </span>
                    </span>
                    <span>
                      Продано:{' '}
                      <span className="tabular-nums text-slate-200">
                        {money(workTotals.soldMinor, summary.currency)}
                      </span>
                    </span>
                    <span>
                      Занятий:{' '}
                      <span className="tabular-nums text-slate-200">
                        {workTotals.classCount}
                      </span>
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-slate-800 md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Когда</th>
                    <th className="px-4 py-3">Вид</th>
                    <th className="px-4 py-3">Услуга</th>
                    <th className="px-4 py-3">Кол-во</th>
                    <th className="px-4 py-3">Стоимость</th>
                    <th className="px-4 py-3">%</th>
                    <th className="px-4 py-3">Trust</th>
                    <th className="px-4 py-3">В ЗП</th>
                    <th className="px-4 py-3">Ссылки</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.workUnits.map((u) => {
                    const saleListHref = unitSaleListHref(u, mode);
                    const showPayCols = unitShowsPayCols(u);
                    return (
                      <tr
                        key={`${u.kind}-${u.id}`}
                        className="border-t border-slate-900/80"
                      >
                        <td className="px-4 py-2.5 text-slate-400">
                          {formatDateTime(u.occurredAt)}
                        </td>
                        <td className="px-4 py-2.5">{u.kind}</td>
                        <td className="px-4 py-2.5">
                          {u.title}
                          {u.isComplimentary ? (
                            <span className="ml-1 text-violet-300">
                              · подарок
                            </span>
                          ) : null}
                          {u.spaBlockPriceSource === 'CATALOG' ? (
                            <span className="ml-1 text-amber-300">
                              · каталог −N%, проверить оплату
                            </span>
                          ) : null}
                          {u.clientName ? (
                            <span className="text-slate-500">
                              {' '}
                              · {u.clientName}
                            </span>
                          ) : null}
                          {u.kind === 'SHIFT' && u.priceMinor != null ? (
                            <span className="ml-1 text-emerald-400">
                              · {money(u.priceMinor, summary.currency)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          {u.kind === 'SHIFT' ? `${u.quantity} ч` : u.quantity}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-300">
                          {showPayCols
                            ? unitCostLabel(u, summary.currency)
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-300">
                          {showPayCols
                            ? unitEarnLabel(u, summary.currency)
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <TrustBandDot
                            trustBand={u.trustBand}
                            trustHints={u.trustHints}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          {u.isComplimentary ? (
                            <span className="text-violet-300">счёт</span>
                          ) : u.payrollTrusted ? (
                            <span className="text-emerald-400">да</span>
                          ) : (
                            <span className="text-slate-600">нет</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {showPayCols ? (
                            <span className="inline-flex flex-wrap gap-2 text-xs">
                              {u.sessionKey ? (
                                <button
                                  type="button"
                                  className="text-sky-300 hover:underline"
                                  onClick={() =>
                                    setPeekSession({
                                      sessionKey: u.sessionKey!,
                                      from: unitDayIso(u),
                                      to: unitDayIso(u),
                                    })
                                  }
                                >
                                  Контроль
                                </button>
                              ) : (
                                <span className="text-slate-600">Контроль</span>
                              )}
                              {unitHasSalePeek(u) ? (
                                <button
                                  type="button"
                                  className="text-sky-300 hover:underline"
                                  disabled={saleDetailLoading}
                                  onClick={() =>
                                    void openSalePeek(u.saleExternalId!.trim())
                                  }
                                >
                                  Продажа
                                </button>
                              ) : saleListHref ? (
                                <Link
                                  href={saleListHref}
                                  className="text-sky-300 hover:underline"
                                >
                                  Список
                                </Link>
                              ) : (
                                <span className="text-slate-600">Продажа</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summary.workUnits.length > 0 ? (
                  <tfoot>
                    <tr className="border-t border-slate-700 bg-slate-950/90 text-xs">
                      <td
                        colSpan={4}
                        className="px-4 py-3 font-medium uppercase tracking-wide text-slate-500"
                      >
                        Итого
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">
                        {money(workTotals.soldMinor, summary.currency)}
                        <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-slate-500">
                          продано
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-emerald-300">
                        {money(workTotals.earnedMinor, summary.currency)}
                        <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-slate-500">
                          начислено
                        </span>
                      </td>
                      <td
                        colSpan={3}
                        className="px-4 py-3 tabular-nums text-slate-200"
                      >
                        {workTotals.classCount}{' '}
                        <span className="text-slate-500">занятий</span>
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>
        </>
      )}

      {!summary && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-12 text-center">
          <p className="text-sm text-slate-400">
            Выберите сотрудника и период
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Затем нажмите «Рассчитать»
          </p>
        </div>
      )}


          </div>
        )}
      </section>

      {printOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onMouseDown={() => !batchPrinting && setPrintOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Печать</h2>
            <p className="text-xs text-slate-400">
              Выберите поля. Печать для {batchIds.size} сотрудник
              {batchIds.size === 1 ? 'а' : 'ов'} за период {from} — {to}.
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-emerald-300"
                onClick={() => refreshPreview(ALL_PAYSLIP)}
              >
                Выбрать все
              </button>
              <button
                type="button"
                className="rounded-lg bg-white/5 px-2.5 py-1 text-slate-400"
                onClick={() =>
                  refreshPreview({
                    fio: false,
                    period: false,
                    motivation: false,
                    bonus: false,
                    fine: false,
                    totals: false,
                    shifts: false,
                  })
                }
              >
                Снять все
              </button>
            </div>
            <div className="space-y-2 text-sm text-slate-200">
              {(
                [
                  ['fio', 'ФИО'],
                  ['period', 'Период'],
                  ['motivation', 'Данные из мотивации'],
                  ['bonus', 'Премия'],
                  ['fine', 'Штраф'],
                  ['shifts', 'Смены / часы'],
                  ['totals', 'Итого'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printFields[key]}
                    onChange={(e) =>
                      refreshPreview({
                        ...printFields,
                        [key]: e.target.checked,
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Предпросмотр
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
                {docPreview || 'Отметьте хотя бы одно поле'}
              </pre>
              {summary && batchIds.has(userId) && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Имя файла:{' '}
                  <span className="text-slate-400">
                    {payslipFilename(
                      summary.performerName,
                      summary.from,
                      summary.to,
                    )}
                  </span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={
                  batchPrinting ||
                  !Object.values(printFields).some(Boolean)
                }
                onClick={() => void printSelectedPayslips()}
              >
                {batchPrinting ? 'Печать…' : 'Печать'}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={
                  batchPrinting ||
                  !summary ||
                  !batchIds.has(userId) ||
                  !docPreview.trim()
                }
                onClick={savePayslipFile}
                title={
                  !summary || !batchIds.has(userId)
                    ? 'Сохранение txt — для текущего рассчитанного сотрудника из выбора'
                    : undefined
                }
              >
                Сохранить как…
              </button>
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                disabled={batchPrinting}
                onClick={() => setPrintOpen(false)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {peekSession ? (
        <BookingControlPanel
          key={peekSession.sessionKey}
          api={bookingPeekApi}
          canResolve={mode === 'super'}
          canMarkAttendance
          canApproveGroup
          approvalActor={mode === 'super' ? 'override' : 'admin'}
          canReturnApproval
          canViewHallPhotos
          canBulkApprove={mode === 'super'}
          detailOnly
          initialSessionKey={peekSession.sessionKey}
          initialFrom={peekSession.from}
          initialTo={peekSession.to}
          onDetailClose={() => {
            setPeekSession(null);
            void load();
          }}
        />
      ) : null}

      {saleDetail ? (
        <SaleDetailDrawer
          detail={saleDetail}
          onClose={() => setSaleDetail(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-2.5 py-2 md:px-3 md:py-2.5 ${
        emphasize
          ? 'border-fitgo-500/40 bg-fitgo-500/10'
          : 'border-slate-800 bg-slate-950/50'
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
        {label}
      </p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          emphasize
            ? 'text-lg text-fitgo-300 md:text-xl'
            : 'text-base text-white md:text-lg'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
