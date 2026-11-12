'use client';

import type { WorkUnit } from '@fitgo/shared-types';
import { useMemo, useState, type ReactNode } from 'react';
import {
  unitCanOpenSale,
  unitCostLabel,
  unitDayIso,
  unitEarnLabel,
} from '@/components/payroll/employee-report/sale-links';
import {
  classifyWorkUnit,
  matchesStatusFilter,
  money,
  statusBadgeClass,
  statusRowClass,
  sumEarn,
  sumSold,
  type StatusFilter,
} from '@/components/payroll/employee-report/work-unit-status';
import { formatDateTime } from '@/lib/utils';

export type WorkUnitsKindView = 'PT' | 'GROUP' | 'SPA' | 'SHIFT' | 'GIFTS' | 'MIXED';

type Props = {
  units: WorkUnit[];
  kind: WorkUnitsKindView;
  currency: string;
  mode: 'admin' | 'super';
  canEdit: boolean;
  onOpenControl?: (sessionKey: string, day: string) => void;
  onOpenSale?: (unit: WorkUnit) => void;
  onToggleSpaPartner?: (unitId: string, next: string | null) => void;
  saleDetailLoading?: boolean;
  /** Mini summary above the table. */
  footerExtra?: ReactNode;
};

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'IN_PAY', label: 'В ЗП' },
  { id: 'CHECK', label: 'Проверить' },
  { id: 'EXCLUDED', label: 'Не в ЗП' },
];

