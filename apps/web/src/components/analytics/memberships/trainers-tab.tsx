'use client';

import type { MembershipTrainersReport } from '@fitgo/shared-types';
import { Fragment, useState } from 'react';
import { money } from './format';

export function TrainersTab({ report }: { report: MembershipTrainersReport }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const currency = report.currency;

  if (!report.trainers.length) {
    return (
      <div className="card text-sm text-slate-400">
        Нет занятий ГП с абонементными посещениями за период.
      </div>
    );
  }
  return (
    <div className="card space-y-2 overflow-x-auto">
      <h3 className="font-semibold">Тренеры и занятия</h3>
      <p className="text-xs text-slate-500">
        Экон. выручка = сумма стоимости визита абонементных клиентов (+ unit
        price остальных). Маржа = выручка − начисление тренеру.
      </p>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-2">Тренер</th>
            <th className="py-1 pr-2">Занятий</th>
            <th className="py-1 pr-2">Ср. людей</th>
            <th className="py-1 pr-2">Fill %</th>
            <th className="py-1 pr-2">Начисление</th>
            <th className="py-1 pr-2">Экон. выручка</th>
            <th className="py-1 pr-2">Маржа</th>
            <th className="py-1">Ниже BE</th>
          </tr>
        </thead>
        <tbody>
          {report.trainers.map((t) => (
            <Fragment key={t.trainerId}>
              <tr
                className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40"
                onClick={() =>
                  setExpanded((cur) => (cur === t.trainerId ? null : t.trainerId))
                }
              >
                <td className="py-1.5 pr-2">{t.name}</td>
                <td className="py-1.5 pr-2">{t.sessions}</td>
                <td className="py-1.5 pr-2">{t.avgAttended}</td>
                <td className="py-1.5 pr-2">
                  {t.avgFillPct != null ? `${t.avgFillPct}%` : '—'}
                </td>
                <td className="py-1.5 pr-2">{money(t.earnMinor, currency)}</td>
                <td className="py-1.5 pr-2">
                  {money(t.economicRevenueMinor, currency)}
                </td>
                <td
                  className={`py-1.5 pr-2 ${
                    t.marginMinor < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {money(t.marginMinor, currency)}
                </td>
                <td className="py-1.5">
                  {t.belowBreakevenShare != null
                    ? `${t.belowBreakevenShare}%`
                    : '—'}
                </td>
              </tr>
              {expanded === t.trainerId &&
                t.classes.map((c) => (
                  <tr
                    key={`${t.trainerId}-${c.title}`}
                    className="bg-slate-900/40 text-xs text-slate-400"
                  >
                    <td className="py-1 pl-4 pr-2" colSpan={2}>
                      {c.title}
                      {c.belowBreakeven && (
                        <span
                          className="ml-2 text-amber-400"
                          title={
                            c.minPeopleForBreakeven != null
                              ? `Нужно минимум ~${c.minPeopleForBreakeven} чел.`
                              : 'Ниже безубыточности'
                          }
                        >
                          ниже BE
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">{c.sessions}</td>
                    <td className="py-1 pr-2">{c.avgAttended}</td>
                    <td className="py-1 pr-2">{money(c.earnMinor, currency)}</td>
                    <td className="py-1 pr-2">
                      {money(c.economicRevenueMinor, currency)}
                    </td>
                    <td className="py-1 pr-2">{money(c.marginMinor, currency)}</td>
                    <td className="py-1">
                      {c.marginPerPersonMinor != null
                        ? money(c.marginPerPersonMinor, currency)
                        : '—'}
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
