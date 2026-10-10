'use client';

import type {
  AnalyticsDepartment,
  ManagerEfficiencyBlock,
  StaffAnalyticsReport,
  StaffKpiRow,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { KpiFlagBadge } from './kpi-flag-badge';

const DEPTS: { id: AnalyticsDepartment; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'ADMIN', label: 'Админы' },
  { id: 'GROUP_TRAINER', label: 'ГП' },
  { id: 'PT_TRAINER', label: 'ПТ' },
  { id: 'SPECIALIST', label: 'SPA' },
  { id: 'TECH', label: 'Тех' },
  { id: 'MANAGER', label: 'Упр.' },
];

const STATUS_COLOR = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-rose-500',
};

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}\u00a0${currency}`;
}

function ManagerEfficiencyPanel({
  block,
}: {
  block: ManagerEfficiencyBlock;
}) {
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold">Эффективность управляющего</h3>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {block.indicators.map((ind) => (
          <div
            key={ind.id}
            className="rounded-xl bg-slate-800/50 p-3 text-sm"
            title={ind.hint}
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[ind.status]}`}
              />
              <span className="text-slate-400">{ind.label}</span>
            </div>
            <p className="font-medium">{ind.value}</p>
            {ind.compareValue != null && ind.compareValue !== '' && (
              <p className="text-xs text-slate-500">было: {ind.compareValue}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function kpiCells(row: StaffKpiRow, currency: string) {
  const k = row.kpi;
  if (k.kind === 'ADMIN') {
    return (
      <>
        <td className="px-2 py-2 text-right">
          {money(k.salesBySegment.totalMinor, currency)}
        </td>
        <td className="px-2 py-2 text-right">
          {k.salesPerHourMinor != null
            ? money(k.salesPerHourMinor, currency)
            : '—'}
        </td>
        <td className="px-2 py-2 text-right">{k.tasksDonePct}%</td>
        <td className="px-2 py-2 text-right">{k.tasksOverdue}</td>
        <td className="px-2 py-2 text-right">
          {k.bookingApprovalsGroup + k.bookingApprovalsSession}
        </td>
      </>
    );
  }
  if (k.kind === 'GROUP_TRAINER') {
    return (
      <>
        <td className="px-2 py-2 text-right">{k.sessionsConducted}</td>
        <td className="px-2 py-2 text-right">{k.avgAttendees}</td>
        <td className="px-2 py-2 text-right">
          {k.avgFillPct != null ? `${k.avgFillPct}%` : '—'}
        </td>
        <td className="px-2 py-2 text-right">
          {k.cancelRatePct != null ? `${k.cancelRatePct}%` : '—'}
        </td>
        <td className="px-2 py-2 text-right">
          {k.noShowPct != null ? `${k.noShowPct}%` : '—'}
        </td>
      </>
    );
  }
  if (k.kind === 'PT_TRAINER') {
    return (
      <>
        <td className="px-2 py-2 text-right">{k.sessionsConducted}</td>
        <td className="px-2 py-2 text-right">{k.newClients}</td>
        <td
          className="px-2 py-2 text-right"
          title="Доля новых с платной ПТ за 30 дней"
        >
          {k.conversionPct != null ? `${k.conversionPct}%` : '—'}
        </td>
        <td
          className="px-2 py-2 text-right"
          title={
            k.retentionCohortFrom
              ? `Когорта первых ПТ ${k.retentionCohortFrom} — ${k.retentionCohortTo}`
              : undefined
          }
        >
          {k.retention90Pct != null ? `${k.retention90Pct}%` : '—'}
        </td>
        <td className="px-2 py-2 text-right">{k.activeClients30d}</td>
        <td className="px-2 py-2 text-right">
          {money(k.ptSalesMinor, currency)}
        </td>
      </>
    );
  }
  if (k.kind === 'SPECIALIST') {
    return (
      <>
        <td className="px-2 py-2 text-right">{k.servicesTotal}</td>
        <td className="px-2 py-2 text-right">{k.quotaCount}</td>
        <td className="px-2 py-2 text-right">{k.paidCount}</td>
        <td className="px-2 py-2 text-right">{k.allsportsCount}</td>
        <td className="px-2 py-2 text-right">
          {k.repeatPct != null ? `${k.repeatPct}%` : '—'}
        </td>
        <td className="px-2 py-2 text-right">
          {money(k.paidRevenueMinor, currency)}
        </td>
      </>
    );
  }
  if (k.kind === 'TECH') {
    return (
      <>
        <td className="px-2 py-2 text-right">{k.shifts}</td>
        <td className="px-2 py-2 text-right">{k.overtimeMinutes}</td>
      </>
    );
  }
  if (k.kind === 'MANAGER') {
    return (
      <>
        <td className="px-2 py-2 text-right">
          {money(k.corporateSalesMinor, currency)}
        </td>
        <td className="px-2 py-2 text-right">
          {money(k.motivationSalesMinor, currency)}
        </td>
      </>
    );
  }
  return null;
}

function kpiHeaders(dept: AnalyticsDepartment) {
  if (dept === 'ADMIN') {
    return ['Продажи', 'Прод./час', 'Задачи %', 'Просроч.', 'Контроль'];
  }
  if (dept === 'GROUP_TRAINER') {
    return ['Занятия', 'Ср. чел.', 'Заполн.', 'Отмены', 'Неявки'];
  }
  if (dept === 'PT_TRAINER') {
    return ['ПТ', 'Новые', 'Конв.', 'Удерж.90', 'Активн.', 'Продажи'];
  }
  if (dept === 'SPECIALIST') {
    return ['Услуги', 'Абон.', 'Оплата', 'Allsport', 'Повтор', 'Выручка'];
  }
  if (dept === 'TECH') return ['Смены', 'Перераб. мин'];
  if (dept === 'MANAGER') return ['Корпо', 'Мотивация'];
  return ['KPI'];
}

export function StaffAnalyticsTable({
  report,
  department,
  onDepartmentChange,
  onExport,
  exporting,
  showPay,
  managerEfficiency,
  managerLoading,
}: {
  report: StaffAnalyticsReport;
  department: AnalyticsDepartment;
  onDepartmentChange: (d: AnalyticsDepartment) => void;
  onExport: () => void;
  exporting: boolean;
  showPay: boolean;
  /** Loaded separately — only for ALL / MANAGER. */
  managerEfficiency?: ManagerEfficiencyBlock | null;
  managerLoading?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'hours'>('name');
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    let list = report.rows;
    if (department !== 'ALL') {
      list = list.filter((r) => r.department === department);
    }
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(qq));
    }
    return [...list].sort((a, b) => {
      if (sortKey === 'hours') return b.hours - a.hours;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [report.rows, department, q, sortKey]);

  const headerDept =
    department === 'ALL'
      ? (rows[0]?.department ?? 'ADMIN')
      : department;
  const headers = kpiHeaders(headerDept);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Проблем: {report.problemCount} · Достижений:{' '}
          {report.achievementCount} · Сотрудников: {report.totals.staffCount}
        </p>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={exporting}
          onClick={onExport}
        >
          {exporting ? 'Excel…' : 'Выгрузить Excel'}
        </button>
      </div>

      {(department === 'ALL' || department === 'MANAGER') && (
        <>
          {managerLoading && !managerEfficiency && (
            <div className="card py-6 text-center text-sm text-slate-400">
              Загрузка блока управляющего…
            </div>
          )}
          {managerEfficiency && (
            <ManagerEfficiencyPanel block={managerEfficiency} />
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {DEPTS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onDepartmentChange(d.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              department === d.id
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Поиск сотрудника"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input max-w-[10rem]"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as 'name' | 'hours')}
        >
          <option value="name">По имени</option>
          <option value="hours">По часам</option>
        </select>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-900 text-xs text-slate-400">
            <tr>
              <th className="sticky left-0 bg-slate-900 px-3 py-2">ФИО</th>
              <th className="px-2 py-2">Подр.</th>
              <th className="px-2 py-2 text-right">Часы</th>
              {department !== 'ALL' &&
                headers.map((h) => (
                  <th key={h} className="px-2 py-2 text-right">
                    {h}
                  </th>
                ))}
              {department === 'ALL' && (
                <th className="px-2 py-2 text-right">KPI</th>
              )}
              <th className="px-2 py-2">Флаги</th>
              {showPay && report.includePay && (
                <>
                  <th className="px-2 py-2 text-right">Начислено</th>
                  <th className="px-2 py-2 text-right">Аванс</th>
                  <th className="px-2 py-2 text-right">К выдаче</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Нет данных за период
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const rowKey = `${r.userId}:${r.department}`;
                const open = expanded === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className="border-t border-slate-800 hover:bg-slate-800/40"
                      onClick={() => setExpanded(open ? null : rowKey)}
                    >
                      <td className="sticky left-0 bg-slate-900/95 px-3 py-2 font-medium">
                        {r.name}
                      </td>
                      <td className="px-2 py-2 text-slate-400">
                        {r.department}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {Math.round(r.hours * 10) / 10}
                      </td>
                      {department !== 'ALL' ? (
                        kpiCells(r, report.currency)
                      ) : (
                        <td className="px-2 py-2 text-right text-slate-400">
                          {r.kpi.kind === 'ADMIN'
                            ? money(r.kpi.salesBySegment.totalMinor, report.currency)
                            : r.kpi.kind === 'GROUP_TRAINER'
                              ? `${r.kpi.sessionsConducted} зан.`
                              : r.kpi.kind === 'PT_TRAINER'
                                ? `${r.kpi.sessionsConducted} ПТ`
                                : r.kpi.kind === 'SPECIALIST'
                                  ? `${r.kpi.servicesTotal} усл.`
                                  : r.kpi.kind === 'TECH'
                                    ? `${r.kpi.shifts} смен`
                                    : money(
                                        r.kpi.corporateSalesMinor,
                                        report.currency,
                                      )}
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.flags.map((f) => (
                            <KpiFlagBadge key={f.id} flag={f} />
                          ))}
                        </div>
                      </td>
                      {showPay && report.includePay && (
                        <>
                          <td className="px-2 py-2 text-right">
                            {r.pay
                              ? money(r.pay.totalEarnedMinor, report.currency)
                              : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {r.pay
                              ? money(r.pay.advancePaidMinor, report.currency)
                              : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {r.pay
                              ? money(r.pay.toPayMinor, report.currency)
                              : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                    {open && (
                      <tr className="bg-slate-800/30">
                        <td colSpan={12} className="px-3 py-3 text-sm text-slate-300">
                          <DetailRow row={r} currency={report.currency} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailRow({ row, currency }: { row: StaffKpiRow; currency: string }) {
  const k = row.kpi;
  return (
    <div className="space-y-2">
      {k.kind === 'ADMIN' && (
        <p>
          Продажи: абон. {money(k.salesBySegment.membershipMinor, currency)},
          спа {money(k.salesBySegment.spaMinor, currency)}, магазин{' '}
          {money(k.salesBySegment.shopMinor, currency)}. Задачи: {k.tasksDone}/
          {k.tasksAssigned}, медиана закрытия {k.medianCloseHours ?? '—'} ч.
          Подтверждения ГП {k.bookingApprovalsGroup}, ПТ/SPA{' '}
          {k.bookingApprovalsSession}
          {k.approvalSharePct != null ? ` (${k.approvalSharePct}% клуба)` : ''}.
        </p>
      )}
      {k.kind === 'PT_TRAINER' && (
        <p>
          Платные {k.paidSessions}, подарочные {k.giftSessions}. Конверсия —
          доля новых клиентов с платной ПТ за 30 дней после первой.
          Удержание 90 дн. — когорта{' '}
          {k.retentionCohortFrom
            ? `${k.retentionCohortFrom}…${k.retentionCohortTo}`
            : 'н/д'}
          .
        </p>
      )}
      {k.kind === 'SPECIALIST' && k.unknownPayCount > 0 && (
        <p className="text-amber-300">
          Услуг без источника оплаты: {k.unknownPayCount} (возможен недоучёт
          Allsports).
        </p>
      )}
      {row.openRemarks > 0 && (
        <p>Открытых замечаний: {row.openRemarks}</p>
      )}
      {row.openExceptions > 0 && (
        <p>Исключений ЗП: {row.openExceptions}</p>
      )}
      <Link
        href={`/super-admin/payroll?userId=${row.userId}`}
        className="text-fitgo-400 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        Открыть ЗП сотрудника →
      </Link>
    </div>
  );
}
