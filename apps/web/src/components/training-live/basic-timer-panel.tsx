'use client';

import { ProgressRing, SegmentedControl } from '@fitgo/forma-ui';
import {
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import {
  buildPreset,
  DEFAULT_INTERVAL_PARAMS,
  formatTimerMs,
  phaseAccent,
  REST_QUICK_SEC,
  type BasicPresetId,
  type BuiltPreset,
  type IntervalPresetParams,
  type TimerPersistedState,
  type TimerPhase,
  type TimerSnapshot,
} from '@/lib/training-timer';
import { cn } from '@/lib/utils';

const ACCENT: Record<ReturnType<typeof phaseAccent>, string> = {
  work: '#ffd000',
  rest: '#22d3ee',
  prep: '#f4f4f5',
};

function displayMs(snapshot: {
  isOpenPhase: boolean;
  remainingMs: number | null;
  elapsedMs: number;
}): number {
  if (snapshot.isOpenPhase) return snapshot.elapsedMs;
  return snapshot.remainingMs ?? 0;
}

function RoundDots({
  phases,
  phaseIndex,
}: {
  phases: TimerPhase[];
  phaseIndex: number;
}) {
  const workPhases = phases
    .map((p, i) => ({ p, i }))
    .filter((x) => x.p.kind === 'work');
  if (workPhases.length <= 1 || workPhases.length > 16) return null;
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {workPhases.map(({ i }, idx) => {
        const done = i < phaseIndex;
        const current = i === phaseIndex;
        return (
          <span
            key={`${i}-${idx}`}
            className={cn(
              'h-2 w-2 rounded-full',
              done && 'bg-forma-500',
              current && 'scale-125 bg-white',
              !done && !current && 'bg-white/20',
            )}
          />
        );
      })}
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`− ${label}`}
          onClick={() => onChange(Math.max(min, value - step))}
          className="rounded-full border border-white/10 p-2 text-zinc-300"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[3rem] text-center font-display text-lg font-semibold tabular-nums text-white">
          {value}
          {suffix ? (
            <span className="ml-0.5 text-xs font-normal text-zinc-500">
              {suffix}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          aria-label={`+ ${label}`}
          onClick={() => onChange(Math.min(max, value + step))}
          className="rounded-full border border-white/10 p-2 text-zinc-300"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export type BasicTimerControls = {
  state: TimerPersistedState;
  snapshot: TimerSnapshot;
  flash: boolean;
  applyPreset: (preset: BuiltPreset) => void;
  toggle: () => void | Promise<void>;
  reset: () => void;
  skip: () => void;
  bumpRest: (deltaSec: number) => void;
  bumpOpen: (deltaSec: number) => void;
  patchPrefs: (patch: Partial<Pick<TimerPersistedState, 'soundEnabled' | 'vibrateEnabled'>>) => void;
};

export function BasicTimerPanel({
  timer,
  compact = false,
  showAutoRest,
  autoRest,
  onAutoRestChange,
}: {
  timer: BasicTimerControls;
  compact?: boolean;
  showAutoRest?: boolean;
  autoRest?: boolean;
  onAutoRestChange?: (v: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const mode: BasicPresetId = useMemo(() => {
    const id = timer.state.presetId;
    if (id === 'rest' || id === 'intervals') return id;
    return 'stopwatch';
  }, [timer.state.presetId]);

  const [intervalParams, setIntervalParams] = useState<IntervalPresetParams>(
    DEFAULT_INTERVAL_PARAMS,
  );
  const [restSec, setRestSec] = useState(60);

  const accent = phaseAccent(timer.snapshot.phase?.kind);
  const accentColor = ACCENT[accent];
  const ms = displayMs(timer.snapshot);
  const progressValue =
    timer.snapshot.isOpenPhase
      ? 0
      : Math.round((1 - (timer.snapshot.phaseProgress || 0)) * 1000) / 10;
  const ringSize = compact ? 200 : 260;

  const applyMode = (next: BasicPresetId) => {
    if (next === 'stopwatch') {
      timer.applyPreset(buildPreset({ id: 'stopwatch' }));
      return;
    }
    if (next === 'rest') {
      timer.applyPreset(
        buildPreset({ id: 'rest', params: { durationSec: restSec } }),
      );
      return;
    }
    timer.applyPreset(
      buildPreset({ id: 'intervals', params: { ...intervalParams } }),
    );
  };

  const applyRestDuration = (sec: number) => {
    setRestSec(sec);
    timer.applyPreset(
      buildPreset({ id: 'rest', params: { durationSec: sec } }),
    );
  };

  const applyIntervals = (patch: Partial<IntervalPresetParams>) => {
    const next = { ...intervalParams, ...patch };
    setIntervalParams(next);
    timer.applyPreset(buildPreset({ id: 'intervals', params: next }));
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center',
        timer.flash && !reduceMotion && 'animate-[pulse_0.28s_ease-out]',
      )}
      style={
        timer.flash && !reduceMotion
          ? { boxShadow: `inset 0 0 60px ${accentColor}44` }
          : undefined
      }
    >
      <SegmentedControl<BasicPresetId>
        size="sm"
        layoutId="basic-timer-mode"
        className="mb-4 w-full max-w-sm"
        options={[
          { value: 'stopwatch', label: 'Секундомер' },
          { value: 'rest', label: 'Отдых' },
          { value: 'intervals', label: 'Интервалы' },
        ]}
        value={mode}
        onChange={applyMode}
      />

      <p className="mb-2 text-sm font-medium" style={{ color: accentColor }}>
        {timer.snapshot.phase?.label || '—'}
      </p>

      <motion.div
        animate={
          timer.snapshot.isLastThreeSec && !reduceMotion
            ? { scale: [1, 1.04, 1] }
            : { scale: 1 }
        }
        transition={{
          repeat: timer.snapshot.isLastThreeSec ? Infinity : 0,
          duration: 0.7,
        }}
      >
        <ProgressRing
          value={timer.snapshot.isOpenPhase ? 0 : progressValue}
          max={100}
          size={ringSize}
          stroke={compact ? 8 : 10}
          accent="forma"
          className="[&_circle:last-child]:transition-none"
        >
          <div className="flex flex-col items-center">
            <AnimatePresence mode="popLayout">
              <motion.span
                key={`${timer.snapshot.phaseIndex}-${Math.floor(ms / 1000)}`}
                initial={reduceMotion ? false : { opacity: 0.5, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'font-display font-semibold tabular-nums tracking-tight',
                  compact ? 'text-4xl' : 'text-5xl sm:text-6xl',
                )}
                style={{ color: accentColor }}
              >
                {formatTimerMs(ms)}
              </motion.span>
            </AnimatePresence>
            <span className="mt-1 text-xs text-zinc-500">
              {timer.state.status === 'running'
                ? 'идёт'
                : timer.state.status === 'paused'
                  ? 'пауза'
                  : timer.state.status === 'complete'
                    ? 'готово'
                    : 'ожидание'}
            </span>
          </div>
        </ProgressRing>
      </motion.div>

      <RoundDots
        phases={timer.state.phases}
        phaseIndex={timer.snapshot.phaseIndex}
      />

      {mode === 'rest' && timer.state.status === 'idle' ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {REST_QUICK_SEC.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => applyRestDuration(sec)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs',
                restSec === sec
                  ? 'bg-forma-500 text-ink'
                  : 'border border-white/10 text-zinc-300',
              )}
            >
              {sec} с
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'intervals' && timer.state.status === 'idle' ? (
        <div className="mt-4 flex flex-wrap justify-center gap-6">
          <Stepper
            label="Работа"
            value={intervalParams.workSec}
            min={5}
            max={300}
            step={5}
            suffix="с"
            onChange={(workSec) => applyIntervals({ workSec })}
          />
          <Stepper
            label="Отдых"
            value={intervalParams.restSec}
            min={0}
            max={180}
            step={5}
            suffix="с"
            onChange={(rest) => applyIntervals({ restSec: rest })}
          />
          <Stepper
            label="Раунды"
            value={intervalParams.rounds}
            min={1}
            max={30}
            onChange={(rounds) => applyIntervals({ rounds })}
          />
        </div>
      ) : null}

      {(mode === 'rest' ||
        timer.snapshot.phase?.kind === 'rest' ||
        timer.snapshot.phase?.kind === 'roundRest') &&
      timer.state.status !== 'idle' ? (
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => timer.bumpRest(-15)}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300"
          >
            <Minus className="h-3.5 w-3.5" /> 15 с
          </button>
          <button
            type="button"
            onClick={() => timer.bumpRest(15)}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" /> 15 с
          </button>
        </div>
      ) : null}

      {timer.snapshot.isOpenPhase && timer.state.status !== 'idle' ? (
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => timer.bumpOpen(-15)}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300"
          >
            <Minus className="h-3.5 w-3.5" /> 15 с
          </button>
          <button
            type="button"
            onClick={() => timer.bumpOpen(15)}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" /> 15 с
          </button>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={timer.reset}
          className="rounded-full border border-white/10 p-3 text-zinc-400"
          aria-label="Сброс"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => void timer.toggle()}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-forma-500 text-ink shadow-lg shadow-forma-500/20"
          aria-label={timer.state.status === 'running' ? 'Пауза' : 'Старт'}
        >
          {timer.state.status === 'running' ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6 pl-0.5" />
          )}
        </button>
        <button
          type="button"
          onClick={timer.skip}
          className="rounded-full border border-white/10 p-3 text-zinc-400"
          aria-label="Следующая фаза"
        >
          <SkipForward className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() =>
            timer.patchPrefs({
              soundEnabled: !timer.state.soundEnabled,
              vibrateEnabled: !timer.state.soundEnabled,
            })
          }
          className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
        >
          {timer.state.soundEnabled ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
          Звук
        </button>
        {showAutoRest ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={Boolean(autoRest)}
              onChange={(e) => onAutoRestChange?.(e.target.checked)}
            />
            Авто-отдых
          </label>
        ) : null}
      </div>
    </div>
  );
}

/** Start a rest countdown from outside (auto-rest after a set). */
export function startRestPreset(
  applyPreset: (preset: BuiltPreset) => void,
  play: () => void | Promise<void>,
  durationSec: number,
): void {
  applyPreset(
    buildPreset({
      id: 'rest',
      params: { durationSec: Math.max(5, durationSec) },
    }),
  );
  window.setTimeout(() => {
    void play();
  }, 50);
}
