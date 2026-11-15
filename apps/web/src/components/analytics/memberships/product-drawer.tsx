'use client';

import {
  computeMembershipWhatIf,
  type MembershipCostBreakdown,
  type MembershipEconomicsSettings,
  type MembershipEfficiencyBasis,
  type MembershipPayrollHints,
  type MembershipProductDetail,
  type MembershipWhatIfInput,
} from '@fitgo/shared-types';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  ServicePromiseBlock,
  VisitDistributionBars,
  WaterfallBlock,
} from './blocks';
import { PriceScaleBar } from './catalog-tab';
import { Badge, Slider, Toggle } from './fields';
import {
  STATUS_DOT,
  errMessage,
  money,
  moneyOrDash,
  num,
  pct,
} from './format';
import { PROFILE_FIELD_LABEL, ProfileForm } from './profile-form';

interface WhatIfState {
  paidMinor: number;
  gpPerWeek: number;
  commissionPct: number;
  quotaUsagePct: number;
  includeFixed: boolean;
}

const WEEKS_PER_MONTH = 52 / 12;

function initWhatIf(
  d: MembershipProductDetail,
  settings: MembershipEconomicsSettings,
  hints: MembershipPayrollHints,
): WhatIfState {
  const p = d.product;
  const uses = [p.ptUsePct, p.massageUsePct, p.solariumUsePct].filter(
    (v): v is number => v != null,
  );
  return {
    paidMinor: p.avgPaidMinor,
    gpPerWeek: Math.round((p.avgGpPerMonth / WEEKS_PER_MONTH) * 10) / 10,
    commissionPct:
      settings.salesCommissionPctOverride ??
      hints.combinedSalesCommissionPct ??
      0,
    quotaUsagePct: uses.length
      ? Math.round(uses.reduce((a, b) => a + b, 0) / uses.length)
      : 100,
    includeFixed: false,
  };
}

function buildInput(
  d: MembershipProductDetail,
  settings: MembershipEconomicsSettings,
  hints: MembershipPayrollHints,
  wi: WhatIfState,
): MembershipWhatIfInput {
  const p = d.product;
  const profile = d.profile;
  const months = Math.max(0.1, p.avgMonths || profile?.termMonths || 1);
  const usage = wi.quotaUsagePct / 100;
  return {
    retailPriceMinor: d.retailPriceMinor ?? p.retailPriceMinor ?? p.avgPaidMinor,
    paidMinor: wi.paidMinor,
    months,
    salesCommissionPct: wi.commissionPct,
    acquiringPct: settings.acquiringPct,
    taxPct: settings.taxPct,
    gpVisits: wi.gpPerWeek * WEEKS_PER_MONTH * months,
    gymVisits: p.avgGymPerMonth * months,
    avgTrainerPerVisitMinor:
      d.gpTrainer.avgPerVisitMinor ?? p.avgTrainerPerVisitMinor ?? 0,
    ptUsed: (profile?.ptIncluded ?? 0) * usage,
    ptCostMinor: settings.ptGiftCostMinor ?? hints.ptGiftRateMinor ?? 0,
    massageUsed: (profile?.massageIncluded ?? 0) * usage,
    massageCostMinor: settings.massageCostMinor ?? hints.spaMassageRateMinor ?? 0,
    bodyCompositionUsed: (profile?.bodyCompositionIncluded ?? 0) * usage,
    bodyCompositionCostMinor:
      settings.bodyCompositionCostMinor ?? hints.spaBodyCompositionRateMinor ?? 0,
    solariumMinutesUsed: (profile?.solariumMinutes ?? 0) * usage,
    solariumMinuteCostMinor: settings.solariumMinuteCostMinor ?? 0,
    personalAccountSpentMinor: (profile?.personalAccountCreditMinor ?? 0) * usage,
    personalAccountCogsShare: settings.personalAccountCogsShare,
    overheadPerVisitMinor:
      settings.gymVisitVariableCostMinor > 0
        ? settings.gymVisitVariableCostMinor
        : settings.overheadPerVisitMinor,
    fixedOverheadPerMemberMonthMinor: settings.fixedOverheadPerMemberMonthMinor,
    includeFixedOverhead: wi.includeFixed,
  };
}