function unitDayLabel(u: WorkUnit): string {
  return new Date(u.occurredAt).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function WorkUnitsTable({
  units,
  kind,
  currency,
  mode,
  canEdit,
  onOpenControl,
  onOpenSale,
  onToggleSpaPartner,
  saleDetailLoading,
  footerExtra,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>('ALL');

  const filtered = useMemo(
    () =>
      units.filter((u) => matchesStatusFilter(classifyWorkUnit(u), filter)),
    [units, filter],
  );

  const earned = sumEarn(filter === 'ALL' ? units : filtered);
  const sold = sumSold(filter === 'ALL' ? units : filtered);
  const showPay = kind === 'PT' || kind === 'SPA' || kind === 'MIXED';
  const showGroup = kind === 'GROUP' || kind === 'MIXED';
  const showShift = kind === 'SHIFT' || kind === 'MIXED';

  if (units.length === 0) {
    return <p className="text-sm text-slate-500">Нет строк</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={
              filter === f.id
                ? 'rounded-md bg-slate-700 px-2 py-0.5 text-[11px] text-white'
                : 'rounded-md px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200'
            }
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-slate-500">
          {filtered.length} / {units.length}
        </span>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {filtered.map((u) => {
          const st = classifyWorkUnit(u);
          return (
            <article
              key={`${u.kind}-${u.id}`}
              className={`rounded-xl border border-slate-800 bg-slate-950/50 p-3 ${statusRowClass(st.level)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-white">{u.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(u.occurredAt)}
                    {u.clientName ? ` · ${u.clientName}` : ''}
                    {u.roomTitle ? ` · ${u.roomTitle}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] ${statusBadgeClass(st.level)}`}
                  title={st.reason}
                >
                  {st.label}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                {u.kind === 'SHIFT' ? (
                  <span>{u.quantity} ч</span>
                ) : u.kind === 'GROUP' ? (
                  <span>{u.quantity} чел.</span>
                ) : (
                  <span>×{u.quantity}</span>
                )}
                {(u.kind === 'PT' || u.kind === 'SPA' || u.kind === 'GROUP') && (
                  <>
                    <span>{unitCostLabel(u, currency)}</span>
                    <span className="text-slate-300">
                      {unitEarnLabel(u, currency)}
                    </span>
                  </>
                )}
                {u.kind === 'SHIFT' && u.priceMinor != null && (
                  <span className="text-emerald-400">
                    {money(u.priceMinor, currency)}
                  </span>
                )}
              </div>
              {st.reason ? (
                <p className="mt-1 text-[11px] text-slate-500">{st.reason}</p>
              ) : null}
              <RowLinks
                u={u}
                mode={mode}
                canEdit={canEdit}
                saleDetailLoading={saleDetailLoading}
                onOpenControl={onOpenControl}
                onOpenSale={onOpenSale}
                onToggleSpaPartner={onToggleSpaPartner}
              />
            </article>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-800 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-950/80 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Когда</th>
              {kind === 'MIXED' ? <th className="px-3 py-2.5">Вид</th> : null}
              <th className="px-3 py-2.5">
                {showShift && !showPay && !showGroup ? 'Смена' : 'Услуга'}
              </th>
              {(showGroup || showShift || showPay) && (
                <th className="px-3 py-2.5">
                  {showShift && kind === 'SHIFT' ? 'Часы' : 'Кол-во'}
                </th>
              )}
              {showPay || kind === 'GROUP' ? (
                <>
                  <th className="px-3 py-2.5">Стоимость</th>
                  <th className="px-3 py-2.5">Начислено</th>
                </>
              ) : null}
              {kind === 'SHIFT' ? (
                <th className="px-3 py-2.5">Сумма</th>
              ) : null}
              <th className="px-3 py-2.5">Статус</th>
              <th className="px-3 py-2.5">Ссылки</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const st = classifyWorkUnit(u);
              const canSale = unitCanOpenSale(u);
              return (
                <tr
                  key={`${u.kind}-${u.id}`}
                  className={`border-t border-slate-900/80 ${statusRowClass(st.level)}`}
                >
                  <td className="px-3 py-2 text-slate-400">
                    <span className="tabular-nums">{unitDayLabel(u)}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-600">
                      {formatDateTime(u.occurredAt).split(' ').slice(-1)[0]}
                    </span>
                  </td>
                  {kind === 'MIXED' ? (
                    <td className="px-3 py-2 text-xs uppercase text-slate-500">
                      {u.kind}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <span className="text-slate-200">{u.title}</span>
                    {u.clientName ? (
                      <span className="text-slate-500"> · {u.clientName}</span>
                    ) : null}
                    {u.roomTitle ? (
                      <span className="text-slate-500"> · {u.roomTitle}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">
                    {u.kind === 'SHIFT'
                      ? `${u.quantity} ч`
                      : u.kind === 'GROUP'
                        ? `${u.quantity} чел.`
                        : u.quantity}
                  </td>
                  {showPay || kind === 'GROUP' ? (
                    <>
                      <td className="px-3 py-2 tabular-nums text-slate-300">
                        {u.kind === 'GROUP'
                          ? '—'
                          : unitCostLabel(u, currency)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-200">
                        {unitEarnLabel(u, currency)}
                      </td>
                    </>
                  ) : null}
                  {kind === 'SHIFT' ? (
                    <td className="px-3 py-2 tabular-nums text-emerald-300">
                      {u.priceMinor != null
                        ? money(u.priceMinor, currency)
                        : '—'}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs ${statusBadgeClass(st.level)}`}
                      title={st.reason}
                    >
                      {st.label}
                    </span>
                    {st.reason ? (
                      <span className="mt-0.5 block max-w-[12rem] truncate text-[10px] text-slate-600">
                        {st.reason}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex flex-wrap gap-2 text-xs">
                      {u.sessionKey && onOpenControl ? (
                        <button
                          type="button"
                          className="text-sky-300 hover:underline"
                          onClick={() =>
                            onOpenControl(u.sessionKey!, unitDayIso(u))
                          }
                        >
                          Контроль
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                      {canSale && onOpenSale ? (
                        <button
                          type="button"
                          className="text-sky-300 hover:underline"
                          disabled={saleDetailLoading}
                          onClick={() => onOpenSale(u)}
                        >
                          Продажа
                        </button>
                      ) : null}
                      {u.kind === 'SPA' && canEdit && onToggleSpaPartner ? (
                        <button
                          type="button"
                          className={
                            u.partnerSource === 'ALLSPORTS'
                              ? 'rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300'
                              : 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400'
                          }
                          onClick={() =>
                            onToggleSpaPartner(
                              u.id,
                              u.partnerSource === 'ALLSPORTS'
                                ? null
                                : 'ALLSPORTS',
                            )
                          }
                        >
                          {u.partnerSource === 'ALLSPORTS'
                            ? 'AllSports ✓'
                            : 'AllSports'}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 bg-slate-950/90 text-xs">
              <td
                colSpan={kind === 'MIXED' ? 3 : 2}
                className="px-3 py-2.5 font-medium uppercase tracking-wide text-slate-500"
              >
                Итого
              </td>
              <td className="px-3 py-2.5 tabular-nums text-slate-300">
                {kind === 'GROUP'
                  ? `${units.filter((u) => u.kind === 'GROUP').length} зан.`
                  : kind === 'SHIFT'
                    ? `${units.reduce((a, u) => a + u.quantity, 0)} ч`
                    : `${units.length}`}
              </td>
              {showPay || kind === 'GROUP' ? (
                <>
                  <td className="px-3 py-2.5 tabular-nums text-slate-200">
                    {money(sold, currency)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-300">
                    {money(earned, currency)}
                  </td>
                </>
              ) : null}
              {kind === 'SHIFT' ? (
                <td className="px-3 py-2.5 tabular-nums text-emerald-300">
                  {money(earned, currency)}
                </td>
              ) : null}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 md:hidden">
        <span>
          Начислено:{' '}
          <span className="tabular-nums text-emerald-300">
            {money(earned, currency)}
          </span>
        </span>
        {(showPay || kind === 'GROUP') && (
          <span>
            Продано:{' '}
            <span className="tabular-nums text-slate-200">
              {money(sold, currency)}
            </span>
          </span>
        )}
      </div>
      {footerExtra}
    </div>
  );
}

function RowLinks({
  u,
  canEdit,
  saleDetailLoading,
  onOpenControl,
  onOpenSale,
  onToggleSpaPartner,
}: {
  u: WorkUnit;
  mode: 'admin' | 'super';
  canEdit: boolean;
  saleDetailLoading?: boolean;
  onOpenControl?: (sessionKey: string, day: string) => void;
  onOpenSale?: (unit: WorkUnit) => void;
  onToggleSpaPartner?: (unitId: string, next: string | null) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs">
      {u.sessionKey && onOpenControl ? (
        <button
          type="button"
          className="text-sky-300 hover:underline"
          onClick={() => onOpenControl(u.sessionKey!, unitDayIso(u))}
        >
          Контроль
        </button>
      ) : null}
      {unitCanOpenSale(u) && onOpenSale ? (
        <button
          type="button"
          className="text-sky-300 hover:underline"
          disabled={saleDetailLoading}
          onClick={() => onOpenSale(u)}
        >
          Продажа
        </button>
      ) : null}
      {u.kind === 'SPA' && canEdit && onToggleSpaPartner ? (
        <button
          type="button"
          className={
            u.partnerSource === 'ALLSPORTS'
              ? 'rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300'
              : 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400'
          }
          onClick={() =>
            onToggleSpaPartner(
              u.id,
              u.partnerSource === 'ALLSPORTS' ? null : 'ALLSPORTS',
            )
          }
        >
          {u.partnerSource === 'ALLSPORTS' ? 'AllSports ✓' : 'AllSports'}
        </button>
      ) : null}
    </div>
  );
}
