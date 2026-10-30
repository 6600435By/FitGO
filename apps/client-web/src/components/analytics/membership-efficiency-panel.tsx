'use client';

import type {
  MembershipClientRow,
  MembershipClientsReport,
  MembershipEconomicsSettings,
  MembershipEfficiencyBasis,
  MembershipEfficiencyReport,
  MembershipEfficiencyView,
  MembershipTrainersReport,
  MembershipUtilizationSegment,
} from '@fitgo/shared-types';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { MetricCard } from './metric-card';

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  })}\u00a0${currency}`;
}

function pct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v}%`;
}

const SEGMENT_LABEL: Record<MembershipUtilizationSegment, string> = {
  max: 'Максимум',
  normal: 'Норма',
  under: 'Недогруз',
  sleeping: 'Спящие',
};

const STATUS_DOT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-400',
};

export function MembershipEfficiencyPanel({
  from,
  to,
  onError,
}: {
  from: string;
  to: string;
  onError: (msg: string) => void;
}) {
  const [basis, setBasis] = useState<MembershipEfficiencyBasis>('ended');
  const [view, setView] = useState<MembershipEfficiencyView>('retail');
  const [family, setFamily] = useState<string>('ALL');
  const [report, setReport] = useState<MembershipEfficiencyReport | null>(null);
  const [trainers, setTrainers] = useState<MembershipTrainersReport | null>(
    null,
  );
  const [clients, setClients] = useState<MembershipClientsReport | null>(null);
  const [segment, setSegment] = useState<MembershipUtilizationSegment | 'ALL'>(
    'ALL',
  );
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedTrainer, setExpandedTrainer] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'overview' | 'trainers' | 'clients'>(
    'overview',
  );

  const familyParam = family === 'ALL' ? undefined : family;

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const [r, t, c] = await Promise.all([
        api.analyticsMemberships(token, {
          from,
          to,
          basis,
          view,
          family: familyParam,
        }),
        api.analyticsMembershipsTrainers(token, {
          from,
          to,
          basis,
          family: familyParam,
        }),
        api.analyticsMembershipsClients(token, {
          from,
          to,
          basis,
          family: familyParam,
          segment: segment === 'ALL' ? undefined : segment,
          page: 1,
          pageSize: 50,
        }),
      ]);
      setReport(r);
      setTrainers(t);
      setClients(c);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to, basis, view, familyParam, segment, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const onExport = async () => {
    const token = getToken();
    if (!token) return;
    setExporting(true);
    try {
      const blob = await api.analyticsMembershipsXlsx(token, {
        from,
        to,
        basis,
        view,
        family: familyParam,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics_memberships_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
    }
  };

  const familyOptions = useMemo(() => {
    const fromSettings = report?.settings.families ?? [];
    return [{ id: 'ALL', label: 'Все типы' }, ...fromSettings];
  }, [report?.settings.families]);

  const maxBucket = Math.max(
    1,
    ...(report?.visitDistribution.map((b) => b.count) ?? [1]),
  );

  if (loading && !report) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="card text-sm text-slate-400">
        Нет данных по абонементам за период. Проверьте фильтр типов и базис
        (завершённые / активные).
      </div>
    );
  }

  const currency = report.currency;

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      {/* Header controls */}
      <div className="card flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Базис</span>
          <select
            className="input"
            value={basis}
            onChange={(e) =>
              setBasis(e.target.value as MembershipEfficiencyBasis)
            }
          >
            <option value="ended">Завершённые</option>
            <option value="active">Активные (прогноз)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Взгляд</span>
          <select
            className="input"
            value={view}
            onChange={(e) =>
              setView(e.target.value as MembershipEfficiencyView)
            }
          >
            <option value="retail">По прайсу</option>
            <option value="cost">По себестоимости</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Тип абонемента</span>
          <select
            className="input"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            {familyOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <DataQualityBadge quality={report.dataQuality} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setShowMethod(true)}
          >
            Методика
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setShowSettings(true)}
          >
            Настройки
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={exporting}
            onClick={() => void onExport()}
          >
            {exporting ? 'Excel…' : 'Excel'}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Экземпляров: {report.instanceCount}
        {basis === 'active' ? ' · прогноз по текущему темпу' : ' · полный факт'}
        {report.breakevenVisits != null
          ? ` · порог безубыточности ≈ ${report.breakevenVisits} визитов ГП`
          : ''}
      </p>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'overview' as const, label: 'Обзор' },
            { id: 'trainers' as const, label: 'Тренеры и занятия' },
            { id: 'clients' as const, label: 'Клиенты' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              subTab === t.id ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'overview' && (
        <>
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
                  {ins.action && (
                    <p className="mt-1 text-fitgo-400">{ins.action}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="Ср. цена абонемента"
              metric={report.kpis.avgPaidMinor}
              currency={currency}
            />
            <MetricCard
              label="ГП / мес"
              metric={report.kpis.avgGpPerMonth}
              currency={currency}
            />
            <MetricCard
              label="Стоимость 1 посещения ГП"
              metric={report.kpis.gpCostPerVisitMinor}
              currency={currency}
            />
            <MetricCard
              label="Тренер на 1 посетителя"
              metric={report.kpis.trainerPerVisitMinor}
              currency={currency}
            />
            <MetricCard
              label="Маржа на 1 посещение"
              metric={report.kpis.marginPerVisitMinor}
              currency={currency}
            />
            <MetricCard
              label="Сгорело"
              metric={report.kpis.burnedMinor}
              currency={currency}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <WaterfallCard
              steps={report.waterfall}
              currency={currency}
            />
            <ServicePromiseCard
              rows={report.servicePromise}
              currency={currency}
            />
          </div>

          <FamiliesTable rows={report.families} currency={currency} />

          <div className="card">
            <h3 className="mb-2 font-semibold">
              Распределение: ГП визитов в месяц
            </h3>
            {report.breakevenVisits != null && (
              <p className="mb-2 text-xs text-slate-500">
                Порог безубыточности ≈ {report.breakevenVisits} визитов за срок
                абонемента (не в месяц)
              </p>
            )}
            <div className="flex items-end gap-2 h-36">
              {report.visitDistribution.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  title={`${b.label}: ${b.count}`}
                  className="flex flex-1 flex-col items-center gap-1"
                  onClick={() => {
                    setSubTab('clients');
                    setSegment('ALL');
                  }}
                >
                  <span className="text-[10px] text-slate-400">{b.count}</span>
                  <div
                    className="w-full rounded-t bg-fitgo-500/80 min-h-[4px]"
                    style={{
                      height: `${Math.max(4, (b.count / maxBucket) * 100)}%`,
                    }}
                  />
                  <span className="text-[10px] text-slate-500">{b.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {subTab === 'trainers' && trainers && (
        <TrainersSection
          report={trainers}
          currency={currency}
          expanded={expandedTrainer}
          onToggle={(id) =>
            setExpandedTrainer((cur) => (cur === id ? null : id))
          }
        />
      )}

      {subTab === 'clients' && clients && (
        <ClientsSection
          report={clients}
          currency={currency}
          segment={segment}
          onSegment={setSegment}
        />
      )}

      {showMethod && (
        <MethodModal
          report={report}
          onClose={() => setShowMethod(false)}
        />
      )}
      {showSettings && (
        <SettingsModal
          initial={report.settings}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            void load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function DataQualityBadge({
  quality,
}: {
  quality: MembershipEfficiencyReport['dataQuality'];
}) {
  const ok =
    quality.packageDocCoverage >= 0.8 && quality.saleMatchCoverage >= 0.8;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs ${
        ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
      }`}
      title={quality.warning ?? undefined}
    >
      Данные: Doc {Math.round(quality.packageDocCoverage * 100)}% · продажи{' '}
      {Math.round(quality.saleMatchCoverage * 100)}% · ЛС{' '}
      {Math.round(quality.personalAccountCoverage * 100)}%
    </div>
  );
}

function WaterfallCard({
  steps,
  currency,
}: {
  steps: MembershipEfficiencyReport['waterfall'];
  currency: string;
}) {
  const maxAbs = Math.max(1, ...steps.map((s) => Math.abs(s.runningMinor)));
  return (
    <div className="card">
      <h3 className="mb-2 font-semibold">Куда уходят деньги</h3>
      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.key} className="text-sm">
            <div className="mb-0.5 flex justify-between text-xs">
              <span className="text-slate-400">{s.label}</span>
              <span>
                {s.key !== 'margin' && s.deltaMinor !== 0
                  ? `${s.deltaMinor > 0 ? '+' : ''}${money(s.deltaMinor, currency)} → `
                  : ''}
                {money(s.runningMinor, currency)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-slate-800">
              <div
                className={`h-full ${
                  s.key === 'margin'
                    ? s.runningMinor >= 0
                      ? 'bg-emerald-500'
                      : 'bg-rose-500'
                    : s.deltaMinor >= 0
                      ? 'bg-fitgo-500'
                      : 'bg-slate-500'
                }`}
                style={{
                  width: `${Math.min(100, (Math.abs(s.runningMinor) / maxAbs) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ServicePromiseCard({
  rows,
  currency,
}: {
  rows: MembershipEfficiencyReport['servicePromise'];
  currency: string;
}) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-2 font-semibold">Обещано / использовано / сгорело</h3>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-2">Услуга</th>
            <th className="py-1 pr-2">Обещано</th>
            <th className="py-1 pr-2">Исп.</th>
            <th className="py-1">Сгорело</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-800">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="py-1.5 pr-2">{money(r.promisedMinor, currency)}</td>
              <td className="py-1.5 pr-2">{money(r.usedMinor, currency)}</td>
              <td className="py-1.5">{money(r.burnedMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-2" title="Тип продукта">
              Тип
            </th>
            <th className="py-1 pr-2">N</th>
            <th className="py-1 pr-2" title="Средняя оплата">
              Цена
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
            <th className="py-1 pr-2">Массаж</th>
            <th className="py-1 pr-2">Соляр.</th>
            <th className="py-1 pr-2">ЛС</th>
            <th className="py-1" title="Визиты, после которых тренер съедает доступ ГП">
              BE
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
              <td className="py-1.5 pr-2">{money(r.avgPaidMinor, currency)}</td>
              <td className="py-1.5 pr-2">{r.avgMonths}</td>
              <td className="py-1.5 pr-2">{r.avgGpPerMonth}</td>
              <td className="py-1.5 pr-2">{r.avgGymPerMonth}</td>
              <td className="py-1.5 pr-2">
                {r.avgGpCostPerVisitMinor != null
                  ? money(r.avgGpCostPerVisitMinor, currency)
                  : '—'}
              </td>
              <td className="py-1.5 pr-2">
                {r.avgTrainerPerVisitMinor != null
                  ? money(r.avgTrainerPerVisitMinor, currency)
                  : '—'}
              </td>
              <td className="py-1.5 pr-2">{pct(r.marginPct)}</td>
              <td className="py-1.5 pr-2">{pct(r.massageUsePct)}</td>
              <td className="py-1.5 pr-2">{pct(r.solariumUsePct)}</td>
              <td className="py-1.5 pr-2">{pct(r.personalAccountUsePct)}</td>
              <td className="py-1.5">{r.breakevenVisits ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrainersSection({
  report,
  currency,
  expanded,
  onToggle,
}: {
  report: MembershipTrainersReport;
  currency: string;
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  if (!report.trainers.length) {
    return (
      <div className="card text-sm text-slate-400">
        Нет занятий ГП с абонементными посещениями за период.
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto space-y-2">
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
                className="border-t border-slate-800 cursor-pointer hover:bg-slate-800/40"
                onClick={() => onToggle(t.trainerId)}
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

function ClientsSection({
  report,
  currency,
  segment,
  onSegment,
}: {
  report: MembershipClientsReport;
  currency: string;
  segment: MembershipUtilizationSegment | 'ALL';
  onSegment: (s: MembershipUtilizationSegment | 'ALL') => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SegChip
          active={segment === 'ALL'}
          onClick={() => onSegment('ALL')}
          label={`Все (${report.total})`}
        />
        {(
          Object.keys(SEGMENT_LABEL) as MembershipUtilizationSegment[]
        ).map((s) => (
          <SegChip
            key={s}
            active={segment === s}
            onClick={() => onSegment(s)}
            label={`${SEGMENT_LABEL[s]} (${report.bySegment[s]})`}
          />
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Клиент</th>
              <th className="py-1 pr-2">Тип</th>
              <th className="py-1 pr-2">Сегмент</th>
              <th className="py-1 pr-2">ГП</th>
              <th className="py-1 pr-2">ГП/мес</th>
              <th className="py-1 pr-2">Зал</th>
              <th className="py-1 pr-2">Массаж</th>
              <th className="py-1 pr-2">ЛС сгорело</th>
              <th className="py-1 pr-2">Маржа</th>
              <th className="py-1 pr-2">До</th>
              <th className="py-1">Действие</th>
            </tr>
          </thead>
          <tbody>
            {report.clients.map((c) => (
              <ClientRow key={c.packageDocId} c={c} currency={currency} />
            ))}
          </tbody>
        </table>
        {!report.clients.length && (
          <p className="py-4 text-center text-sm text-slate-500">
            Нет клиентов в этом сегменте
          </p>
        )}
      </div>
    </div>
  );
}

function ClientRow({
  c,
  currency,
}: {
  c: MembershipClientRow;
  currency: string;
}) {
  return (
    <tr className="border-t border-slate-800">
      <td className="py-1.5 pr-2">
        {c.clientName}
        {c.priceEstimated && (
          <span className="ml-1 text-[10px] text-amber-400" title="Цена оценена">
            ~
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2">{c.familyLabel}</td>
      <td className="py-1.5 pr-2">{SEGMENT_LABEL[c.segment]}</td>
      <td className="py-1.5 pr-2">{c.gpVisits}</td>
      <td className="py-1.5 pr-2">{c.gpPerMonth}</td>
      <td className="py-1.5 pr-2">{c.gymVisits}</td>
      <td className="py-1.5 pr-2">
        {c.massageUsed}/{c.massageQuota}
      </td>
      <td className="py-1.5 pr-2">
        {money(c.personalAccountBurnedMinor, currency)}
      </td>
      <td
        className={`py-1.5 pr-2 ${
          c.marginMinor < 0 ? 'text-rose-400' : ''
        }`}
      >
        {money(c.marginMinor, currency)}
      </td>
      <td className="py-1.5 pr-2">{c.endDate ?? '—'}</td>
      <td className="py-1.5">
        {c.segment === 'sleeping' && c.endsWithin30d ? (
          <a
            className="text-xs text-fitgo-400 hover:underline"
            href={`/super-admin/tasks?clientExternalId=${encodeURIComponent(c.clientExternalId)}`}
            title="Создать задачу на удержание"
          >
            Удержание
          </a>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

function SegChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs ${
        active ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

function MethodModal({
  report,
  onClose,
}: {
  report: MembershipEfficiencyReport;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-h-[85vh] w-full max-w-lg overflow-y-auto space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">Методика</h3>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <ul className="list-disc space-y-2 pl-4 text-sm text-slate-300">
          <li>
            Экземпляр = документ членства (`packageDocId`) из журнала занятий.
          </li>
          <li>
            Цена — ближайшая продажа membership по клиенту и типу; иначе медиана
            типа (помечается «~»).
          </li>
          <li>
            Разложение цены: ЛС (16×мес) + массаж/солярий по квотам × прайс +
            остаток «доступ» делится между ГП и залом пропорционально визитам.
          </li>
          <li>
            Стоимость 1 посещения ГП = доля доступа ГП / число посещений ГП.
          </li>
          <li>
            Тренер на посетителя = начисление за занятие / число посетивших
            (ставки FitGO, effectiveFrom).
          </li>
          <li>
            ЛС начисляется сразу на весь срок; остаток сгорает в конце
            абонемента.
          </li>
          <li>
            Зал ≈ день визита без ГП/спа в тот же день (приближение).
          </li>
        </ul>
        <div className="rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">
          Покрытие: packageDocId{' '}
          {Math.round(report.dataQuality.packageDocCoverage * 100)}%, продажи{' '}
          {Math.round(report.dataQuality.saleMatchCoverage * 100)}%, ЛС{' '}
          {Math.round(report.dataQuality.personalAccountCoverage * 100)}%.
          {report.dataQuality.warning && (
            <p className="mt-1 text-amber-300">{report.dataQuality.warning}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  initial,
  onClose,
  onSaved,
  onError,
}: {
  initial: MembershipEconomicsSettings;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      await api.analyticsMembershipsSettingsPut(token, draft);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-h-[85vh] w-full max-w-lg overflow-y-auto space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">Настройки экономики абонементов</h3>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <label className="block text-sm">
          <span className="text-slate-400">Норма визитов / неделю</span>
          <input
            className="input mt-1"
            type="number"
            step="0.1"
            value={draft.normVisitsPerWeek}
            onChange={(e) =>
              setDraft({
                ...draft,
                normVisitsPerWeek: Number(e.target.value) || 2,
              })
            }
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Доля себестоимости ЛС (0–1)</span>
          <input
            className="input mt-1"
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={draft.personalAccountCogsShare}
            onChange={(e) =>
              setDraft({
                ...draft,
                personalAccountCogsShare: Number(e.target.value) || 0,
              })
            }
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Накладные на визит (BYN)</span>
          <input
            className="input mt-1"
            type="number"
            step="0.1"
            value={(draft.overheadPerVisitMinor ?? 0) / 100}
            onChange={(e) =>
              setDraft({
                ...draft,
                overheadPerVisitMinor: Math.round(
                  (Number(e.target.value) || 0) * 100,
                ),
              })
            }
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Дней без визита → «спящий»</span>
          <input
            className="input mt-1"
            type="number"
            value={draft.sleepingDays}
            onChange={(e) =>
              setDraft({
                ...draft,
                sleepingDays: Number(e.target.value) || 21,
              })
            }
          />
        </label>
        <div className="text-xs text-slate-500">
          Семейства абонементов (VIP, Единый…), квоты массажа/солярия и ЛС
          задаются в API/JSON. Здесь — оперативные пороги.
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
