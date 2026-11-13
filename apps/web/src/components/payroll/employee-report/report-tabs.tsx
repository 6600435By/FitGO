'use client';

import { MotivationBreakdownList } from '@/components/payroll/motivation-breakdown-list';
import { AdjustmentsTab } from '@/components/payroll/employee-report/adjustments-tab';
import type { ControlMiss } from '@/components/payroll/employee-report/use-control-misses';
import { WorkUnitsTable } from '@/components/payroll/employee-report/work-units-table';
import {
  attentionFromUnits,
  filterUnitsByKind,
  money,
  sumEarn,
  type AttentionKind,
  type ReportTabId,
} from '@/components/payroll/employee-report/work-unit-status';
import type {
  PayrollAdjustmentDto,
  PayrollPeriodSummary,
  WorkUnit,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { useMemo } from 'react';
import { formatDateTime } from '@/lib/utils';

type Props = {
  summary: PayrollPeriodSummary;
  tab: ReportTabId;
  onTab: (t: ReportTabId) => void;
  attentionFocus?: AttentionKind | null;
  controlMisses: ControlMiss[];
  controlLoading?: boolean;
  bookingControlHref: string;
  mode: 'admin' | 'super';
  canEdit: boolean;
  onOpenControl: (sessionKey: string, day: string) => void;
  onOpenSale: (unit: WorkUnit) => void;
  onToggleSpaPartner: (unitId: string, next: string | null) => void;
  saleDetailLoading?: boolean;
  adjAmount: string;
  adjReason: string;
  editingAdjId: string | null;
  onAdjAmount: (v: string) => void;
  onAdjReason: (v: string) => void;
  onSaveAdj: () => void;
  onCancelEditAdj: () => void;
  onStartEditAdj: (a: PayrollAdjustmentDto) => void;
  onDeleteAdj: (id: string) => void;
};

type TabDef = {
  id: ReportTabId;
  label: string;
  count?: number;
  badge?: string;
  show: boolean;
};

export function ReportTabs({
  summary,
  tab,
  onTab,
  attentionFocus,
  controlMisses,
  controlLoading,
  bookingControlHref,
  mode,
  canEdit,
  onOpenControl,
  onOpenSale,
  onToggleSpaPartner,
  saleDetailLoading,
  adjAmount,
  adjReason,
  editingAdjId,
  onAdjAmount,
  onAdjReason,
  onSaveAdj,
  onCancelEditAdj,
  onStartEditAdj,
  onDeleteAdj,
}: Props) {
  const units = summary.workUnits;
  const cur = summary.currency;
  const reformer = useMemo(
    () => filterUnitsByKind(units, 'REFORMER'),
    [units],
  );
  const pt = useMemo(() => filterUnitsByKind(units, 'PT'), [units]);
  const group = useMemo(() => filterUnitsByKind(units, 'GROUP'), [units]);
  const spa = useMemo(() => filterUnitsByKind(units, 'SPA'), [units]);
  const shift = useMemo(() => filterUnitsByKind(units, 'SHIFT'), [units]);
  const gifts = useMemo(() => filterUnitsByKind(units, 'GIFTS'), [units]);
  const { checkOrExcluded } = useMemo(
    () => attentionFromUnits(units),
    [units],
  );
  // Avoid double-counting rows already listed under «Не прошли контроль».
  const pendingKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of controlMisses) {
      if (m.sessionKey?.trim()) keys.add(m.sessionKey.trim());
    }
    return keys;
  }, [controlMisses]);
  const unitsNeedingCheck = useMemo(
    () =>
      checkOrExcluded.filter(
        (u) => !u.sessionKey?.trim() || !pendingKeys.has(u.sessionKey.trim()),
      ),
    [checkOrExcluded, pendingKeys],
  );

  const attentionCount = controlMisses.length + unitsNeedingCheck.length;
  const adjSum = summary.adjustmentsMinor;
  const reformerGroupCount = reformer.filter((u) => u.kind === 'GROUP').length;
  const reformerPersonalCount = reformer.filter(
    (u) => u.kind === 'PT' || u.isReformerPersonal,
  ).length;

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Обзор', show: true },
    {
      id: 'pt',
      label: 'ПТ',
      count: pt.length,
      badge: pt.length ? money(sumEarn(pt), cur) : undefined,
      // Without reformers — they live on «Реформеры».
      show: pt.length > 0,
    },
    {
      id: 'group',
      label: 'Группы',
      count: group.length,
      badge: group.length ? money(sumEarn(group), cur) : undefined,
      show: group.length > 0,
    },
    {
      id: 'reformer',
      label: 'Реформеры',
      count: reformer.length,
      badge: reformer.length ? money(sumEarn(reformer), cur) : undefined,
      show: reformer.length > 0,
    },
    {
      id: 'spa',
      label: 'SPA',
      count: spa.length,
      badge: spa.length ? money(sumEarn(spa), cur) : undefined,
      show: spa.length > 0,
    },
    {
      id: 'shift',
      label: 'Смены',
      count: shift.length,
      badge: shift.length ? money(sumEarn(shift), cur) : undefined,
      show: shift.length > 0,
    },
    {
      id: 'gifts',
      label: 'Подарки',
      count: gifts.length,
      show: gifts.length > 0,
    },
    {
      id: 'attention',
      label: 'Внимание',
      count: attentionCount || undefined,
      show: attentionCount > 0 || controlLoading === true,
    },
    {
      id: 'adjustments',
      label: 'Корректировки',
      badge:
        adjSum !== 0
          ? money(adjSum, cur)
          : summary.adjustments.length
            ? String(summary.adjustments.length)
            : undefined,
      show: true,
    },
  ];

  const visible = tabs.filter((t) => t.show);
  const active = visible.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className={
              active === t.id
                ? 'shrink-0 rounded-lg bg-fitgo-500/20 px-2.5 py-1.5 text-xs font-medium text-fitgo-200 ring-1 ring-fitgo-500/40'
                : 'shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }
          >
            {t.label}
            {t.count != null ? (
              <span className="ml-1 tabular-nums text-slate-500">{t.count}</span>
            ) : null}
            {t.badge && t.count == null ? (
              <span className="ml-1 tabular-nums text-slate-500">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {active === 'overview' ? (
        <OverviewTab
          summary={summary}
          pt={pt}
          group={group}
          reformer={reformer}
          spa={spa}
          shift={shift}
          gifts={gifts}
          onOpenTab={onTab}
        />
      ) : null}

      {active === 'pt' ? (
        <div className="space-y-2">
          {summary.ptStats ? (
            <MiniStats
              items={[
                { label: 'ПТ за период', value: String(summary.ptStats.sessionCount) },
                { label: '% по шкале', value: `${summary.ptStats.percent}%` },
                { label: 'Начислено', value: money(sumEarn(pt), cur) },
                { label: 'Продано', value: money(sumSoldSafe(pt), cur) },
              ]}
            />
          ) : null}
          <WorkUnitsTable
            units={pt}
            kind="PT"
            currency={cur}
            mode={mode}
            canEdit={canEdit}
            onOpenControl={onOpenControl}
            onOpenSale={onOpenSale}
            saleDetailLoading={saleDetailLoading}
          />
        </div>
      ) : null}

      {active === 'group' ? (
        <div className="space-y-2">
          {group.length > 0 || summary.groupStats ? (
            <MiniStats
              items={[
                {
                  label: 'Занятий',
                  value: String(
                    group.length || summary.groupStats?.classCount || 0,
                  ),
                },
                {
                  label: 'Среднее людей',
                  value: (
                    group.length
                      ? group.reduce((a, u) => a + u.quantity, 0) / group.length
                      : (summary.groupStats?.avgPeople ?? 0)
                  ).toLocaleString('ru-RU', { maximumFractionDigits: 1 }),
                },
                { label: 'Начислено', value: money(sumEarn(group), cur) },
              ]}
            />
          ) : null}
          <WorkUnitsTable
            units={group}
            kind="GROUP"
            currency={cur}
            mode={mode}
            canEdit={canEdit}
            onOpenControl={onOpenControl}
            onOpenSale={onOpenSale}
            saleDetailLoading={saleDetailLoading}
          />
        </div>
      ) : null}

      {active === 'reformer' ? (
        <div className="space-y-2">
          <MiniStats
            items={[
              { label: 'Всего', value: String(reformer.length) },
              { label: 'Групповые', value: String(reformerGroupCount) },
              {
                label: 'Индивидуальные',
                value: String(reformerPersonalCount),
              },
              { label: 'Начислено', value: money(sumEarn(reformer), cur) },
            ]}
          />
          <WorkUnitsTable
            units={reformer}
            kind="MIXED"
            currency={cur}
            mode={mode}
            canEdit={canEdit}
            onOpenControl={onOpenControl}
            onOpenSale={onOpenSale}
            saleDetailLoading={saleDetailLoading}
          />
        </div>
      ) : null}

      {active === 'spa' ? (
        <WorkUnitsTable
          units={spa}
          kind="SPA"
          currency={cur}
          mode={mode}
          canEdit={canEdit}
          onOpenControl={onOpenControl}
          onOpenSale={onOpenSale}
          onToggleSpaPartner={onToggleSpaPartner}
          saleDetailLoading={saleDetailLoading}
        />
      ) : null}

      {active === 'shift' ? (
        <WorkUnitsTable
          units={shift}
          kind="SHIFT"
          currency={cur}
          mode={mode}
          canEdit={canEdit}
        />
      ) : null}

      {active === 'gifts' ? (
        <WorkUnitsTable
          units={gifts}
          kind="GIFTS"
          currency={cur}
          mode={mode}
          canEdit={canEdit}
          onOpenControl={onOpenControl}
          onOpenSale={onOpenSale}
          saleDetailLoading={saleDetailLoading}
        />
      ) : null}

      {active === 'attention' ? (
        <AttentionTab
          units={filterAttentionUnits(unitsNeedingCheck, attentionFocus)}
          misses={
            attentionFocus === 'excluded' ||
            attentionFocus === 'noEarn' ||
            attentionFocus === 'catalog'
              ? []
              : controlMisses
          }
          controlLoading={controlLoading}
          bookingControlHref={bookingControlHref}
          currency={cur}
          mode={mode}
          canEdit={canEdit}
          onOpenControl={onOpenControl}
          onOpenSale={onOpenSale}
          onToggleSpaPartner={onToggleSpaPartner}
          saleDetailLoading={saleDetailLoading}
        />
      ) : null}

      {active === 'adjustments' ? (
        <AdjustmentsTab
          canEdit={canEdit}
          currency={cur}
          adjustments={summary.adjustments}
          adjAmount={adjAmount}
          adjReason={adjReason}
          editingAdjId={editingAdjId}
          onAmount={onAdjAmount}
          onReason={onAdjReason}
          onSave={onSaveAdj}
          onCancelEdit={onCancelEditAdj}
          onStartEdit={onStartEditAdj}
          onDelete={onDeleteAdj}
        />
      ) : null}
    </div>
  );
}

function sumSoldSafe(units: WorkUnit[]) {
  let n = 0;
  for (const u of units) {
    if (
      (u.kind === 'SPA' || u.kind === 'PT') &&
      u.priceMinor != null &&
      u.priceMinor > 0 &&
      u.payrollTrusted &&
      !u.isComplimentary
    ) {
      n += u.priceMinor;
    }
  }
  return n;
}

function filterAttentionUnits(
  units: WorkUnit[],
  focus?: AttentionKind | null,
): WorkUnit[] {
  if (!focus || focus === 'controlMiss' || focus === 'anomaly') return units;
  if (focus === 'excluded') return units.filter((u) => !u.payrollTrusted);
  if (focus === 'catalog') {
    return units.filter((u) => u.spaBlockPriceSource === 'CATALOG');
  }
  if (focus === 'noEarn') {
    return units.filter((u) => {
      const pay = u.kind === 'PT' || u.kind === 'SPA' || u.kind === 'GROUP';
      return (
        pay &&
        u.payrollTrusted &&
        !u.isComplimentary &&
        (u.priceMinor ?? 0) > 0 &&
        (u.earnMinor == null || u.earnMinor === 0)
      );
    });
  }
  return units;
}

function OverviewTab({
  summary,
  pt,
  group,
  reformer,
  spa,
  shift,
  gifts,
  onOpenTab,
}: {
  summary: PayrollPeriodSummary;
  pt: WorkUnit[];
  group: WorkUnit[];
  reformer: WorkUnit[];
  spa: WorkUnit[];
  shift: WorkUnit[];
  gifts: WorkUnit[];
  onOpenTab: (t: ReportTabId) => void;
}) {
  const cur = summary.currency;
  const motivationBreakdownVisible =
    summary.motivationBreakdown != null &&
    (summary.motivationBreakdown.membershipMinor > 0 ||
      summary.motivationBreakdown.spaMinor > 0 ||
      summary.motivationBreakdown.solariumMinor > 0 ||
      summary.motivationBreakdown.shopMinor > 0 ||
      summary.motivationBreakdown.corporateMinor > 0);

  const reformerGroup = reformer.filter((u) => u.kind === 'GROUP').length;
  const reformerPersonal = reformer.filter(
    (u) => u.kind === 'PT' || u.isReformerPersonal,
  ).length;

  const cards: {
    id: ReportTabId;
    title: string;
    lines: string[];
    show: boolean;
  }[] = [
    {
      id: 'pt',
      title: 'ПТ',
      show: pt.length > 0,
      lines: [
        `${pt.length} сессий`,
        summary.ptStats ? `${summary.ptStats.percent}% по шкале` : '',
        money(sumEarn(pt), cur),
      ].filter(Boolean),
    },
    {
      id: 'group',
      title: 'Группы',
      show: group.length > 0,
      lines: [
        `${group.length} занятий`,
        `ср. ${(group.reduce((a, u) => a + u.quantity, 0) / group.length).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} чел.`,
        money(sumEarn(group), cur),
      ],
    },
    {
      id: 'reformer',
      title: 'Реформеры',
      show: reformer.length > 0,
      lines: [
        `${reformer.length} занятий`,
        `гр. ${reformerGroup} · инд. ${reformerPersonal}`,
        money(sumEarn(reformer), cur),
      ],
    },
    {
      id: 'spa',
      title: 'SPA',
      show: spa.length > 0,
      lines: [`${spa.length} услуг`, money(sumEarn(spa), cur)],
    },
    {
      id: 'shift',
      title: 'Смены',
      show: shift.length > 0,
      lines: [
        `${shift.reduce((a, u) => a + u.quantity, 0)} ч`,
        money(sumEarn(shift), cur),
      ],
    },
    {
      id: 'gifts',
      title: 'Подарки',
      show: gifts.length > 0,
      lines: [`${gifts.length} ПТ`],
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {cards
          .filter((c) => c.show)
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpenTab(c.id)}
              className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-left transition hover:border-slate-700 hover:bg-slate-900/60"
            >
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {c.title}
              </p>
              {c.lines.map((line) => (
                <p
                  key={line}
                  className="mt-0.5 text-sm tabular-nums text-slate-200"
                >
                  {line}
                </p>
              ))}
            </button>
          ))}
      </div>

      {motivationBreakdownVisible && summary.motivationBreakdown ? (
        <section className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Из чего мотивация
          </p>
          <MotivationBreakdownList
            breakdown={summary.motivationBreakdown}
            sales={summary.sales}
            currency={cur}
          />
        </section>
      ) : null}

      {cards.every((c) => !c.show) && !motivationBreakdownVisible ? (
        <p className="text-sm text-slate-500">
          Нет работ за период. Проверьте даты или обновите из 1С.
        </p>
      ) : null}
    </div>
  );
}