const COST_ROWS: Array<[keyof MembershipCostBreakdown, string]> = [
  ['salesCommissionMinor', 'Комиссия с продаж'],
  ['acquiringMinor', 'Эквайринг'],
  ['taxMinor', 'Налог'],
  ['trainerMinor', 'Тренеры ГП'],
  ['ptMinor', 'ПТ (подарок)'],
  ['massageMinor', 'Массаж'],
  ['bodyCompositionMinor', 'Анализ состава'],
  ['solariumMinor', 'Солярий'],
  ['personalAccountCogsMinor', 'Себестоимость ЛС'],
  ['overheadMinor', 'Накладные на визит'],
  ['fixedOverheadMinor', 'Фикс. накладные'],
];

const COMPOSITION_ITEMS: Array<{
  key: string;
  label: string;
  value: (d: MembershipProductDetail, currency: string) => string;
}> = [
  {
    key: 'termMonths',
    label: PROFILE_FIELD_LABEL.termMonths,
    value: (d) => String(d.profile?.termMonths ?? d.product.avgMonths),
  },
  {
    key: 'accessGp',
    label: PROFILE_FIELD_LABEL.accessGp,
    value: (d) => (d.profile ? (d.profile.accessGp ? 'да' : 'нет') : '—'),
  },
  {
    key: 'accessGym',
    label: PROFILE_FIELD_LABEL.accessGym,
    value: (d) => (d.profile ? (d.profile.accessGym ? 'да' : 'нет') : '—'),
  },
  {
    key: 'gpVisitsLimit',
    label: PROFILE_FIELD_LABEL.gpVisitsLimit,
    value: (d) =>
      d.profile
        ? d.profile.gpVisitsLimit == null
          ? 'безлимит'
          : String(d.profile.gpVisitsLimit)
        : '—',
  },
  {
    key: 'ptIncluded',
    label: PROFILE_FIELD_LABEL.ptIncluded,
    value: (d) => String(d.profile?.ptIncluded ?? '—'),
  },
  {
    key: 'massageIncluded',
    label: PROFILE_FIELD_LABEL.massageIncluded,
    value: (d) => String(d.profile?.massageIncluded ?? '—'),
  },
  {
    key: 'bodyCompositionIncluded',
    label: PROFILE_FIELD_LABEL.bodyCompositionIncluded,
    value: (d) => String(d.profile?.bodyCompositionIncluded ?? '—'),
  },
  {
    key: 'solariumMinutes',
    label: PROFILE_FIELD_LABEL.solariumMinutes,
    value: (d) => String(d.profile?.solariumMinutes ?? '—'),
  },
  {
    key: 'personalAccountCreditMinor',
    label: PROFILE_FIELD_LABEL.personalAccountCreditMinor,
    value: (d, c) =>
      d.profile ? money(d.profile.personalAccountCreditMinor, c) : '—',
  },
  {
    key: 'retailPriceOverrideMinor',
    label: PROFILE_FIELD_LABEL.retailPriceOverrideMinor,
    value: (d, c) => moneyOrDash(d.profile?.retailPriceOverrideMinor, c),
  },
];

function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

