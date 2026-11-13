'use client';

import { SaleDetailDrawer } from '@/components/admin-sales/sale-detail-drawer';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { ClubPayrollReportPanel } from '@/components/payroll/club-payroll-report';
import {
  AttentionBar,
  ReportHeader,
  ReportTabs,
  ReportToolbar,
  buildAttentionChips,
  money,
  periodPresetRange,
  useControlMisses,
  type AttentionKind,
  type DeptFilter,
  type PeriodPreset,
  type ReportTabId,
} from '@/components/payroll/employee-report';
import {
  pickSaleLinesForUnit,
  scoreSaleLineForUnit,
  unitHasSalePeek,
  unitSaleSearchQuery,
} from '@/components/payroll/employee-report/sale-links';
import { PayrollFold } from '@/components/payroll/payroll-fold';
import { PayrollPayoutsPanel } from '@/components/payroll/payroll-payouts-panel';
import {
  ALL_PAYSLIP,
  DEFAULT_PAYSLIP,
  buildPayslipText,
  payslipFilename,
  payslipHtmlFromSummary,
  printHtmlPayslips,
  type PayslipFields,
} from '@/components/payroll/payroll-payslip';
import type {
  ClubRevenueDetailResponse,
  ClubRevenueLineDto,
  PayrollAdjustmentDto,
  PayrollPeriodSummary,
  StaffPaySummary,
  WorkUnit,
} from '@fitgo/shared-types';
import { UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  createBookingControlApi,
  spaBookingEditHrefForBase,
} from '@/lib/booking-control-api';
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

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatIsoDayRu(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

type Props = {
  mode: 'super' | 'admin';
};

type EmployeeViewMem = {
  userId: string;
  from: string;
  to: string;
  deptFilter: DeptFilter;
  employeeReportOpen: boolean;
  payoutsOpen: boolean;
  tab: ReportTabId;
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

const REPORT_TAB_IDS: ReportTabId[] = [
  'overview',
  'pt',
  'group',
  'reformer',
  'spa',
  'shift',
  'gifts',
  'attention',
  'adjustments',
];

function parseDeptFilter(raw: unknown): DeptFilter {
  return typeof raw === 'string' &&
    DEPT_FILTER_IDS.includes(raw as DeptFilter)
    ? (raw as DeptFilter)
    : 'ALL';
}

function parseReportTab(raw: unknown): ReportTabId {
  return typeof raw === 'string' &&
    REPORT_TAB_IDS.includes(raw as ReportTabId)
    ? (raw as ReportTabId)
    : 'overview';
}

function filterStaffByDept(
  list: StaffPaySummary[],
  dept: DeptFilter,
): StaffPaySummary[] {
  if (dept === 'ALL') return list;
  return list.filter((s) => {
    if (dept === 'EXTERNAL') {
      return s.employmentKind === 'EXTERNAL';
    }
    if (s.employmentKind === 'EXTERNAL') return false;
    if (dept === 'MANAGER') {
      return s.roles.includes('MANAGER') || s.track === 'MANAGER';
    }
    if (s.roles.includes(dept)) return true;
    if (dept === 'ADMIN' && s.track === 'ADMIN') return true;
    if (
      dept === 'TRAINER' &&
      (s.track === 'PT' || s.track === 'CLUB' || s.track === 'GROUP_TRAINER')
    ) {
      return true;
    }
    if (dept === 'SPECIALIST' && s.track === 'SPA') return true;
    if (dept === 'TECH' && s.track === 'TECH') return true;
    return false;
  });
}

export function PayrollWorkspace({ mode }: Props) {
  const today = useMemo(() => new Date(), []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ownerId = getUser()?.id ?? '';
  const urlHydrated = useRef(false);
  const autoLoadSkip = useRef(true);

  const boot = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    const defaults: EmployeeViewMem = {
      userId: '',
      from: isoDate(d),
      to: isoDate(today),
      deptFilter: 'ALL',
      employeeReportOpen: mode === 'admin',
      payoutsOpen: false,
      tab: 'overview',
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
    if (hit) return hit.summary;
    return null;
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing1c, setSyncing1c] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [editingAdjId, setEditingAdjId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printFields, setPrintFields] =
    useState<PayslipFields>(DEFAULT_PAYSLIP);
  const [docPreview, setDocPreview] = useState('');
  const [deptFilter, setDeptFilter] = useState<DeptFilter>(() =>
    parseDeptFilter(boot.deptFilter),
  );
  const [batchIds, setBatchIds] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [printRange, setPrintRange] = useState<{ from: string; to: string }>({
    from: boot.from,
    to: boot.to,
  });
  const canEdit = mode === 'super';

  const [employeeReportOpen, setEmployeeReportOpen] = useState(
    Boolean(boot.employeeReportOpen),
  );
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(Boolean(boot.payoutsOpen));
  const [reportTab, setReportTab] = useState<ReportTabId>(() =>
    parseReportTab(boot.tab),
  );
  const [attentionFocus, setAttentionFocus] = useState<AttentionKind | null>(
    null,
  );
  const [peekSession, setPeekSession] = useState<{
    sessionKey: string;
    from: string;
    to: string;
  } | null>(null);
  const [saleDetail, setSaleDetail] =
    useState<ClubRevenueDetailResponse | null>(null);
  const [saleDetailLoading, setSaleDetailLoading] = useState(false);
  const [salePicker, setSalePicker] = useState<{
    lines: ClubRevenueLineDto[];
    currency: string;
  } | null>(null);

  const bookingPeekApi = useMemo(
    () => createBookingControlApi(mode === 'super' ? 'super-admin' : 'admin'),
    [mode],
  );

  const openSalePeek = useCallback(async (externalId: string) => {
    const token = getToken();
    if (!token) return;
    setSaleDetailLoading(true);
    setSalePicker(null);
    try {
      const d = await api.superAdminClubSaleDetail(token, externalId);
      setSaleDetail(d);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось открыть продажу');
    } finally {
      setSaleDetailLoading(false);
    }
  }, []);

  /** Open sale card in-page (linked id or ClubRevenue search). */
  const openSaleForUnit = useCallback(
    async (u: WorkUnit) => {
      const token = getToken();
      if (!token) return;

      const searchAndOpen = async () => {
        const search = unitSaleSearchQuery({
          ...u,
          // Force search even when a stale saleExternalId was rejected.
          saleExternalId: undefined,
        });
        if (!search) {
          setMessage('Продажа не найдена за период строки');
          return;
        }
        setSaleDetailLoading(true);
        setMessage('');
        try {
          const report = await api.superAdminClubSales(token, search);
          const lines = pickSaleLinesForUnit(u, report.lines ?? []);
          if (lines.length === 0) {
            setMessage(
              'Подходящая продажа не найдена (отфильтрованы чужие товары клиента)',
            );
            return;
          }
          if (lines.length === 1) {
            await openSalePeek(lines[0]!.externalId);
            return;
          }
          setSalePicker({ lines, currency: report.currency });
        } catch (e) {
          setMessage(
            e instanceof Error ? e.message : 'Не удалось найти продажу',
          );
        } finally {
          setSaleDetailLoading(false);
        }
      };

      if (unitHasSalePeek(u)) {
        const ext = u.saleExternalId!.trim();
        setSaleDetailLoading(true);
        setMessage('');
        try {
          const d = await api.superAdminClubSaleDetail(token, ext);
          const score = scoreSaleLineForUnit(u, {
            productName: d.line?.productName ?? null,
            clientName: d.line?.clientName ?? null,
            occurredAt: d.line?.occurredAt ?? '',
          });
          // Linked id points at bar/ЛС / other client product — search instead.
          if (score < 0 && (u.kind === 'SPA' || u.kind === 'PT')) {
            await searchAndOpen();
            return;
          }
          setSaleDetail(d);
        } catch (e) {
          setMessage(
            e instanceof Error ? e.message : 'Не удалось открыть продажу',
          );
        } finally {
          setSaleDetailLoading(false);
        }
        return;
      }

      await searchAndOpen();
    },
    [openSalePeek],
  );

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

  const filteredStaff = useMemo(
    () => filterStaffByDept(staff, deptFilter),
    [staff, deptFilter],
  );

  const reportUserId = useMemo(() => {
    if (!canEdit) return userId;
    if (filteredStaff.some((s) => s.userId === userId)) return userId;
    return filteredStaff[0]?.userId ?? '';
  }, [canEdit, filteredStaff, userId]);

  usePersistViewMemory<EmployeeViewMem>({
    slot: 'employee',
    data: {
      userId: reportUserId || userId,
      from,
      to,
      deptFilter,
      employeeReportOpen,
      payoutsOpen,
      tab: reportTab,
    },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.userId) q.set('userId', d.userId);
      if (d.from) q.set('from', d.from);
      if (d.to) q.set('to', d.to);
      return q;
    },
  });

  const selected =
    filteredStaff.find((s) => s.userId === reportUserId) ??
    (!canEdit ? staff.find((s) => s.userId === userId) : undefined);

  const bookingControlHref = useMemo(() => {
    const base =
      mode === 'super' ? '/super-admin/review-queue' : '/admin/booking-control';
    // Same «На контроле» as Attention — not needsReview=1 (только «На проверке»).
    const q = new URLSearchParams({
      from,
      to,
      queue: 'pending',
    });
    if (reportUserId) q.set('performerId', reportUserId);
    return `${base}?${q.toString()}`;
  }, [mode, from, to, reportUserId]);

  const {
    misses: controlMisses,
    loading: controlLoading,
    reload: reloadControlMisses,
  } = useControlMisses({
    mode,
    performerId: reportUserId,
    from: summary?.from ?? from,
    to: summary?.to ?? to,
    workUnits: summary?.workUnits,
    enabled: Boolean(summary && employeeReportOpen && reportUserId),
  });

  const attentionChips = useMemo(
    () =>
      summary
        ? buildAttentionChips({
            controlMissCount: controlMisses.length,
            units: summary.workUnits,
            anomalyHints: summary.anomalyHints,
          })
        : [],
    [summary, controlMisses.length],
  );

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
          setDeptFilter('ALL');
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
    if (reportUserId === userId) return;
    setUserId(reportUserId);
  }, [canEdit, reportUserId, userId]);

  const load = useCallback(async () => {
    const token = getToken();
    const id = reportUserId;
    if (!token || !id) return;
    if (id !== userId) setUserId(id);
    setLoading(true);
    setMessage('');
    setEmployeeReportOpen(true);
    try {
      const s =
        mode === 'super'
          ? await api.payrollSummary(token, { userId: id, from, to })
          : await api.adminPayrollSummary(token, { userId: id, from, to });
      setSummary(s);
      const at = Date.now();
      setSummaryCalculatedAt(at);
      if (ownerId) {
        setPayrollSummaryCache(ownerId, { mode, userId: id, from, to }, s);
      }
    } catch (e) {
      setSummary(null);
      setSummaryCalculatedAt(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [reportUserId, userId, mode, from, to, ownerId]);

  /** Auto-calc on employee / period change (debounce). */
  useEffect(() => {
    if (!employeeReportOpen || !reportUserId) return;
    if (autoLoadSkip.current) {
      autoLoadSkip.current = false;
      if (summary) return;
    }
    const t = window.setTimeout(() => {
      void load();
    }, 400);
    return () => window.clearTimeout(t);
    // intentionally omit `load` identity churn — key off filters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportUserId, from, to, employeeReportOpen]);

  const refreshFrom1c = async () => {
    const token = getToken();
    const id = reportUserId;
    if (!token || !id) return;
    if (id !== userId) setUserId(id);
    setSyncing1c(true);
    setMessage('');
    try {
      const res = await api.classSyncRefreshForPayroll(
        token,
        { from, to, userId: id },
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
    const id = reportUserId;
    if (!token || !id) return;
    if (id !== userId) setUserId(id);
    try {
      const s = await api.payrollLock(token, { userId: id, from, to });
      setSummary(s);
      const at = Date.now();
      setSummaryCalculatedAt(at);
      if (ownerId) {
        setPayrollSummaryCache(ownerId, { mode, userId: id, from, to }, s);
      }
      setMessage('Выплата подтверждена — период зафиксирован');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка подтверждения');
    }
  };

  const saveAdj = async () => {
    if (!canEdit) return;
    const token = getToken();
    const id = reportUserId;
    if (!token || !id || !adjReason.trim()) return;
    if (id !== userId) setUserId(id);
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
          userId: id,
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
    setReportTab('adjustments');
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

  const openPrintDialogFor = (
    ids: string[],
    rangeFrom: string,
    rangeTo: string,
  ) => {
    if (!canEdit || ids.length === 0) return;
    const idSet = new Set(ids);
    setBatchIds(idSet);
    setPrintRange({ from: rangeFrom, to: rangeTo });
    setPrintFields(DEFAULT_PAYSLIP);
    const previewSource =
      summary &&
      idSet.has(userId) &&
      summary.from === rangeFrom &&
      summary.to === rangeTo
        ? summary
        : null;
    setDocPreview(
      buildPayslipText({
        fields: DEFAULT_PAYSLIP,
        source: previewSource,
        ids: idSet,
        from: rangeFrom,
        to: rangeTo,
        staff,
      }),
    );
    setPrintOpen(true);
  };

  const refreshPreview = (fields: PayslipFields) => {
    setPrintFields(fields);
    const previewSource =
      summary &&
      batchIds.has(userId) &&
      summary.from === printRange.from &&
      summary.to === printRange.to
        ? summary
        : null;
    setDocPreview(
      buildPayslipText({
        fields,
        source: previewSource,
        ids: batchIds,
        from: printRange.from,
        to: printRange.to,
        staff,
      }),
    );
  };

  const savePayslipFile = async () => {
    const text =
      docPreview ||
      buildPayslipText({
        fields: printFields,
        source: summary,
        ids: batchIds,
        from: printRange.from,
        to: printRange.to,
        staff,
      });
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
        const s = await api.payrollSummary(token, {
          userId: id,
          from: printRange.from,
          to: printRange.to,
        });
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

  const openEmployeeReport = async (id: string, f: string, t: string) => {
    if (!canEdit) return;
    setDeptFilter('ALL');
    setUserId(id);
    setFrom(f);
    setTo(t);
    setEmployeeReportOpen(true);
    requestAnimationFrame(() => {
      document
        .getElementById('payroll-employee-report')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
        setPayrollSummaryCache(ownerId, { mode, userId: id, from: f, to: t }, s);
      }
    } catch (e) {
      setSummary(null);
      setSummaryCalculatedAt(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const onPreset = (p: PeriodPreset) => {
    const range = periodPresetRange(p);
    setFrom(range.from);
    setTo(range.to);
  };

  const onToggleSpaPartner = async (unitId: string, next: string | null) => {
    const token = getToken();
    if (!token) return;
    try {
      await api.payrollSetSpaPartner(token, unitId, next);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const onDeptChange = (d: DeptFilter) => {
    if (d === deptFilter) return;
    setDeptFilter(d);
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
            void openEmployeeReport(id, f, t);
          }}
        />
      )}

      {canEdit && (
        <PayrollPayoutsPanel
          staff={staff}
          open={payoutsOpen}
          onToggle={() => setPayoutsOpen((o) => !o)}
          onPrintSelected={(ids, rangeFrom, rangeTo) =>
            openPrintDialogFor(ids, rangeFrom, rangeTo)
          }
          printBusy={batchPrinting}
          onOpenEmployeeReport={(id, f, t) => {
            void openEmployeeReport(id, f, t);
          }}
        />
      )}

      <div id="payroll-employee-report">
        <PayrollFold
          open={employeeReportOpen}
          onToggle={() => setEmployeeReportOpen((o) => !o)}
          title="Отчёт по сотруднику"
          subtitle={
            selected
              ? `${selected.name}${
                  summary
                    ? ` · ${formatIsoDayRu(summary.from)}–${formatIsoDayRu(summary.to)} · ${money(summary.totalMinor, summary.currency)}`
                    : ''
                }`
              : 'Индивидуальный расчёт и проверка'
          }
          icon={UserRound}
          badge={selected?.name}
        >
          <ReportToolbar
            canEdit={canEdit}
            deptFilter={deptFilter}
            onDeptFilter={onDeptChange}
            filteredStaff={filteredStaff}
            reportUserId={reportUserId}
            onUserId={(id) => setUserId(id)}
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onPreset={onPreset}
            loading={loading}
            syncing1c={syncing1c}
            onRecalc={() => void load()}
            onRefresh1c={() => void refreshFrom1c()}
            onPrint={() => {
              if (reportUserId) {
                openPrintDialogFor([reportUserId], from, to);
              }
            }}
            printBusy={batchPrinting}
          />

          {summary && summaryCalculatedAt != null && (
            <p className="text-[11px] text-slate-500">
              Расчёт на {formatCalculatedAt(summaryCalculatedAt)}. «Пересчитать»
              или «Обновить из 1С» — заново.
            </p>
          )}

          {message && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
              {message}
            </p>
          )}

          {summary ? (
            <>
              <ReportHeader
                summary={summary}
                selected={selected}
                canEdit={canEdit}
                filterFrom={from}
                filterTo={to}
                onLock={() => void lock()}
              />

              <AttentionBar
                chips={attentionChips}
                anomalyHints={summary.anomalyHints}
                onOpen={(tab, kind) => {
                  setAttentionFocus(kind);
                  setReportTab(tab);
                }}
              />

              <ReportTabs
                summary={summary}
                tab={reportTab}
                onTab={(t) => {
                  setReportTab(t);
                  if (t !== 'attention') setAttentionFocus(null);
                }}
                attentionFocus={attentionFocus}
                controlMisses={controlMisses}
                controlLoading={controlLoading}
                bookingControlHref={bookingControlHref}
                mode={mode}
                canEdit={canEdit}
                onOpenControl={(sessionKey, day) =>
                  setPeekSession({ sessionKey, from: day, to: day })
                }
                onOpenSale={(unit) => void openSaleForUnit(unit)}
                onToggleSpaPartner={(unitId, next) =>
                  void onToggleSpaPartner(unitId, next)
                }
                saleDetailLoading={saleDetailLoading}
                adjAmount={adjAmount}
                adjReason={adjReason}
                editingAdjId={editingAdjId}
                onAdjAmount={setAdjAmount}
                onAdjReason={setAdjReason}
                onSaveAdj={() => void saveAdj()}
                onCancelEditAdj={cancelEditAdj}
                onStartEditAdj={startEditAdj}
                onDeleteAdj={(id) => void deleteAdj(id)}
              />
            </>
          ) : null}

          {!summary && !loading && (
            <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-12 text-center">
              <p className="text-sm text-slate-400">
                Выберите сотрудника и период
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Расчёт подгрузится автоматически
              </p>
            </div>
          )}
        </PayrollFold>
      </div>

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
              {batchIds.size === 1 ? 'а' : 'ов'} за период {printRange.from} —{' '}
              {printRange.to}.
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
                  batchPrinting || !Object.values(printFields).some(Boolean)
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
          canManagerRework={mode === 'super'}
          canViewHallPhotos
          canBulkApprove={mode === 'super'}
          detailOnly
          initialSessionKey={peekSession.sessionKey}
          initialFrom={peekSession.from}
          initialTo={peekSession.to}
          spaBookingEditHref={spaBookingEditHrefForBase(
            mode === 'super' ? 'super-admin' : 'admin',
          )}
          onDetailClose={() => {
            setPeekSession(null);
            void load();
            void reloadControlMisses();
          }}
        />
      ) : null}

      {salePicker ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onMouseDown={() => !saleDetailLoading && setSalePicker(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Продажа</h2>
                <p className="text-xs text-slate-400">
                  Найдено несколько документов — выберите карточку
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary px-2.5 py-1 text-xs"
                onClick={() => setSalePicker(null)}
              >
                Закрыть
              </button>
            </div>
            <ul className="space-y-1.5">
              {salePicker.lines.map((line) => (
                <li key={line.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-left hover:border-slate-600"
                    disabled={saleDetailLoading}
                    onClick={() => void openSalePeek(line.externalId)}
                  >
                    <span className="text-sm text-slate-100">
                      {line.productName?.trim() || 'Продажа'}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(line.occurredAt).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {line.clientName ? ` · ${line.clientName}` : ''}
                      <span className="ml-2 tabular-nums text-slate-300">
                        {(line.amountMinor / 100).toFixed(2)}{' '}
                        {salePicker.currency}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {saleDetail ? (
        <SaleDetailDrawer
          detail={saleDetail}
          onClose={() => setSaleDetail(null)}
          canRework={mode === 'super'}
        />
      ) : null}
    </div>
  );
}
