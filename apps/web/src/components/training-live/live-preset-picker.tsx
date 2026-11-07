'use client';

import { ResponsiveSheet } from '@fitgo/forma-ui';
import { buildPreset, BUILTIN_PRESET_CARDS, REST_QUICK_SEC } from '@/lib/training-timer';
import type { BuiltPreset, PresetBuildInput } from '@/lib/training-timer';

export function LivePresetPicker({
  open,
  onOpenChange,
  onPick,
  personal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (preset: BuiltPreset) => void;
  personal?: Array<{ id: string; name: string; phases: BuiltPreset['phases'] }>;
}) {
  const pick = (input: PresetBuildInput) => {
    onPick(buildPreset(input));
    onOpenChange(false);
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Пресет таймера"
      description="Встроенные режимы и ваши шаблоны"
      desktop="dialog"
    >
      <div className="space-y-4 pb-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Быстрый отдых
          </p>
          <div className="flex flex-wrap gap-2">
            {REST_QUICK_SEC.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => pick({ id: 'rest', params: { durationSec: sec } })}
                className="rounded-2xl border border-white/10 bg-ink-raised px-3 py-2 text-sm text-zinc-200"
              >
                {sec} с
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {BUILTIN_PRESET_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => pick(card.defaultInput)}
              className="rounded-2xl border border-white/10 bg-ink-elevated px-3 py-3 text-left transition hover:border-forma-500/40"
            >
              <p className="text-sm font-semibold text-white">{card.title}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{card.subtitle}</p>
            </button>
          ))}
        </div>

        {personal && personal.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Мои пресеты
            </p>
            <div className="space-y-2">
              {personal.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPick({ id: p.id, name: p.name, phases: p.phases });
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-ink-raised px-3 py-3 text-left"
                >
                  <span className="text-sm font-medium text-zinc-100">{p.name}</span>
                  <span className="text-xs text-zinc-500">
                    {p.phases.length} фаз
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </ResponsiveSheet>
  );
}
