'use client';

import type {
  AnalyticsCompareMode,
  AnalyticsDepartment,
  ClubAnalyticsReport,
  ManagerEfficiencyBlock,
  StaffAnalyticsReport,
} from '@fitgo/shared-types';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ClubAnalyticsPanel } from '@/components/analytics/club-analytics-panel';
import {
  PayVisibilityToggle,
  readPayVisibility,
} from '@/components/analytics/pay-visibility-toggle';
import { StaffAnalyticsTable } from '@/components/analytics/staff-analytics-table';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type Tab = 'club' | 'staff';

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthBounds(ref = new Date()) {
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const to = new Date();
  return { from: isoDate(from), to: isoDate(to) };
}

function staffCacheKey(from: string, to: string, includePay: boolean) {
  return `${from}|${to}|pay:${includePay ? 1 : 0}`;
}

function clubCacheKey(
  from: string,
  to: string,
  compare: string,
  includePay: boolean,
) {
  return `${from}|${to}|${compare}|pay:${includePay ? 1 : 0}`;
}

function filterStaffReport(
  report: StaffAnalyticsReport,
  department: AnalyticsDepartment,
): StaffAnalyticsReport {
  const rows =
    department === 'ALL'
      ? report.rows
      : report.rows.filter((r) => r.department === department);
  const problemCount = rows.reduce(
    (a, r) => a + r.flags.filter((f) => f.severity === 'problem').length,
    0,
  );
  const achievementCount = rows.reduce(
    (a, r) => a + r.flags.filter((f) => f.severity === 'achievement').length,
    0,
  );
  const totals = {
    staffCount: new Set(rows.map((r) => r.userId)).size,
    hours: rows.reduce((a, r) => a + r.hours, 0),
    ...(report.includePay
      ? {
          totalEarnedMinor: rows.reduce(
            (a, r) => a + (r.pay?.totalEarnedMinor ?? 0),
            0,
          ),
          toPayMinor: rows.reduce((a, r) => a + (r.pay?.toPayMinor ?? 0), 0),
        }
      : {}),
  };
  return {
    ...report,
    department,
    rows,
    problemCount,
    achievementCount,
    totals,
  };
}

function AnalyticsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaults = useMemo(() => monthBounds(), []);
  const tab = (searchParams.get('tab') as Tab) || 'club';
  const from = searchParams.get('from') || defaults.from;
  const to = searchParams.get('to') || defaults.to;
  const compare = (searchParams.get('compare') as AnalyticsCompareMode) || 'prev';
  const department =
    (searchParams.get('department') as AnalyticsDepartment) || 'ALL';

  const [showPay, setShowPay] = useState(false);
  const [club, setClub] = useState<ClubAnalyticsReport | null>(null);
  const [staffAll, setStaffAll] = useState<StaffAnalyticsReport | null>(null);
  const [managerEff, setManagerEff] = useState<ManagerEfficiencyBlock | null>(
    null,
  );
  const [managerLoading, setManagerLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const clubCache = useRef(new Map<string, ClubAnalyticsReport>());
  const staffCache = useRef(new Map<string, StaffAnalyticsReport>());
  const managerCache = useRef(new Map<string, ManagerEfficiencyBlock>());

  useEffect(() => {
    setShowPay(readPayVisibility());
  }, []);

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Club / staff report: reload on period / pay / tab — NOT on department.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setError('');

    const run = async () => {
      try {
        if (tab === 'club') {
          const key = clubCacheKey(from, to, compare, showPay);
          const hit = clubCache.current.get(key);
          if (hit) {
            if (!cancelled) {
              setClub(hit);
              setLoading(false);
            }
            return;
          }
          setLoading(true);
          const data = await api.analyticsClub(token, {
            from,
            to,
            compare,
            includePay: showPay,
          });
          if (!cancelled) {
            clubCache.current.set(key, data);
            setClub(data);
          }
        } else {
          const key = staffCacheKey(from, to, showPay);
          const hit = staffCache.current.get(key);
          if (hit) {
            if (!cancelled) {
              setStaffAll(hit);
              setLoading(false);
            }
            return;
          }
          setLoading(true);
          // Always fetch ALL — department is filtered client-side.
          const data = await api.analyticsStaff(token, {
            from,
            to,
            includePay: showPay,
          });
          if (!cancelled) {
            staffCache.current.set(key, data);
            setStaffAll(data);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Ошибка загрузки');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tab, from, to, compare, showPay]);

  // Manager efficiency: only when staff tab + ALL or MANAGER.
  useEffect(() => {
    if (tab !== 'staff') return;
    if (department !== 'ALL' && department !== 'MANAGER') {
      setManagerEff(null);
      setManagerLoading(false);
      return;
    }
    const token = getToken();
    if (!token) return;
    const key = `${from}|${to}`;
    const hit = managerCache.current.get(key);
    if (hit) {
      setManagerEff(hit);
      setManagerLoading(false);
      return;
    }
    let cancelled = false;
    setManagerLoading(true);
    void api
      .analyticsStaffManagerEfficiency(token, { from, to })
      .then((data) => {
        if (cancelled) return;
        managerCache.current.set(key, data);
        setManagerEff(data);
      })
      .catch(() => {
        if (!cancelled) setManagerEff(null);
      })
      .finally(() => {
        if (!cancelled) setManagerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, department, from, to]);

  const staffView = useMemo(() => {
    if (!staffAll) return null;
    return filterStaffReport(staffAll, department);
  }, [staffAll, department]);

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setParams({ from: isoDate(start), to: isoDate(end) });
  };

  const setThisMonth = () => {
    const b = monthBounds();
    setParams({ from: b.from, to: b.to });
  };

  const onExport = async () => {
    const token = getToken();
    if (!token) return;
    setExporting(true);
    try {
      const blob = await api.analyticsStaffXlsx(token, {
        from,
        to,
        department: department === 'ALL' ? undefined : department,
        includePay: showPay,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics_staff_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['club', 'staff'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setParams({ tab: t })}
            className={`rounded-full px-4 py-1.5 text-sm ${
              tab === t ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
            }`}
          >
            {t === 'club' ? 'Клуб' : 'Персонал'}
          </button>
        ))}
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">С</span>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setParams({ from: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">По</span>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setParams({ to: e.target.value })}
          />
        </label>
        {tab === 'club' && (
          <label className="text-sm">
            <span className="mb-1 block text-slate-400">Сравнение</span>
            <select
              className="input"
              value={compare}
              onChange={(e) =>
                setParams({ compare: e.target.value as AnalyticsCompareMode })
              }
            >
              <option value="prev">Прошлый период</option>
              <option value="yoy">Год назад</option>
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={setThisMonth}
          >
            Этот месяц
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setPreset(7)}
          >
            7 дн.
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setPreset(30)}
          >
            30 дн.
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setPreset(90)}
          >
            90 дн.
          </button>
        </div>
        <PayVisibilityToggle show={showPay} onChange={setShowPay} />
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      )}

      {!loading && tab === 'club' && club && (
        <ClubAnalyticsPanel report={club} showPay={showPay} />
      )}

      {!loading && tab === 'staff' && staffView && (
        <StaffAnalyticsTable
          report={staffView}
          department={department}
          onDepartmentChange={(d) => setParams({ department: d })}
          onExport={onExport}
          exporting={exporting}
          showPay={showPay}
          managerEfficiency={
            department === 'ALL' || department === 'MANAGER'
              ? managerEff
              : null
          }
          managerLoading={
            (department === 'ALL' || department === 'MANAGER') &&
            managerLoading
          }
        />
      )}
    </div>
  );
}

export default function SuperAdminAnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      }
    >
      <AnalyticsInner />
    </Suspense>
  );
}
