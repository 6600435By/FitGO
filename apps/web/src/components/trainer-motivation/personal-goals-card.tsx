'use client';

import type {
  TrainerGoalMetric,
  TrainerPersonalGoalInput,
  TrainerPersonalGoalProgress,
  TrainerPersonalGoalsResponse,
} from '@fitgo/shared-types';
import {
  TRAINER_GOAL_METRIC_LABELS,
  TRAINER_GOAL_METRICS,
} from '@fitgo/shared-types';
import { BentoCard, ProgressRing, ResponsiveSheet } from '@fitgo/forma-ui';
import { Target } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

function formatGoalValue(g: TrainerPersonalGoalProgress): string {
  if (g.unit === 'money_minor') {
    return `${(g.current / 100).toLocaleString('ru-RU', {
      maximumFractionDigits: 0,
    })} / ${(g.target / 100).toLocaleString('ru-RU', {
      maximumFractionDigits: 0,
    })}`;
  }
  return `${g.current} / ${g.target}`;
}

export function PersonalGoalsCard({
  data,
  onEdit,
}: {
  data: TrainerPersonalGoalsResponse | null;
  onEdit?: () => void;
}) {
  if (!data) return null;
  if (data.goals.length === 0) {
    return (
      <BentoCard title="Мои цели">
        <p className="text-sm text-zinc-400">
          Поставьте себе личные цели
        </p>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="mt-3 inline-flex items-center gap-1.5 rounded-2xl border border-forma-500/40 px-3 py-2 text-sm text-forma-300"
          >
            <Target className="h-4 w-4" />
            Поставить себе цель
          </button>
        ) : (
          <Link
            href="/trainer/profile"
            className="mt-3 inline-flex items-center gap-1.5 rounded-2xl border border-forma-500/40 px-3 py-2 text-sm text-forma-300"
          >
            <Target className="h-4 w-4" />
            Поставить себе цель
          </Link>
        )}
      </BentoCard>
    );
  }

  return (
    <BentoCard
      title="Мои цели"
      action={
        onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-forma-400 hover:text-forma-300"
          >
            Изменить
          </button>
        ) : (
          <Link
            href="/trainer/profile"
            className="text-xs font-medium text-forma-400 hover:text-forma-300"
          >
            Изменить
          </Link>
        )
      }
    >
      <ul className="grid gap-3 sm:grid-cols-3">
        {data.goals.map((g) => (
          <li
            key={g.metric}
            className="flex flex-col items-center rounded-2xl border border-white/[0.06] bg-ink-raised/60 px-3 py-3 text-center"
          >
            <ProgressRing
              value={g.percent}
              max={100}
              size={72}
              stroke={6}
              accent="forma"
            >
              <span className="font-display text-sm font-semibold tabular-nums text-white">
                {Math.round(g.percent)}%
              </span>
            </ProgressRing>
            <p className="mt-2 text-[11px] uppercase tracking-wide text-zinc-500">
              {g.label}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-zinc-300">
              {formatGoalValue(g)}
              {g.unit === 'money_minor' ? ' BYN' : ''}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-zinc-600">Месяц {data.month}</p>
    </BentoCard>
  );
}

type DraftGoal = {
  metric: TrainerGoalMetric;
  /** Raw input text so the field can be fully cleared while editing. */
  targetText: string;
};

function targetToText(metric: TrainerGoalMetric, target: number): string {
  return metric === 'SALES_SUM' ? String(target / 100) : String(target);
}

function parseTargetText(
  metric: TrainerGoalMetric,
  raw: string,
): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (metric === 'SALES_SUM') {
    const minor = Math.round(n * 100);
    return minor >= 1 ? minor : null;
  }
  const count = Math.floor(n);
  return count >= 1 ? count : null;
}

function toDraftGoals(initial: TrainerPersonalGoalInput[]): DraftGoal[] {
  return initial.map((g) => ({
    metric: g.metric,
    targetText: targetToText(g.metric, g.target),
  }));
}

export function PersonalGoalsEditor({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TrainerPersonalGoalInput[];
  onSaved: (data: TrainerPersonalGoalsResponse) => void;
}) {
  const [draft, setDraft] = useState<DraftGoal[]>(() => toDraftGoals(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setDraft(toDraftGoals(initial));
  }, [open, initial]);

  const toggleMetric = (metric: TrainerGoalMetric) => {
    setDraft((prev) => {
      const exists = prev.find((g) => g.metric === metric);
      if (exists) return prev.filter((g) => g.metric !== metric);
      if (prev.length >= 3) return prev;
      const defaultText = metric === 'SALES_SUM' ? '500' : '20';
      return [...prev, { metric, targetText: defaultText }];
    });
  };

  const setTargetText = (metric: TrainerGoalMetric, raw: string) => {
    setDraft((prev) =>
      prev.map((g) => (g.metric === metric ? { ...g, targetText: raw } : g)),
    );
  };

  const save = async () => {
    const token = getToken();
    if (!token) return;

    const goals: TrainerPersonalGoalInput[] = [];
    for (const g of draft) {
      const target = parseTargetText(g.metric, g.targetText);
      if (target == null) {
        setError(
          `Укажите цель ≥ 1 для «${TRAINER_GOAL_METRIC_LABELS[g.metric]}»`,
        );
        return;
      }
      goals.push({ metric: g.metric, target });
    }

    setBusy(true);
    setError('');
    try {
      const data = await api.trainerPutMotivationGoals(token, goals);
      onSaved(data);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Личные цели"
      description="До 3 метрик на месяц. Пустой список — без мотивации."
    >
      <ul className="space-y-2">
        {TRAINER_GOAL_METRICS.map((metric) => {
          const selected = draft.find((g) => g.metric === metric);
          return (
            <li
              key={metric}
              className={cn(
                'rounded-2xl border px-3 py-2.5',
                selected
                  ? 'border-forma-500/40 bg-forma-500/10'
                  : 'border-white/10',
              )}
            >
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selected)}
                  onChange={() => toggleMetric(metric)}
                  disabled={!selected && draft.length >= 3}
                />
                {TRAINER_GOAL_METRIC_LABELS[metric]}
              </label>
              {selected ? (
                <label className="mt-2 block text-xs text-zinc-500">
                  Цель
                  {metric === 'SALES_SUM' ? ' (BYN)' : ''}
                  <input
                    type="number"
                    min={1}
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={selected.targetText}
                    onChange={(e) => setTargetText(metric, e.target.value)}
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="btn-primary mt-4 w-full disabled:opacity-50"
      >
        Сохранить
      </button>
    </ResponsiveSheet>
  );
}

export function usePersonalGoals(enabled: boolean) {
  const [data, setData] = useState<TrainerPersonalGoalsResponse | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) {
      setData(null);
      return;
    }
    const token = getToken();
    if (!token) return;
    try {
      const res = await api.trainerMotivationGoals(token);
      setData(res);
    } catch {
      setData({ goals: [], month: '' });
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data,
    setData,
    editorOpen,
    setEditorOpen,
    reload,
    initialInputs: (data?.goals ?? []).map((g) => ({
      metric: g.metric,
      target: g.target,
    })),
  };
}
