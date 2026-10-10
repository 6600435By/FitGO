import type { KpiFlag, StaffKpiRow } from '@fitgo/shared-types';

function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1]! + v[mid]!) / 2 : v[mid]!;
}

function percentileRank(value: number, values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  return below / sorted.length;
}

export function applyStaffFlags(rows: StaffKpiRow[]): StaffKpiRow[] {
  const byDept = new Map<string, StaffKpiRow[]>();
  for (const r of rows) {
    const list = byDept.get(r.department) ?? [];
    list.push(r);
    byDept.set(r.department, list);
  }

  return rows.map((row) => {
    const peers = byDept.get(row.department) ?? [];
    const flags: KpiFlag[] = [...row.flags];

    if (row.openRemarks > 0) {
      flags.push({
        id: 'open_remarks',
        severity: 'problem',
        label: 'Замечания',
        reason: `Открытых замечаний: ${row.openRemarks}`,
      });
    }
    if (row.openExceptions > 0) {
      flags.push({
        id: 'payroll_exceptions',
        severity: 'problem',
        label: 'Исключения ЗП',
        reason: `Открытых исключений расчёта: ${row.openExceptions}`,
      });
    }

    if (row.kpi.kind === 'ADMIN') {
      const k = row.kpi;
      if (k.tasksAssigned > 0 && k.tasksOverdue / k.tasksAssigned > 0.2) {
        flags.push({
          id: 'tasks_overdue',
          severity: 'problem',
          label: 'Просрочки',
          reason: `Просрочено ${k.tasksOverdue} из ${k.tasksAssigned} задач (>20%)`,
        });
      }
      if (k.tasksDonePct >= 90 && k.tasksAssigned >= 5) {
        flags.push({
          id: 'tasks_strong',
          severity: 'achievement',
          label: 'Задачи',
          reason: `Выполнено ${k.tasksDonePct}% задач`,
        });
      }
      const salesPerHour = peers
        .map((p) =>
          p.kpi.kind === 'ADMIN' ? p.kpi.salesPerHourMinor : null,
        )
        .filter((n): n is number => n != null && n > 0);
      if (
        k.salesPerHourMinor != null &&
        k.salesPerHourMinor > 0 &&
        percentileRank(k.salesPerHourMinor, salesPerHour) != null &&
        percentileRank(k.salesPerHourMinor, salesPerHour)! >= 0.75
      ) {
        flags.push({
          id: 'sales_top',
          severity: 'achievement',
          label: 'Топ продаж',
          reason: 'Продажи/час в верхних 25% подразделения',
        });
      }
    }

    if (row.kpi.kind === 'GROUP_TRAINER') {
      const k = row.kpi;
      const cancelRates = peers
        .map((p) =>
          p.kpi.kind === 'GROUP_TRAINER' ? p.kpi.cancelRatePct : null,
        )
        .filter((n): n is number => n != null);
      const med = median(cancelRates);
      if (
        k.cancelRatePct != null &&
        med != null &&
        med > 0 &&
        k.cancelRatePct > med * 1.5
      ) {
        flags.push({
          id: 'high_cancels',
          severity: 'problem',
          label: 'Отмены',
          reason: `Отмены ${k.cancelRatePct}% (медиана ${Math.round(med)}%)`,
        });
      }
      if (k.avgFillPct != null && k.avgFillPct >= 80 && k.sessionsConducted >= 4) {
        flags.push({
          id: 'high_fill',
          severity: 'achievement',
          label: 'Заполняемость',
          reason: `Средняя заполняемость ${k.avgFillPct}%`,
        });
      }
    }

    if (row.kpi.kind === 'PT_TRAINER') {
      const k = row.kpi;
      if (k.conversionPct != null && k.newClients >= 3 && k.conversionPct < 30) {
        flags.push({
          id: 'low_conversion',
          severity: 'problem',
          label: 'Конверсия',
          reason: `Конверсия ${k.conversionPct}% при ${k.newClients} новых (<30%)`,
        });
      }
      if (
        k.conversionPct != null &&
        k.newClients >= 3 &&
        k.conversionPct >= 60
      ) {
        flags.push({
          id: 'high_conversion',
          severity: 'achievement',
          label: 'Конверсия',
          reason: `Конверсия ${k.conversionPct}%`,
        });
      }
      if (
        k.retention90Pct != null &&
        k.retention90Pct < 25 &&
        k.newClients >= 0
      ) {
        // only flag if cohort had enough — checked via retentionCohort range existence
        if (k.retentionCohortFrom) {
          flags.push({
            id: 'low_retention',
            severity: 'problem',
            label: 'Удержание',
            reason: `Удержание 90д: ${k.retention90Pct}%`,
          });
        }
      }
    }

    if (row.kpi.kind === 'SPECIALIST') {
      const k = row.kpi;
      if (k.unknownPayCount > 0) {
        flags.push({
          id: 'unknown_pay',
          severity: 'info',
          label: 'Источник оплаты',
          reason: `${k.unknownPayCount} услуг без Allsports/абонемент/оплаты — возможен недоучёт`,
        });
      }
      if (k.repeatPct != null && k.newClients >= 3 && k.repeatPct < 20) {
        flags.push({
          id: 'low_repeat',
          severity: 'problem',
          label: 'Повторность',
          reason: `Повторные визиты ${k.repeatPct}% (<20%)`,
        });
      }
      if (k.repeatPct != null && k.newClients >= 3 && k.repeatPct >= 50) {
        flags.push({
          id: 'high_repeat',
          severity: 'achievement',
          label: 'Повторность',
          reason: `Повторные визиты ${k.repeatPct}%`,
        });
      }
    }

    // Dedupe by id
    const seen = new Set<string>();
    const unique = flags.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });

    return { ...row, flags: unique };
  });
}
