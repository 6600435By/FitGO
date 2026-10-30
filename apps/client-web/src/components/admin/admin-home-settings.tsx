'use client';

import {
  ADMIN_HOME_PANEL_PRESETS,
  ADMIN_HOME_PRESETS,
  ADMIN_HOME_SETTINGS_ZONES,
  adminHomeItemAllowed,
  adminHomePinDef,
  adminHomeWidgetDef,
  matchingAdminHomePreset,
  materializeAdminHomeLayout,
  normalizeAdminHomeWidgets,
  toggleAdminHomePin,
  toggleAdminHomeWidget,
  type AdminHomeLayoutValue,
  type AdminHomePinId,
  type AdminHomePresetId,
  type AdminHomeWidgetId,
  type AdminPermission,
  type ProductModuleKey,
} from '@fitgo/shared-types';
import { cn } from '@/lib/utils';

function ToggleRow({
  checked,
  label,
  hint,
  nested,
  count,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  nested?: boolean;
  count?: number;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-1 py-1.5 text-sm text-slate-200 hover:bg-slate-800/50',
        nested ? 'pl-5' : '',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 rounded border-slate-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span>{label}</span>
          {count != null ? (
            <span className="shrink-0 tabular-nums text-slate-500">{count}</span>
          ) : null}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function AdminHomeSettings({
  layout,
  permissions,
  isEnabled,
  taskCounts,
  onChange,
  onReset,
  onClose,
}: {
  layout: AdminHomeLayoutValue;
  permissions: AdminPermission[];
  isEnabled: (m: ProductModuleKey) => boolean;
  /** Live chip counts from dashboard (task pins only). */
  taskCounts?: Partial<Record<AdminHomePinId, number>>;
  onChange: (next: {
    widgets: AdminHomeWidgetId[];
    pins: AdminHomePinId[];
  }) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const materialized = materializeAdminHomeLayout(layout);
  const current = {
    widgets: normalizeAdminHomeWidgets(materialized.widgets),
    pins: materialized.pins,
  };
  const permStrs = permissions as string[];
  const enabled = (m: string) => isEnabled(m as ProductModuleKey);
  const activePreset = matchingAdminHomePreset(
    current.widgets,
    current.pins,
    permStrs,
    enabled,
  );

  const rowAllowed = (row: {
    kind: 'widget' | 'pin';
    id: AdminHomeWidgetId | AdminHomePinId;
  }) => {
    if (row.kind === 'widget') {
      const def = adminHomeWidgetDef(row.id as AdminHomeWidgetId);
      return def ? adminHomeItemAllowed(def, permStrs, enabled) : false;
    }
    const def = adminHomePinDef(row.id as AdminHomePinId);
    return def ? adminHomeItemAllowed(def, permStrs, enabled) : false;
  };

  const toggleWidget = (id: AdminHomeWidgetId, on: boolean) => {
    onChange({
      widgets: toggleAdminHomeWidget(current.widgets, id, on),
      pins: current.pins,
    });
  };

  const togglePin = (id: AdminHomePinId, on: boolean) => {
    onChange({
      widgets: current.widgets,
      pins: toggleAdminHomePin(current.pins, id, on),
    });
  };

  const applyPreset = (id: Exclude<AdminHomePresetId, 'all'>) => {
    const preset = ADMIN_HOME_PRESETS[id];
    const nextWidgets = preset.widgets.filter((w) => {
      const def = adminHomeWidgetDef(w);
      return def ? adminHomeItemAllowed(def, permStrs, enabled) : false;
    });
    const nextPins = preset.pins.filter((p) => {
      const def = adminHomePinDef(p);
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
        <p className="text-[11px] leading-snug text-slate-500">
          Галочки сразу сохраняются. «Как у всех» возвращает стандарт клуба.
        </p>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3">
          {ADMIN_HOME_PANEL_PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              className={cn(
                'btn-secondary shrink-0 !px-3 !py-1.5 text-xs',
                activePreset === id
                  ? '!border-fitgo-500/60 !bg-fitgo-500/15 !text-fitgo-200'
                  : '',
              )}
              onClick={() => applyPreset(id)}
            >
              {ADMIN_HOME_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3 sm:px-4 md:overflow-visible">
        {ADMIN_HOME_SETTINGS_ZONES.map((zone) => {
          const visibleGroups = zone.groups
            .map((group) => ({
              ...group,
              rows: group.rows.filter(rowAllowed),
            }))
            .filter((g) => g.rows.length > 0);
          if (visibleGroups.length === 0) return null;

          return (
            <section key={zone.id}>
              <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {zone.label}
              </p>
              {zone.hint ? (
                <p className="mb-2 text-[11px] leading-snug text-slate-500">
                  {zone.hint}
                </p>
              ) : (
                <div className="mb-1" />
              )}
              <div className="space-y-3">
                {visibleGroups.map((group, gi) => (
                  <div key={`${zone.id}-${group.label ?? gi}`}>
                    {group.label ? (
                      <p className="mb-1 text-xs font-medium text-slate-400">
                        {group.label}
                      </p>
                    ) : null}
                    <div className="space-y-0.5">
                      {group.rows.map((row) => {
                        if (row.kind === 'widget') {
                          const id = row.id as AdminHomeWidgetId;
                          const def = adminHomeWidgetDef(id)!;
                          return (
                            <ToggleRow
                              key={`w:${id}`}
                              label={def.label}
                              hint={def.hint}
                              nested={row.nested}
                              checked={current.widgets.includes(id)}
                              onChange={(on) => toggleWidget(id, on)}
                            />
                          );
                        }
                        const id = row.id as AdminHomePinId;
                        const def = adminHomePinDef(id)!;
                        const count =
                          def.kind === 'task' ? taskCounts?.[id] : undefined;
                        return (
                          <ToggleRow
                            key={`p:${id}`}
                            label={def.label}
                            hint={def.hint}
                            nested={row.nested ?? def.nested}
                            count={count}
                            checked={current.pins.includes(id)}
                            onChange={(on) => togglePin(id, on)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
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
