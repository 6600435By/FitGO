'use client';

import type {
  MembershipEfficiencyReport,
  MembershipProductCatalogRow,
} from '@fitgo/shared-types';
import { MetricCard } from '../metric-card';
import {
  ServicePromiseBlock,
  VisitDistributionBars,
  WaterfallBlock,
} from './blocks';
import { STATUS_DOT, money, moneyOrDash, pct } from './format';

export function OverviewTab({
  report,
  onOpenProduct,
  onOpenClients,
}: {
  report: MembershipEfficiencyReport;
  onOpenProduct: (productExternalId: string) => void;
  onOpenClients: () => void;
}) {
  const currency = report.currency;
  const k = report.kpis;

  return (
    <div className="space-y-4">
      {report.insights.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold">Выводы</h3>
          {report.insights.map((ins, i) => (
            <div
              key={i}
              className={`rounded-xl p-3 text-sm ${
                ins.severity === 'critical'
                  ? 'bg-rose-500/10'
                  : ins.severity === 'success'
                    ? 'bg-emerald-500/10'
                    : ins.severity === 'warning'
                      ? 'bg-amber-500/10'
                      : 'bg-slate-800/50'
              }`}
            >
              <p className="font-medium">{ins.title}</p>
              <p className="text-slate-400">{ins.body}</p>
              {ins.action && <p className="mt-1 text-fitgo-400">{ins.action}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <MetricCard label="Выручка" metric={k.revenueMinor} currency={currency} />
        <MetricCard
          label="Ср. цена абонемента"
          metric={k.avgPaidMinor}
          currency={currency}
        />
        <MetricCard
          label="Доля со скидкой"
          metric={k.soldWithDiscountShare}
          currency={currency}
        />
        <MetricCard
          label="Ср. скидка"
          metric={k.avgDiscountPct}
          currency={currency}
        />
        <MetricCard label="Маржа %" metric={k.marginPct} currency={currency} />
        <MetricCard
          label="Спящие"
          metric={k.sleepingShare}
          currency={currency}
        />
        <MetricCard label="Сгорело" metric={k.burnedMinor} currency={currency} />
        <MetricCard label="ГП / мес" metric={k.avgGpPerMonth} currency={currency} />
        <MetricCard
          label="Тренер на 1 посетителя"
          metric={k.trainerPerVisitMinor}
          currency={currency}
        />
        <MetricCard
          label="Стоимость 1 посещения ГП"
          metric={k.gpCostPerVisitMinor}
          currency={currency}
        />
        <MetricCard
          label="Маржа на 1 посещение"
          metric={k.marginPerVisitMinor}
          currency={currency}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 font-semibold">Куда уходят деньги</h3>
          <WaterfallBlock steps={report.waterfall} currency={currency} />
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold">Обещано / использовано / сгорело</h3>
          <ServicePromiseBlock rows={report.servicePromise} currency={currency} />
        </div>
      </div>

      <FamiliesTable rows={report.families} currency={currency} />

      <div className="grid gap-3 md:grid-cols-2">
        <TopProductsCard
          title="Убыточные абонементы"
          emptyText="Убыточных карточек за период нет."
          rows={report.topLossMaking}
          currency={currency}
          onOpenProduct={onOpenProduct}
        />
        <TopProductsCard
          title="Самые прибыльные абонементы"
          emptyText="Нет данных по прибыльным карточкам."
          rows={report.topProfitable}
          currency={currency}
          onOpenProduct={onOpenProduct}
        />
      </div>

      <div className="card">
        <h3 className="mb-2 font-semibold">Распределение: ГП визитов в месяц</h3>
        {report.breakevenVisits != null && (
          <p className="mb-2 text-xs text-slate-500">
            Порог безубыточности ≈ {report.breakevenVisits} визитов за срок
            абонемента (не в месяц)
          </p>
        )}
        <VisitDistributionBars
          buckets={report.visitDistribution}
          onBucketClick={onOpenClients}
        />
      </div>
    </div>
  );
}

function ProductNameButton({
  row,
  onOpen,
}: {
  row: Pick<MembershipProductCatalogRow, 'productExternalId' | 'name'>;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="text-left text-fitgo-400 hover:underline"
      onClick={() => onOpen(row.productExternalId)}
    >
      {row.name}
    </button>
  );
}

function TopProductsCard({
  title,
  emptyText,
  rows,
  currency,
  onOpenProduct,
}: {
  title: string;
  emptyText: string;
  rows: MembershipProductCatalogRow[];
  currency: string;
  onOpenProduct: (id: string) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Абонемент</th>
              <th className="py-1 pr-2">N</th>
              <th className="py-1 pr-2">Маржа</th>
              <th className="py-1">Маржа %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productExternalId} className="border-t border-slate-800">
                <td className="py-1.5 pr-2">
                  <span
                    className={`mr-1.5 inline-block h-2 w-2 rounded-full ${STATUS_DOT[r.status]}`}
                  />
                  <ProductNameButton row={r} onOpen={onOpenProduct} />
                  {r.groupLabel && (
                    <span className="ml-1 text-[10px] text-slate-500">
                      {r.groupLabel}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2">{r.soldCount}</td>
                <td
                  className={`py-1.5 pr-2 ${
                    r.marginMinor < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {money(r.marginMinor, currency)}
                </td>
                <td className="py-1.5">{pct(r.marginPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FamiliesTable({
  rows,
  currency,
}: {
  rows: MembershipEfficiencyReport['families'];
  currency: string;
}) {
  if (!rows.length) {
    return (
      <div className="card text-sm text-slate-400">
        Нет абонементов выбранных типов за период.
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-2 font-semibold">По типам абонементов</h3>
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-2" title="Тип продукта">
              Тип
            </th>
            <th className="py-1 pr-2">N</th>
            <th className="py-1 pr-2" title="Средний прайс">
              Прайс
            </th>
            <th className="py-1 pr-2" title="Средняя оплата">
              Цена
            </th>
            <th className="py-1 pr-2" title="Средняя скидка от прайса">
              Скидка %
            </th>
            <th className="py-1 pr-2">Мес</th>
            <th className="py-1 pr-2" title="Посещений ГП в месяц">
              ГП/мес
            </th>
            <th className="py-1 pr-2" title="Зал в месяц">
              Зал/мес
            </th>
            <th className="py-1 pr-2" title="Доля доступа ГП / визиты">
              ₽/визит
            </th>
            <th className="py-1 pr-2" title="Начисление тренеру на посетителя">
              Тренер
            </th>
            <th className="py-1 pr-2">Маржа %</th>
            <th className="py-1 pr-2">ПТ %</th>
            <th className="py-1 pr-2">Массаж</th>
            <th className="py-1 pr-2">Соляр.</th>
            <th className="py-1 pr-2">ЛС</th>
            <th
              className="py-1 pr-2"
              title="Визиты, после которых тренер съедает доступ ГП"
            >
              BE
            </th>
            <th className="py-1" title="Цена безубыточности">
              BE цена
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.familyId} className="border-t border-slate-800">
              <td className="py-1.5 pr-2">
                <span
                  className={`mr-1.5 inline-block h-2 w-2 rounded-full ${STATUS_DOT[r.status]}`}
                />
                {r.label}
              </td>
              <td className="py-1.5 pr-2">{r.count}</td>
              <td className="py-1.5 pr-2">
                {moneyOrDash(r.avgRetailMinor, currency)}
              </td>
              <td className="py-1.5 pr-2">{money(r.avgPaidMinor, currency)}</td>
              <td className="py-1.5 pr-2">{pct(r.avgDiscountPct)}</td>
              <td className="py-1.5 pr-2">{r.avgMonths}</td>
              <td className="py-1.5 pr-2">{r.avgGpPerMonth}</td>
              <td className="py-1.5 pr-2">{r.avgGymPerMonth}</td>
              <td className="py-1.5 pr-2">
                {moneyOrDash(r.avgGpCostPerVisitMinor, currency)}
              </td>
              <td className="py-1.5 pr-2">
                {moneyOrDash(r.avgTrainerPerVisitMinor, currency)}
              </td>
              <td className="py-1.5 pr-2">{pct(r.marginPct)}</td>
              <td className="py-1.5 pr-2">{pct(r.ptUsePct)}</td>
              <td className="py-1.5 pr-2">{pct(r.massageUsePct)}</td>
              <td className="py-1.5 pr-2">{pct(r.solariumUsePct)}</td>
              <td className="py-1.5 pr-2">{pct(r.personalAccountUsePct)}</td>
              <td className="py-1.5 pr-2">{r.breakevenVisits ?? '—'}</td>
              <td className="py-1.5">
                {moneyOrDash(r.breakevenPriceMinor, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
