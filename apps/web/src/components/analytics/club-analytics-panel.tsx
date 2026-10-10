'use client';

import type { ClubAnalyticsReport } from '@fitgo/shared-types';
import { MetricCard } from './metric-card';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  })}\u00a0${currency}`;
}

export function ClubAnalyticsPanel({
  report,
  showPay,
}: {
  report: ClubAnalyticsReport;
  showPay: boolean;
}) {
  const { money: m, members, visits, services, currency } = report;
  const heatMax = Math.max(1, ...report.visits.heatmap.flat());

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
          <MetricCard label="Выручка" metric={m.revenue} currency={currency} />
          <MetricCard
            label="Средний чек"
            metric={m.avgCheck}
            currency={currency}
          />
          <MetricCard
            label="Возвраты"
            metric={m.refunds}
            currency={currency}
          />
          <MetricCard
            label="Дебиторка"
            metric={m.debtOutstanding}
            currency={currency}
          />
        </div>
        <div className="card mt-3">
          <p className="mb-2 text-sm font-medium">По способу оплаты</p>
          <ul className="space-y-1 text-sm text-slate-300">
            <li className="flex justify-between">
              <span>Наличные</span>
              <span>{money(m.byPayment.cashMinor, currency)}</span>
            </li>
            <li className="flex justify-between">
              <span>Карта</span>
              <span>{money(m.byPayment.cardMinor, currency)}</span>
            </li>
            <li className="flex justify-between">
              <span>Безнал</span>
              <span>{money(m.byPayment.cashlessMinor, currency)}</span>
            </li>
            <li className="flex justify-between">
              <span>ЛС</span>
              <span>{money(m.byPayment.personalAccountMinor, currency)}</span>
            </li>
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
                  <span>{s.label}</span>
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
          <div className="min-w-[480px]">
            <div className="mb-1 grid grid-cols-[32px_repeat(24,minmax(0,1fr))] gap-0.5 text-[9px] text-slate-500">
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="text-center">
                  {h}
                </span>
              ))}
            </div>
            {visits.heatmap.map((row, di) => (
              <div
                key={di}
                className="mb-0.5 grid grid-cols-[32px_repeat(24,minmax(0,1fr))] gap-0.5"
              >
                <span className="text-[10px] text-slate-400">
                  {WEEKDAYS[di]}
                </span>
                {row.map((v, hi) => {
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
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Услуги</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCard label="ГП занятий" metric={services.group.sessions} />
          <MetricCard
            label="ГП заполняемость"
            metric={services.group.avgFillPct}
          />
          <MetricCard label="ПТ проведено" metric={services.pt.completed} />
          <MetricCard
            label="ПТ доля подарочных"
            metric={services.pt.giftSharePct}
          />
          <MetricCard label="SPA оказано" metric={services.spa.completed} />
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
        <div className="card">
          <h3 className="mb-3 font-semibold">Рейтинг тренеров ПТ</h3>
          <ul className="space-y-2">
            {report.trainerRankings.map((t, i) => (
              <li key={t.trainerId} className="flex justify-between text-sm">
                <span>
                  {i + 1}. {t.name}
                </span>
                <span className="text-slate-400">
                  score {t.score} · ПТ {t.completedPt}
                </span>
              </li>
            ))}
          </ul>
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