function MiniStats({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-2"
        >
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            {it.label}
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function AttentionTab({
  units,
  misses,
  controlLoading,
  bookingControlHref,
  currency,
  mode,
  canEdit,
  onOpenControl,
  onOpenSale,
  onToggleSpaPartner,
  saleDetailLoading,
}: {
  units: WorkUnit[];
  misses: ControlMiss[];
  controlLoading?: boolean;
  bookingControlHref: string;
  currency: string;
  mode: 'admin' | 'super';
  canEdit: boolean;
  onOpenControl: (sessionKey: string, day: string) => void;
  onOpenSale: (unit: WorkUnit) => void;
  onToggleSpaPartner: (unitId: string, next: string | null) => void;
  saleDetailLoading?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Строки, которые стоит проверить перед выплатой
        </p>
        <Link
          href={bookingControlHref}
          className="text-xs text-sky-300 hover:underline"
        >
          Весь контроль за период →
        </Link>
      </div>

      {misses.length > 0 || controlLoading ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-amber-200/80">
            Не прошли контроль ({misses.length})
          </h3>
          {controlLoading ? (
            <p className="text-sm text-slate-500">Загрузка…</p>
          ) : (
            <ul className="space-y-1.5">
              {misses.map((m) => (
                <li
                  key={m.sessionKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-100">{m.title}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(m.startAt)}
                      {m.clientName ? ` · ${m.clientName}` : ''}
                      {m.roomTitle ? ` · ${m.roomTitle}` : ''}
                      <span className="ml-1 uppercase text-slate-600">
                        · {m.kind}
                      </span>
                    </p>
                    {m.approvalLabel ? (
                      <p className="text-[11px] text-amber-200/80">
                        {m.approvalLabel}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary shrink-0 px-2.5 py-1 text-xs"
                    onClick={() =>
                      onOpenControl(m.sessionKey, m.startAt.slice(0, 10))
                    }
                  >
                    Открыть контроль
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {units.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            В расчёте, но требуют проверки ({units.length})
          </h3>
          <WorkUnitsTable
            units={units}
            kind="MIXED"
            currency={currency}
            mode={mode}
            canEdit={canEdit}
            onOpenControl={onOpenControl}
            onOpenSale={onOpenSale}
            onToggleSpaPartner={onToggleSpaPartner}
            saleDetailLoading={saleDetailLoading}
          />
        </section>
      ) : null}

      {!controlLoading && misses.length === 0 && units.length === 0 ? (
        <p className="text-sm text-slate-500">Нечего проверять</p>
      ) : null}
    </div>
  );
}
