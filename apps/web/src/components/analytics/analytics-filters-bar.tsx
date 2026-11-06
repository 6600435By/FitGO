'use client';

const SEGMENTS = [
  { value: '', label: 'Все сегменты' },
  { value: 'membership', label: 'Абонементы' },
  { value: 'training', label: 'ПТ / тренинги' },
  { value: 'spa', label: 'СПА' },
  { value: 'solarium', label: 'Солярий' },
  { value: 'shop', label: 'Магазин' },
  { value: 'corporate', label: 'Корпо' },
  { value: 'other', label: 'Прочее' },
  { value: 'unclassified', label: 'Не разнесено' },
];

const PAYMENTS = [
  { value: '', label: 'Любая оплата' },
  { value: 'cash', label: 'Нал' },
  { value: 'card', label: 'Карта' },
  { value: 'cashless', label: 'Безнал' },
  { value: 'personalAccount', label: 'Лицевой счёт' },
  { value: 'corpo', label: 'Корпо (ручное)' },
];

export type AnalyticsFilterState = {
  segment: string;
  employee: string;
  performer: string;
  product: string;
  payment: string;
  q: string;
};

export function emptyAnalyticsFilters(): AnalyticsFilterState {
  return {
    segment: '',
    employee: '',
    performer: '',
    product: '',
    payment: '',
    q: '',
  };
}

export function analyticsFiltersActive(f: AnalyticsFilterState) {
  return Boolean(
    f.segment || f.employee || f.performer || f.product || f.payment || f.q,
  );
}

export function AnalyticsFiltersBar({
  value,
  onChange,
  sellerOptions,
  performerOptions,
}: {
  value: AnalyticsFilterState;
  onChange: (next: Partial<AnalyticsFilterState>) => void;
  sellerOptions?: Array<{ id: string; name: string }>;
  performerOptions?: Array<{ id: string; name: string }>;
}) {
  const active = analyticsFiltersActive(value);
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Сегмент</span>
          <select
            className="input"
            value={value.segment}
            onChange={(e) => onChange({ segment: e.target.value })}
          >
            {SEGMENTS.map((s) => (
              <option key={s.value || 'all'} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Кто продал</span>
          <select
            className="input min-w-[10rem]"
            value={value.employee}
            onChange={(e) => onChange({ employee: e.target.value })}
          >
            <option value="">Все</option>
            <option value="none">Без автора</option>
            {(sellerOptions ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Кто оказал</span>
          <select
            className="input min-w-[10rem]"
            value={value.performer}
            onChange={(e) => onChange({ performer: e.target.value })}
          >
            <option value="">Все</option>
            <option value="none">Без исполнителя</option>
            {(performerOptions ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Оплата</span>
          <select
            className="input"
            value={value.payment}
            onChange={(e) => onChange({ payment: e.target.value })}
          >
            {PAYMENTS.map((p) => (
              <option key={p.value || 'all'} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Номенклатура</span>
          <input
            className="input min-w-[12rem]"
            value={value.product}
            placeholder="UUID или название"
            onChange={(e) => onChange({ product: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Клиент</span>
          <input
            className="input min-w-[10rem]"
            value={value.q}
            placeholder="Имя / id"
            onChange={(e) => onChange({ q: e.target.value })}
          />
        </label>
        {active && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onChange(emptyAnalyticsFilters())}
          >
            Сбросить фильтры
          </button>
        )}
      </div>
      {active && (
        <div className="flex flex-wrap gap-2 text-xs">
          {value.segment && (
            <Chip
              label={`Сегмент: ${SEGMENTS.find((s) => s.value === value.segment)?.label ?? value.segment}`}
              onClear={() => onChange({ segment: '' })}
            />
          )}
          {value.employee && (
            <Chip
              label={`Продал: ${value.employee === 'none' ? 'без автора' : value.employee}`}
              onClear={() => onChange({ employee: '' })}
            />
          )}
          {value.performer && (
            <Chip
              label={`Оказал: ${value.performer === 'none' ? 'без исполнителя' : value.performer}`}
              onClear={() => onChange({ performer: '' })}
            />
          )}
          {value.payment && (
            <Chip
              label={`Оплата: ${PAYMENTS.find((p) => p.value === value.payment)?.label ?? value.payment}`}
              onClear={() => onChange({ payment: '' })}
            />
          )}
          {value.product && (
            <Chip
              label={`SKU: ${value.product}`}
              onClear={() => onChange({ product: '' })}
            />
          )}
          {value.q && (
            <Chip label={`Клиент: ${value.q}`} onClear={() => onChange({ q: '' })} />
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="rounded-full bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700"
    >
      {label} ×
    </button>
  );
}

export function AnalyticsDataQualityBar({
  coverage,
  filtersActive,
  provider,
}: {
  coverage?: {
    revenueSince?: string | null;
    visitsSince?: string | null;
    visitsUntil?: string | null;
    revenueSyncedAt?: string | null;
    visitsSyncedAt?: string | null;
    membersSource?: string;
    membersPartial?: boolean;
    compareCovered?: boolean;
    compareHint?: string;
  } | null;
  filtersActive?: boolean;
  provider?: string | null;
}) {
  if (!coverage && !provider) return null;
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {provider && <span>Источник: {provider}</span>}
        {coverage?.revenueSince && (
          <span>Выручка в кэше с {coverage.revenueSince}</span>
        )}
        {coverage?.visitsSince && (
          <span>
            Проходы с {coverage.visitsSince}
            {coverage.visitsUntil ? ` по ${coverage.visitsUntil}` : ''}
          </span>
        )}
        {coverage?.membersPartial && (
          <span className="text-amber-300">База абонементов неполная (срез)</span>
        )}
        {coverage?.compareHint && (
          <span className="text-amber-300">{coverage.compareHint}</span>
        )}
        {filtersActive && (
          <span>Фильтр продаж не действует на проходы, базу и заполняемость</span>
        )}
      </div>
    </div>
  );
}
