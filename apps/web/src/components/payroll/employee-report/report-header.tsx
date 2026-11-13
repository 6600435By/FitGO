'use client';

import type {
  PayrollPeriodSummary,
  StaffPaySummary,
} from '@fitgo/shared-types';
import { useState } from 'react';
import { money } from '@/components/payroll/employee-report/work-unit-status';

export const TRACK_HINT: Record<string, string> = {
  ADMIN: 'Часы + % абонементов/доп/магазин/корпо + премии/штрафы (без безнала)',
  MANAGER: 'Оклад + % абонементов/доп клуба + корпо + премии/штрафы (без безнала)',
  GROUP_TRAINER: 'Тиры ставка×зал×люди (из расписания)',
  SPA: '% услуг + блок массажа + фикс из абонемента + биоимпеданс AllSports',
  TECH: 'Часы смены + премии/штрафы отдельно',
  PT: '% от оплаченных ПТ (ступени по объёму; подарки в счёт)',
  CLUB: '% ПТ клубных тренеров, без оклада и аванса',
};

function formatIsoDayRu(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

type Props = {
  summary: PayrollPeriodSummary;
  selected?: StaffPaySummary;
  canEdit: boolean;
  filterFrom: string;
  filterTo: string;
  onLock: () => void;
};

export function ReportHeader({
  summary,
  selected,
  canEdit,
  filterFrom,
  filterTo,
  onLock,
}: Props) {
  const [ratesOpen, setRatesOpen] = useState(false);
  const paid = summary.paidPayouts;
  const totalPaid = paid?.totalPaidMinor ?? 0;
  const remaining = Math.max(0, summary.totalMinor - totalPaid);
  const advance = paid?.advanceMinor ?? 0;
  const periodStale =
    summary.from !== filterFrom || summary.to !== filterTo;
  const chips =
    summary.payChips?.length > 0
      ? summary.payChips
      : selected?.payChips ?? [];
  const track = selected?.track;
  const trackHint = track ? TRACK_HINT[track] : undefined;

  return (
    <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/50 p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Итого начислено
            <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">
              {formatIsoDayRu(summary.from)}–{formatIsoDayRu(summary.to)}
            </span>
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-fitgo-300 md:text-3xl">
            {money(summary.totalMinor, summary.currency)}
          </p>
          {periodStale ? (
            <p className="mt-1 text-xs text-amber-300">
              Даты изменены — нажмите «Пересчитать»
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary.locked ? (
            <span className="rounded-full bg-fitgo-500/15 px-2.5 py-1 text-xs text-fitgo-300">
              Период закрыт
            </span>
          ) : (
            <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
              Период открыт
            </span>
          )}
          <span
            className={
              summary.openExceptions > 0
                ? 'text-sm text-amber-300'
                : 'text-sm text-slate-500'
            }
          >
            нестыковок: {summary.openExceptions}
          </span>
          {canEdit ? (
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              disabled={!summary.canLock}
              title={
                summary.locked
                  ? 'Период уже зафиксирован'
                  : 'Фиксирует период начисления (не меняет карту/кассу в листе выплат)'
              }
              onClick={onLock}
            >
              {summary.locked ? 'Период закрыт' : 'Закрыть период'}
            </button>
          ) : null}
        </div>
      </div>

      {canEdit && remaining > 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-100">
          Остаток {money(remaining, summary.currency)} — измените «Карта» /
          «Из кассы» в листе выплат выше (строки со статусом «Выплачено» тоже
          редактируются) и сохраните.
        </p>
      ) : null}

      {canEdit && !summary.canLock && !summary.locked ? (
        <p className="text-xs text-amber-200/90">
          Закрытие периода недоступно
          {summary.openExceptions > 0
            ? ` — открытых нестыковок: ${summary.openExceptions}`
            : ''}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-800/80 pt-2.5 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          label="Оклад / часы"
          value={money(summary.baseSalaryMinor, summary.currency)}
        />
        <Metric
          label="Мотивация"
          value={money(summary.motivationMinor, summary.currency)}
        />
        <Metric
          label="± Корректировки"
          value={money(summary.adjustmentsMinor, summary.currency)}
          tone={
            summary.adjustmentsMinor > 0
              ? 'pos'
              : summary.adjustmentsMinor < 0
                ? 'neg'
                : undefined
          }
        />
        <Metric
          label="Выплачено"
          value={money(totalPaid, summary.currency)}
          hint={
            totalPaid > 0
              ? [
                  advance > 0
                    ? `аванс ${money(paid?.advanceCardMinor ?? 0, summary.currency)}+${money(paid?.advanceCashMinor ?? 0, summary.currency)}`
                    : null,
                  (paid?.settlementCardMinor ?? 0) +
                    (paid?.settlementCashMinor ?? 0) >
                  0
                    ? `расчёт ${money(paid?.settlementCardMinor ?? 0, summary.currency)}+${money(paid?.settlementCashMinor ?? 0, summary.currency)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'подтверждённые выплаты за период'
              : 'подтверждённые выплаты за период'
          }
        />
        <Metric
          label="Остаток"
          value={money(remaining, summary.currency)}
          tone={remaining > 0 ? 'accent' : undefined}
        />
      </div>

      {(track || chips.length > 0) && (
        <div className="border-t border-slate-800/80 pt-2">
          <button
            type="button"
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
            onClick={() => setRatesOpen((o) => !o)}
          >
            {track ? (
              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                {track}
              </span>
            ) : null}
            <span>Ставки {ratesOpen ? '▾' : '▸'}</span>
          </button>
          {ratesOpen ? (
            <div className="mt-1.5 space-y-1.5">
              {trackHint ? (
                <p className="text-xs text-slate-500">{trackHint}</p>
              ) : null}
              {chips.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-0.5 text-xs text-slate-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'pos' | 'neg' | 'accent';
}) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-0.5 font-semibold tabular-nums ${
          tone === 'accent'
            ? 'text-fitgo-300'
            : tone === 'pos'
              ? 'text-emerald-300'
              : tone === 'neg'
                ? 'text-red-300'
                : 'text-white'
        }`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-[10px] text-slate-600">{hint}</p>
      ) : null}
    </div>
  );
}