export function ProductDrawer({
  productExternalId,
  from,
  to,
  basis,
  settings,
  payrollHints,
  fallbackCurrency,
  onClose,
  onError,
  onSaved,
}: {
  productExternalId: string;
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  settings: MembershipEconomicsSettings;
  payrollHints: MembershipPayrollHints;
  fallbackCurrency: string;
  onClose: () => void;
  onError: (msg: string) => void;
  /** Called after composition saved so parent can reload the report. */
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<MembershipProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [wi, setWi] = useState<WhatIfState | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    api
      .analyticsMembershipsProductDetail(token, productExternalId, {
        from,
        to,
        basis,
      })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setWi(initWhatIf(d, settings, payrollHints));
      })
      .catch((e: unknown) => {
        if (!cancelled) onError(errMessage(e, 'Ошибка загрузки абонемента'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // settings / hints only seed initial calculator state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productExternalId, from, to, basis, reloadKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const input = useMemo(
    () => (detail && wi ? buildInput(detail, settings, payrollHints, wi) : null),
    [detail, wi, settings, payrollHints],
  );
  const result = useMemo(
    () => (input ? computeMembershipWhatIf(input) : null),
    [input],
  );

  const currency = detail?.currency ?? fallbackCurrency;
  const product = detail?.product;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Закрыть"
        className="flex-1 bg-black/40"
        onClick={onClose}
      />
      <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-2xl md:w-[480px]">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {product ? (
              <>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[product.status]}`}
                  />
                  <span className="truncate">{product.name}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  {product.groupLabel ?? 'Без группы'} · {productExternalId} ·
                  продано {product.soldCount}
                </p>
              </>
            ) : (
              <h3 className="text-lg font-semibold">Абонемент</h3>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        {loading && !detail && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
          </div>
        )}

        {detail && product && (
          <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
            <Section
              title="Цена"
              right={
                <span className="text-xs text-slate-500">
                  маржа {pct(product.marginPct)}
                </span>
              }
            >
              <PriceScaleBar
                retailMinor={detail.retailPriceMinor ?? product.retailPriceMinor}
                paidMinor={product.avgPaidMinor}
                breakevenMinor={product.breakevenPriceMinor}
                currency={currency}
              />
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Mini
                  label="Прайс"
                  value={moneyOrDash(
                    detail.retailPriceMinor ?? product.retailPriceMinor,
                    currency,
                  )}
                />
                <Mini
                  label="Ср. оплата"
                  value={money(product.avgPaidMinor, currency)}
                />
                <Mini
                  label="BE цена"
                  value={moneyOrDash(product.breakevenPriceMinor, currency)}
                />
                <Mini label="Скидка ср." value={pct(product.avgDiscountPct)} />
                <Mini
                  label="Макс. скидка"
                  value={pct(product.maxDiscountPctFromRetail)}
                />
                <Mini label="Запас цены" value={pct(product.priceHeadroomPct)} />
              </div>
            </Section>

            <Section
              title="Состав абонемента"
              right={
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? 'Скрыть форму' : 'Редактировать состав'}
                </button>
              }
            >
              {!product.compositionComplete && (
                <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">
                  Состав заполнен не полностью — расчёты приблизительные.
                </p>
              )}
              {editing ? (
                <ProfileForm
                  productExternalId={productExternalId}
                  name={product.name}
                  profile={detail.profile}
                  defaults={{
                    groupLabel: product.groupLabel,
                    termMonths: Math.max(1, Math.round(product.avgMonths) || 1),
                  }}
                  autoFilledFields={product.autoFilledFields}
                  onError={onError}
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    setReloadKey((k) => k + 1);
                    onSaved();
                  }}
                />
              ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {COMPOSITION_ITEMS.map((it) => (
                    <div
                      key={it.key}
                      className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-1"
                    >
                      <span className="text-slate-400">{it.label}</span>
                      <span className="flex items-center gap-1.5">
                        {it.value(detail, currency)}
                        {product.autoFilledFields.includes(it.key) && (
                          <Badge
                            tone="fitgo"
                            title="Заполнено автоматически из 1С / продаж"
                          >
                            авто
                          </Badge>
                        )}
                      </span>
                    </div>
                  ))}
                  {detail.profile?.excluded && (
                    <div className="col-span-2">
                      <Badge tone="rose">исключён из аналитики</Badge>
                    </div>
                  )}
                </div>
              )}
              {product.autoFilledFields
                .filter((f) => !COMPOSITION_ITEMS.some((i) => i.key === f))
                .map((f) => (
                  <Badge key={f} tone="fitgo" title="Заполнено автоматически">
                    авто: {PROFILE_FIELD_LABEL[f] ?? f}
                  </Badge>
                ))}
            </Section>

            <Section title="Куда уходят деньги">
              <WaterfallBlock steps={detail.waterfall} currency={currency} />
            </Section>

            <Section title="Обещано / использовано / сгорело">
              <ServicePromiseBlock
                rows={detail.servicePromise}
                currency={currency}
              />
            </Section>

            <Section title="Тренер ГП">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Mini label="Визитов ГП" value={String(detail.gpTrainer.visits)} />
                <Mini
                  label="Стоимость тренеров"
                  value={money(detail.gpTrainer.trainerCostMinor, currency)}
                />
                <Mini
                  label="Ср. за визит"
                  value={moneyOrDash(detail.gpTrainer.avgPerVisitMinor, currency)}
                />
                <Mini
                  label="Доля от оплаты"
                  value={pct(detail.gpTrainer.shareOfPaidPct)}
                />
                <Mini
                  label="Макс. ГП / мес"
                  value={num(detail.gpTrainer.maxGpVisitsPerMonth)}
                />
                <Mini
                  label="Оценено (не факт)"
                  value={pct(detail.gpTrainer.estimatedShare)}
                />
              </div>
              {detail.gpTrainer.estimatedShare != null &&
                detail.gpTrainer.estimatedShare > 30 && (
                  <p className="text-xs text-amber-300">
                    Больше 30% визитов посчитано по оценочной ставке тренера —
                    проверьте ЗП-профили.
                  </p>
                )}
            </Section>

            <Section title="Распределение ГП визитов / мес">
              <VisitDistributionBars
                buckets={detail.visitDistribution}
                heightClass="h-28"
              />
              {detail.marginByGpBucket.length > 0 && (
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Визитов/мес</th>
                      <th className="py-1 pr-2">Экз.</th>
                      <th className="py-1">Ср. маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.marginByGpBucket.map((b) => (
                      <tr key={b.key} className="border-t border-slate-800">
                        <td className="py-1 pr-2">{b.label}</td>
                        <td className="py-1 pr-2">{b.count}</td>
                        <td
                          className={`py-1 ${
                            b.avgMarginMinor < 0
                              ? 'text-rose-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {money(b.avgMarginMinor, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section title="Сценарии">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Сценарий</th>
                      <th className="py-1 pr-2">Затраты</th>
                      <th className="py-1 pr-2">Маржа</th>
                      <th className="py-1 pr-2">%</th>
                      <th className="py-1 pr-2">BE цена</th>
                      <th className="py-1 pr-2">Макс. скидка</th>
                      <th className="py-1">Макс. ГП/мес</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scenarios.map((s) => (
                      <tr key={s.key} className="border-t border-slate-800">
                        <td className="py-1 pr-2">{s.label}</td>
                        <td className="py-1 pr-2">
                          {money(s.cost.totalMinor, currency)}
                        </td>
                        <td
                          className={`py-1 pr-2 ${
                            s.marginMinor < 0
                              ? 'text-rose-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {money(s.marginMinor, currency)}
                        </td>
                        <td className="py-1 pr-2">{pct(s.marginPct)}</td>
                        <td className="py-1 pr-2">
                          {moneyOrDash(s.breakevenPriceMinor, currency)}
                        </td>
                        <td className="py-1 pr-2">
                          {pct(s.maxDiscountPctFromRetail)}
                        </td>
                        <td className="py-1">{num(s.maxGpVisitsPerMonth)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Скидки по абонементу">
              {detail.discounts.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Продаж со скидкой за период нет.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-1 pr-2">Скидка</th>
                        <th className="py-1 pr-2">Продаж</th>
                        <th className="py-1 pr-2">Ср. %</th>
                        <th className="py-1 pr-2">Ср. оплата</th>
                        <th className="py-1 pr-2">ГП/мес</th>
                        <th className="py-1">Маржа</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.discounts.map((d) => (
                        <tr key={d.discountName} className="border-t border-slate-800">
                          <td className="py-1 pr-2">{d.discountName}</td>
                          <td className="py-1 pr-2">{d.salesCount}</td>
                          <td className="py-1 pr-2">{pct(d.avgDiscountPct)}</td>
                          <td className="py-1 pr-2">
                            {money(d.avgPaidMinor, currency)}
                          </td>
                          <td className="py-1 pr-2">{num(d.avgGpPerMonth)}</td>
                          <td
                            className={
                              d.marginMinor < 0 ? 'text-rose-400' : 'text-emerald-400'
                            }
                          >
                            {money(d.marginMinor, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {wi && input && result && (
              <WhatIfCalculator
                wi={wi}
                setWi={setWi}
                onReset={() => setWi(initWhatIf(detail, settings, payrollHints))}
                input={input}
                baseMarginMinor={product.marginMinor}
                baseMarginPct={product.marginPct}
                result={result}
                currency={currency}
              />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/50 px-2 py-1.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function WhatIfCalculator({
  wi,
  setWi,
  onReset,
  input,
  result,
  baseMarginMinor,
  baseMarginPct,
  currency,
}: {
  wi: WhatIfState;
  setWi: (updater: (s: WhatIfState | null) => WhatIfState | null) => void;
  onReset: () => void;
  input: MembershipWhatIfInput;
  result: ReturnType<typeof computeMembershipWhatIf>;
  baseMarginMinor: number;
  baseMarginPct: number | null;
  currency: string;
}) {
  const retail = input.retailPriceMinor;
  const discountPct =
    retail > 0 ? Math.round((1 - wi.paidMinor / retail) * 1000) / 10 : 0;
  const paidMax = Math.max(retail, wi.paidMinor, 100) * 1.3;
  const patch = (p: Partial<WhatIfState>) =>
    setWi((s) => (s ? { ...s, ...p } : s));

  return (
    <Section
      title="Калькулятор «что если»"
      right={
        <button type="button" className="btn-secondary text-xs" onClick={onReset}>
          Сбросить
        </button>
      }
    >
      <div className="space-y-3">
        <Slider
          label="Цена оплаты"
          value={wi.paidMinor}
          min={0}
          max={Math.round(paidMax)}
          step={100}
          display={money(wi.paidMinor, currency)}
          onChange={(v) => patch({ paidMinor: v })}
        />
        <Slider
          label="Скидка от прайса"
          value={discountPct}
          min={0}
          max={80}
          step={0.5}
          display={`${discountPct}%`}
          onChange={(v) =>
            patch({ paidMinor: Math.round(retail * (1 - v / 100)) })
          }
        />
        <Slider
          label="Визитов ГП в неделю"
          value={wi.gpPerWeek}
          min={0}
          max={7}
          step={0.1}
          display={`${wi.gpPerWeek}`}
          onChange={(v) => patch({ gpPerWeek: v })}
        />
        <Slider
          label="Комиссия с продаж"
          value={wi.commissionPct}
          min={0}
          max={30}
          step={0.5}
          display={`${wi.commissionPct}%`}
          onChange={(v) => patch({ commissionPct: v })}
        />
        <Slider
          label="Использование квот (ПТ, массаж, солярий, ЛС)"
          value={wi.quotaUsagePct}
          min={0}
          max={100}
          step={5}
          display={`${wi.quotaUsagePct}%`}
          onChange={(v) => patch({ quotaUsagePct: v })}
        />
        <Toggle
          checked={wi.includeFixed}
          onChange={(v) => patch({ includeFixed: v })}
          label="Учитывать фикс. накладные"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-800/50 p-2">
          <p className="text-[10px] text-slate-500">Маржа (сценарий)</p>
          <p
            className={`text-lg font-semibold ${
              result.marginMinor < 0 ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {money(result.marginMinor, currency)}
          </p>
          <p className="text-xs text-slate-400">{pct(result.marginPct)}</p>
        </div>
        <div className="rounded-lg bg-slate-800/50 p-2">
          <p className="text-[10px] text-slate-500">Средняя маржа на продажу</p>
          <p className="text-lg font-semibold">
            {money(baseMarginMinor, currency)}
          </p>
          <p className="text-xs text-slate-400">{pct(baseMarginPct)}</p>
        </div>
        <Mini
          label="BE цена"
          value={moneyOrDash(result.breakevenPriceMinor, currency)}
        />
        <Mini
          label="Макс. скидка от прайса"
          value={pct(result.maxDiscountPctFromRetail)}
        />
        <Mini
          label="Макс. ГП / мес до убытка"
          value={num(result.maxGpVisitsPerMonth)}
        />
        <Mini
          label="Всего затрат"
          value={money(result.cost.totalMinor, currency)}
        />
      </div>

      <table className="w-full text-left text-xs">
        <tbody>
          {COST_ROWS.filter(([k]) => result.cost[k] !== 0).map(([k, label]) => (
            <tr key={k} className="border-t border-slate-800">
              <td className="py-1 pr-2 text-slate-400">{label}</td>
              <td className="py-1 text-right">
                {money(result.cost[k], currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
