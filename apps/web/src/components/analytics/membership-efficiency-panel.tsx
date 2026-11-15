'use client';

import type {
  MembershipClientsReport,
  MembershipEfficiencyBasis,
  MembershipEfficiencyReport,
  MembershipEfficiencyView,
  MembershipTrainersReport,
  MembershipUtilizationSegment,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { CatalogTab } from './memberships/catalog-tab';
import { ClientsTab } from './memberships/clients-tab';
import { DataQualityBadge } from './memberships/data-quality-badge';
import { DiscountsTab } from './memberships/discounts-tab';
import { errMessage } from './memberships/format';
import { MethodModal } from './memberships/method-modal';
import { OverviewTab } from './memberships/overview-tab';
import { ProductDrawer } from './memberships/product-drawer';
import { SettingsPanel } from './memberships/settings-panel';
import { TrainersTab } from './memberships/trainers-tab';

type SubTab = 'overview' | 'catalog' | 'discounts' | 'trainers' | 'clients';

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'catalog', label: 'Каталог' },
  { id: 'discounts', label: 'Скидки' },
  { id: 'trainers', label: 'Тренеры и занятия' },
  { id: 'clients', label: 'Клиенты' },
];

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
  const [clientsPage, setClientsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [selectedProductExternalId, setSelectedProductExternalId] = useState<
    string | null
  >(null);

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
          page: clientsPage,
          pageSize: 50,
        }),
      ]);
      setReport(r);
      setTrainers(t);
      setClients(c);
    } catch (e) {
      onError(errMessage(e, 'Ошибка загрузки'));
    } finally {
      setLoading(false);
    }
  }, [from, to, basis, view, familyParam, segment, clientsPage, onError]);

  useEffect(() => {
    setClientsPage(1);
  }, [segment, from, to, basis, familyParam]);

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
      onError(errMessage(e, 'Ошибка Excel'));
    } finally {
      setExporting(false);
    }
  };

  const familyOptions = useMemo(() => {
    const fromSettings = report?.settings.families ?? [];
    return [{ id: 'ALL', label: 'Все типы' }, ...fromSettings];
  }, [report?.settings.families]);

  const closeDrawer = useCallback(() => setSelectedProductExternalId(null), []);

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
            onChange={(e) => setView(e.target.value as MembershipEfficiencyView)}
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
        {SUB_TABS.map((t) => (
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
        <OverviewTab
          report={report}
          onOpenProduct={setSelectedProductExternalId}
          onOpenClients={() => {
            setSubTab('clients');
            setSegment('ALL');
          }}
        />
      )}

      {subTab === 'catalog' && (
        <CatalogTab
          products={report.products}
          currency={report.currency}
          onOpenProduct={setSelectedProductExternalId}
        />
      )}

      {subTab === 'discounts' && (
        <DiscountsTab
          from={from}
          to={to}
          basis={basis}
          family={familyParam}
          onError={onError}
        />
      )}

      {subTab === 'trainers' && trainers && <TrainersTab report={trainers} />}

      {subTab === 'clients' && clients && (
        <ClientsTab
          report={clients}
          segment={segment}
          onSegment={setSegment}
          onOpenProduct={setSelectedProductExternalId}
          onPage={setClientsPage}
        />
      )}

      {selectedProductExternalId && (
        <ProductDrawer
          productExternalId={selectedProductExternalId}
          from={from}
          to={to}
          basis={basis}
          settings={report.settings}
          payrollHints={report.payrollHints}
          fallbackCurrency={report.currency}
          onClose={closeDrawer}
          onError={onError}
          onSaved={() => void load()}
        />
      )}

      {showMethod && (
        <MethodModal
          quality={report.dataQuality}
          onClose={() => setShowMethod(false)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          report={report}
          from={from}
          to={to}
          basis={basis}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            void load();
          }}
          onProductSaved={() => void load()}
          onError={onError}
        />
      )}
    </div>
  );
}
