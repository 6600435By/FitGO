'use client';

import {
  ADMIN_HOME_PINS,
  ADMIN_HOME_PRESETS,
  ADMIN_HOME_WIDGETS,
  adminHomeItemAllowed,
  materializeAdminHomeLayout,
  type AdminHomeLayoutValue,
  type AdminHomePinId,
  type AdminHomePresetId,
  type AdminHomeWidgetId,
  type AdminPermission,
  type ProductModuleKey,
} from '@fitgo/shared-types';

const PRESET_ORDER: AdminHomePresetId[] = [
  'reception',
  'floor',
  'money',
  'all',
];

function ToggleRow({
  checked,
  label,
  nested,
  onChange,
}: {
  checked: boolean;
  label: string;
  nested?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-200 hover:bg-slate-800/50 ${
        nested ? 'pl-5' : ''
      }`}
    >
      <input
        type="checkbox"
        className="rounded border-slate-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function AdminHomeSettings({
  layout,
  permissions,
  isEnabled,
  onChange,
  onReset,
  onClose,
}: {
  layout: AdminHomeLayoutValue;
  permissions: AdminPermission[];
  isEnabled: (m: ProductModuleKey) => boolean;
  onChange: (next: {
    widgets: AdminHomeWidgetId[];
    pins: AdminHomePinId[];
  }) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const current = materializeAdminHomeLayout(layout);
  const permStrs = permissions as string[];
  const enabled = (m: string) => isEnabled(m as ProductModuleKey);

  const widgets = ADMIN_HOME_WIDGETS.filter((w) =>
    adminHomeItemAllowed(w, permStrs, enabled),
  );
  const pins = ADMIN_HOME_PINS.filter((p) =>
    adminHomeItemAllowed(p, permStrs, enabled),
  );
  const taskPins = pins.filter((p) => p.kind === 'task');
  const navPins = pins.filter((p) => p.kind === 'nav');

  const toggleWidget = (id: AdminHomeWidgetId, on: boolean) => {
    const set = new Set(current.widgets);
    if (on) set.add(id);
    else set.delete(id);
    onChange({
      widgets: ADMIN_HOME_WIDGETS.map((w) => w.id).filter((w) => set.has(w)),
      pins: current.pins,
    });
  };

  const togglePin = (id: AdminHomePinId, on: boolean) => {
    const set = new Set(current.pins);
    if (on) set.add(id);
    else set.delete(id);
    onChange({
      widgets: current.widgets,
      pins: ADMIN_HOME_PINS.map((p) => p.id).filter((p) => set.has(p)),
    });
  };

  const applyPreset = (id: AdminHomePresetId) => {
    const preset = ADMIN_HOME_PRESETS[id];
    const nextWidgets = preset.widgets.filter((w) => {
      const def = ADMIN_HOME_WIDGETS.find((d) => d.id === w);
      return def ? adminHomeItemAllowed(def, permStrs, enabled) : false;
    });
    const nextPins = preset.pins.filter((p) => {
      const def = ADMIN_HOME_PINS.find((d) => d.id === p);
      return def ? adminHomeItemAllowed(def, permStrs, enabled) : false;
    });
    onChange({ widgets: nextWidgets, pins: nextPins });
  };

  return (
    <div className="card flex max-h-[70vh] flex-col !p-0 sm:!p-0 md:max-h-none">
      <div className="shrink-0 space-y-3 border-b border-slate-800 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white sm:text-base">
            Настройка главного экрана
          </h2>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs md:hidden"
            onClick={onReset}
          >
            Как у всех
          </button>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3">
          {PRESET_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs"
              onClick={() => applyPreset(id)}
            >
              {ADMIN_HOME_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 sm:px-4 md:overflow-visible">
        <section>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Данные
          </p>
          <div className="md:grid md:grid-cols-2 md:gap-x-4">
            {widgets.map((w) => (
              <ToggleRow
                key={w.id}
                label={w.label}
                checked={current.widgets.includes(w.id)}
                onChange={(on) => toggleWidget(w.id, on)}
              />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Задачи
          </p>
          <div className="md:grid md:grid-cols-2 md:gap-x-4">
            {taskPins.map((p) => (
              <ToggleRow
                key={p.id}
                label={p.label}
                nested={p.nested}
                checked={current.pins.includes(p.id)}
                onChange={(on) => togglePin(p.id, on)}
              />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Разделы
          </p>
          <div className="md:grid md:grid-cols-2 md:gap-x-4">
            {navPins.map((p) => (
              <ToggleRow
                key={p.id}
                label={p.label}
                checked={current.pins.includes(p.id)}
                onChange={(on) => togglePin(p.id, on)}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-800 px-3 py-3 sm:px-4">
        <button
          type="button"
          className="btn-secondary hidden !px-3 !py-1.5 text-xs md:inline-flex"
          onClick={onReset}
        >
          Как у всех
        </button>
        <button
          type="button"
          className="btn-primary flex-1 !px-3 !py-2 text-sm md:flex-none md:!py-1.5 md:text-xs"
          onClick={onClose}
        >
          Готово
        </button>
      </div>
    </div>
  );
}
