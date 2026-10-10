'use client';

import type { ClubAnalyticsReport } from '@fitgo/shared-types';
import Link from 'next/link';
import { MetricCard } from './metric-card';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  })}\u00a0${currency}`;
}

function salesHref(
  from: string,
  to: string,
  extra: Record<string, string | undefined>,
) {
  const q = new URLSearchParams({ from, to });
  for (const [k, v] of Object.entries(extra)) {
    if (v) q.set(k, v);
  }
  return `/super-admin/sales?${q.toString()}`;
}

function controlHref(
  from: string,
  to: string,
  extra: Record<string, string | undefined>,
) {
  const q = new URLSearchParams({ from, to });
  for (const [k, v] of Object.entries(extra)) {
    if (v) q.set(k, v);
  }
  return `/super-admin/review-queue?${q.toString()}`;
}

export function ClubAnalyticsPanel({
  report,
  showPay,
}: {
  report: ClubAnalyticsReport;
  showPay: boolean;
}) {
  const { money: m, members, visits, services, currency, from, to } = report;
  const heatMax = Math.max(1, ...report.visits.heatmap.flat());
  const hourFrom = visits.heatmapHours?.from ?? 0;
  const hourTo = visits.heatmapHours?.to ?? 23;
  const hours = Array.from(
    { length: hourTo - hourFrom + 1 },
    (_, i) => hourFrom + i,
  );
  const days =
    visits.heatmapDays?.length > 0
      ? visits.heatmapDays
      : [0, 1, 2, 3, 4, 5, 6];
  const colTemplate = `32px repeat(${hours.length}, minmax(0, 1fr))`;

  return (
    <div className="space-y-4">
      {report.dataSince && (
        <p className="text-xs text-slate-500">
          История продаж / выручки с {report.dataSince}. Сравнение:{' '}
          {report.compareFrom} — {report.compareTo}
        </p>
      )}

      {report.insights.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold">Инсайты</h3>
          {report.insights.map((ins, i) => (
            <div
              key={i}
              className={`rounded-xl p-3 text-sm ${
                ins.severity === 'critical'
                  ? 'bg-rose-500/10'
                  : ins.severity === 'success'
                    ? 'bg-emerald-500/10'
                    : 'bg-slate-800/50'
              }`}
            >
              <p className="font-medium">{ins.title}</p>
              <p className="text-slate-400">{ins.body}</p>
              {ins.action && (
                <p className="mt-1 text-fitgo-400">{ins.action}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Деньги</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCard
            label="Выручка"
            metric={m.revenue}
            currency={currency}
            href={salesHref(from, to, { op: 'payment' })}
          />
          <MetricCard
            label="Средний чек"
            metric={m.avgCheck}
            currency={currency}
            href={salesHref(from, to, { op: 'payment' })}
          />
          <MetricCard
            label="Возвраты"
            metric={m.refunds}
            currency={currency}
            href={salesHref(from, to, { op: 'refund' })}
          />
          <MetricCard
            label="Дебиторка"
            metric={m.debtOutstanding}
            currency={currency}
            href={salesHref(from, to, { op: 'unpaid' })}
          />
        </div>
        {m.debtBreakdown && (
          <div className="card mt-3">
            <p className="mb-2 text-sm font-medium">Дебиторка — расшифровка</p>
            <ul className="space-y-1 text-sm text-slate-300">
              <li className="flex justify-between gap-3">
                <Link
                  href={salesHref(from, to, { op: 'unpaid', debtor: 'client' })}
                  className="text-fitgo-400 hover:underline"
                >
                  Клиенты
                </Link>
                <span>{money(m.debtBreakdown.clientsMinor, currency)}</span>
              </li>
              <li className="flex justify-between gap-3">
                <Link
                  href={salesHref(from, to, { op: 'unpaid', debtor: 'staff' })}
                  className="text-fitgo-400 hover:underline"
                >
                  Сотрудники
                </Link>
                <span>{money(m.debtBreakdown.staffMinor, currency)}</span>
              </li>
            </ul>
          </div>
        )}
        {m.installments && (
          <div className="card mt-3">
            <p className="mb-2 text-sm font-medium">Рассрочки</p>
            <ul className="space-y-1 text-sm text-slate-300">
              <li className="flex justify-between gap-3">
                <span>К оплате в этом месяце</span>
                <span>
                  {money(m.installments.dueThisMonthMinor, currency)}
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span>Продано в рассрочку</span>
                <span>
                  {money(m.installments.soldTotalMinor, currency)}
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span>Просрочено</span>
                <span>
                  {money(m.installments.overdueMinor, currency)}
                </span>
              </li>
            </ul>
          </div>
        )}
        <div className="card mt-3">
          <p className="mb-2 text-sm font-medium">По способу оплаты</p>
          <ul className="space-y-1 text-sm text-slate-300">
            {(
              [
                ['Наличные', 'cash', m.byPayment.cashMinor],
                ['Карта', 'card', m.byPayment.cardMinor],
                ['Безнал', 'cashless', m.byPayment.cashlessMinor],
                ['ЛС', 'personalAccount', m.byPayment.personalAccountMinor],
              ] as const
            ).map(([label, payment, amount]) => (
              <li key={payment} className="flex justify-between">
                <Link
                  href={salesHref(from, to, { op: 'payment', payment })}
                  className="text-fitgo-400 hover:underline"
                >
                  {label}
                </Link>
                <span>{money(amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between">
              <span>Корпо</span>
              <span>{money(m.byPayment.corpoMinor, currency)}</span>
            </li>
            {m.byPayment.otherMinor > 0 && (
              <li className="flex justify-between">
                <span>Прочее</span>
                <span>{money(m.byPayment.otherMinor, currency)}</span>
              </li>
            )}
          </ul>
        </div>
        <div className="card mt-3">
          <p className="mb-2 text-sm font-medium">По сегментам</p>
          <ul className="space-y-2">
            {m.bySegment.map((s) => (
              <li key={s.key} className="text-sm">
                <div className="flex justify-between">
                  <Link
                    href={salesHref(from, to, {
                      op: 'payment',
                      segment: s.key,
                    })}
                    className="text-fitgo-400 hover:underline"
                  >
                    {s.label}
                  </Link>
                  <span className="text-slate-400">
                    {money(s.amountMinor, currency)} ·{' '}
                    {Math.round(s.share * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-fitgo-500"
                    style={{ width: `${Math.round(s.share * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">
          Клиентская база
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Активные абонементы" metric={members.active} />
          <MetricCard label="Новые клиенты" metric={members.newClients} />
          <MetricCard label="Продления" metric={members.renewals} />
          <MetricCard label="% продлений" metric={members.renewalRate} />
          <MetricCard label="Отток" metric={members.churn} />
          <MetricCard label="Заморозки" metric={members.frozen} />
          <MetricCard label="Истекают 7 дн." metric={members.expiring7} />
          <MetricCard label="Истекают 30 дн." metric={members.expiring30} />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">
          Посещаемость
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Визиты" metric={visits.total} />
          <MetricCard label="Уникальные" metric={visits.uniqueClients} />
          <MetricCard
            label="Визитов / абонемент"
            metric={visits.avgPerActiveMembership}
          />
          <MetricCard label="Спящие 14+ дн." metric={visits.sleeping} />
        </div>
        <div className="card mt-3 overflow-x-auto">
          <p className="mb-2 text-sm font-medium">Загрузка по дням / часам</p>
          <div className="min-w-[320px]">
            <div
              className="mb-1 grid gap-0.5 text-[9px] text-slate-500"
              style={{ gridTemplateColumns: colTemplate }}
            >
              <span />
              {hours.map((h) => (
                <span key={h} className="text-center">
                  {h}
                </span>
              ))}
            </div>
            {days.map((di) => {
              const row = visits.heatmap[di] ?? [];
              return (
                <div
                  key={di}
                  className="mb-0.5 grid gap-0.5"
                  style={{ gridTemplateColumns: colTemplate }}
                >
                  <span className="text-[10px] text-slate-400">
                    {WEEKDAYS[di]}
                  </span>
                  {hours.map((hi) => {
                    const v = row[hi] ?? 0;
                    const intensity = v / heatMax;
                    return (
                      <div
                        key={hi}
                        title={`${WEEKDAYS[di]} ${hi}:00 — ${v}`}
                        className="h-3 rounded-sm"
                        style={{
                          backgroundColor: `rgba(20, 184, 138, ${0.08 + intensity * 0.92})`,
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Услуги</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCard
            label="ГП занятий"
            metric={services.group.sessions}
            href={controlHref(from, to, {
              kind: 'GROUP',
              status: 'COMPLETED',
            })}
          />
          <MetricCard
            label="ГП заполняемость"
            metric={services.group.avgFillPct}
          />
          <MetricCard
            label="ПТ проведено"
            metric={services.pt.completed}
            href={controlHref(from, to, { kind: 'PT', status: 'COMPLETED' })}
          />
          <MetricCard
            label="ПТ доля подарочных"
            metric={services.pt.giftSharePct}
            href={controlHref(from, to, {
              kind: 'PT',
              status: 'COMPLETED',
              payment: 'GIFT',
            })}
          />
          <MetricCard
            label="SPA оказано"
            metric={services.spa.completed}
            href={controlHref(from, to, { kind: 'SPA', status: 'COMPLETED' })}
          />
        </div>
        <div className="card mt-3 text-sm text-slate-300">
          SPA: абонемент {services.spa.quota} · оплата {services.spa.paid} ·
          Allsports {services.spa.allsports}
        </div>
        {services.group.topDirections.length > 0 && (
          <div className="card mt-3">
            <p className="mb-2 text-sm font-medium">Топ направлений ГП</p>
            <ul className="space-y-1 text-sm">
              {services.group.topDirections.map((d) => (
                <li key={d.title} className="flex justify-between">
                  <span>{d.title}</span>
                  <span className="text-slate-400">
                    {d.sessions} · ср. {d.avgAttended} · {d.fillPct}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {showPay && report.fot && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-300">ФОТ</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="ФОТ"
              metric={report.fot.fotMinor}
              currency={currency}
            />
            <MetricCard
              label="ФОТ / выручка"
              metric={report.fot.fotShareOfRevenuePct}
            />
            <MetricCard
              label="Выручка / сотрудник"
              metric={report.fot.revenuePerStaffMinor}
              currency={currency}
            />
          </div>
        </section>
      )}

      {report.trainerRankings.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="mb-3 font-semibold">Рейтинг тренеров ПТ</h3>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="pb-2 pr-2">Тренер</th>
                <th className="pb-2 pr-2 text-right">Проведено</th>
                <th className="pb-2 pr-2 text-right">Оплачено</th>
                <th className="pb-2 pr-2 text-right">Не оплачено</th>
                <th className="pb-2 pr-2 text-right">Клиентов</th>
                <th className="pb-2 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {report.trainerRankings.map((t, i) => (
                <tr key={t.trainerId} className="border-t border-slate-800">
                  <td className="py-2 pr-2">
                    <Link
                      href={controlHref(from, to, {
                        kind: 'PT',
                        performerId: t.trainerId,
                      })}
                      className="text-fitgo-400 hover:underline"
                    >
                      {i + 1}. {t.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-right">{t.completedPt}</td>
                  <td className="py-2 pr-2 text-right">
                    <Link
                      href={controlHref(from, to, {
                        kind: 'PT',
                        performerId: t.trainerId,
                        payment: 'PAID',
                      })}
                      className="text-fitgo-400 hover:underline"
                    >
                      {t.paidPt}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <Link
                      href={controlHref(from, to, {
                        kind: 'PT',
                        performerId: t.trainerId,
                        payment: 'DEBT',
                      })}
                      className="text-fitgo-400 hover:underline"
                    >
                      {t.debtPt}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-right">{t.activeClients}</td>
                  <td className="py-2 text-right text-slate-400">
                    {money(t.amountMinor, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card text-sm text-slate-400">
        Интеграция: {report.integrationHealth?.provider ?? 'mock'}
        {report.integrationHealth?.clubExternalId &&
          ` · ${report.integrationHealth.clubExternalId}`}
      </div>
    </div>
  );
}
