'use client';

import { ProgressRing } from '@fitgo/forma-ui';
import {
  ExternalLink,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPreset,
  formatTimerMs,
  phaseAccent,
  useTrainingTimer,
  type BuiltPreset,
  type SoundPackId,
  type TimerEvent,
  type TimerPersistedState,
  type TimerPhase,
  type TimerSessionMeta,
} from '@/lib/training-timer';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { LiveGpRoster } from './live-gp-roster';
import { LivePresetPicker } from './live-preset-picker';
import {
  LivePtSessionChrome,
  type LiveTimerFactHandler,
} from './live-pt-session-chrome';

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
    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
      {workPhases.map(({ i }, idx) => {
        const done = i < phaseIndex;
        const current = i === phaseIndex;
        return (
          <span
            key={`${i}-${idx}`}
            className={cn(
              'h-2 w-2 rounded-full',
              done && 'bg-forma-500',
              current && 'bg-white scale-125',
              !done && !current && 'bg-white/20',
            )}
          />
        );
      })}
    </div>
  );
}

export function LiveTimerScreen({
  meta,
  mirrorOnly = false,
  hallHref = '/trainer/live/hall',
}: {
  meta: TimerSessionMeta;
  mirrorOnly?: boolean;
  hallHref?: string;
}) {
  const reduceMotion = useReducedMotion();
  const initial = useMemo(() => buildPreset({ id: 'tabata' }), []);
  const factHandlerRef = useRef<LiveTimerFactHandler | null>(null);
  const onEvents = useCallback((events: TimerEvent[], state: TimerPersistedState) => {
    factHandlerRef.current?.(events, state);
  }, []);
  const timer = useTrainingTimer({
    meta,
    initialPreset: initial,
    mirrorOnly,
    onEvents: mirrorOnly ? undefined : onEvents,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [personal, setPersonal] = useState<
    Array<{ id: string; name: string; phases: BuiltPreset['phases'] }>
  >([]);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const seedCircuitFromSheet = useCallback(
    (preset: BuiltPreset) => {
      if (timer.state.status !== 'idle') return;
      if (timer.state.presetId !== 'tabata') return;
      timer.applyPreset(preset);
    },
    [timer.applyPreset, timer.state.presetId, timer.state.status],
  );

  useEffect(() => {
    if (mirrorOnly) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    api
      .trainerTimerPresets(token)
      .then((rows) => {
        if (cancelled) return;
        setPersonal(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            phases: r.phases as BuiltPreset['phases'],
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mirrorOnly]);

  useEffect(() => {
    if (mirrorOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        void timer.toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        timer.skip();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        timer.prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timer, mirrorOnly]);

  const accent = phaseAccent(timer.snapshot.phase?.kind);
  const accentColor = ACCENT[accent];
  const ms = displayMs(timer.snapshot);
  const progressValue =
    timer.snapshot.isOpenPhase
      ? 0
      : Math.round((1 - (timer.snapshot.phaseProgress || 0)) * 1000) / 10;

  const ringSize =
    typeof window !== 'undefined' && window.innerWidth >= 768 ? 320 : 260;

  return (
    <div
      className={cn(
        'relative flex min-h-dvh flex-col bg-[#070708] text-white',
        timer.flash && !reduceMotion && 'animate-[pulse_0.28s_ease-out]',
      )}
      style={
        timer.flash && !reduceMotion
          ? { boxShadow: `inset 0 0 80px ${accentColor}55` }
          : undefined
      }
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            {meta.kind === 'gp' ? 'Группа' : meta.kind === 'hall' ? 'Экран зала' : 'ПТ'}
            {timer.state.presetName ? ` · ${timer.state.presetName}` : ''}
          </p>
          <p className="truncate font-display text-lg font-semibold text-white">
            {meta.title || 'Тренировка'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!mirrorOnly ? (
            <Link
              href={hallHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300"
              title="Экран для зала"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Зал
            </Link>
          ) : null}
          <Link
            href={meta.planHref || '/trainer'}
            className="rounded-full border border-white/10 p-2 text-zinc-400"
            aria-label="Закрыть"
            onClick={() => {
              if (!mirrorOnly && timer.state.status === 'complete') {
                timer.endAndClear();
              }
            }}
          >
            <X className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row lg:items-stretch lg:gap-8 lg:px-8">
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-6 lg:pb-8">
          <p
            className="mb-3 text-sm font-medium"
            style={{ color: accentColor }}
          >
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
              stroke={10}
              accent="forma"
              className="[&_circle:last-child]:transition-none"
            >
              <div className="flex flex-col items-center">
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={`${timer.snapshot.phaseIndex}-${Math.floor(ms / 1000)}`}
                    initial={reduceMotion ? false : { opacity: 0.5, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-display text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl"
                    style={{
                      color: accentColor,
                      textShadow: timer.snapshot.isLastThreeSec
                        ? `0 0 24px ${accentColor}66`
                        : undefined,
                    }}
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
                  {timer.wakeLockActive ? ' · экран' : ''}
                </span>
              </div>
            </ProgressRing>
          </motion.div>

          <RoundDots
            phases={timer.state.phases}
            phaseIndex={timer.snapshot.phaseIndex}
          />

          {timer.snapshot.nextPhase ? (
            <p className="mt-3 text-sm text-zinc-500">
              Далее: {timer.snapshot.nextPhase.label}
              {timer.snapshot.nextPhase.durationSec != null
                ? ` · ${timer.snapshot.nextPhase.durationSec} с`
                : ''}
            </p>
          ) : null}

          {timer.state.presetId === 'amrap' ? (
            <div className="mt-4 flex items-center gap-3">
              <span className="text-sm text-zinc-400">Раунды</span>
              <span className="font-display text-3xl font-semibold text-forma-400">
                {timer.state.amrapRounds}
              </span>
              {!mirrorOnly ? (
                <button
                  type="button"
                  onClick={timer.amrapPlus}
                  className="rounded-2xl bg-forma-500 px-3 py-2 text-sm font-semibold text-ink"
                >
                  + раунд
                </button>
              ) : null}
            </div>
          ) : null}

          {timer.state.status === 'complete' && !reduceMotion ? (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 text-sm text-forma-400"
            >
              Интервал завершён ·{' '}
              {formatTimerMs(timer.snapshot.totalElapsedMs)}
            </motion.p>
          ) : null}
        </div>

        {!mirrorOnly ? (
          <aside className="hidden w-full max-w-md flex-col justify-center border-l border-white/5 px-6 py-8 lg:flex">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              План и заметки
            </p>
            <p className="mt-2 font-display text-xl font-semibold text-white">
              {meta.title || 'Тренировка'}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Заметки для клиента, личные и задание — кнопка «Заметка». Итог с
              RPE — «Завершить».
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {meta.planHref ? (
                <Link
                  href={meta.planHref}
                  className="rounded-2xl bg-forma-500 px-4 py-3 text-center text-sm font-semibold text-ink"
                >
                  Открыть план
                </Link>
              ) : null}
              <Link
                href={hallHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 px-4 py-3 text-center text-sm text-zinc-300"
              >
                Экран для зала
              </Link>
            </div>
          </aside>
        ) : null}
      </div>

      {!mirrorOnly && meta.kind === 'pt' && meta.bookingId ? (
        <LivePtSessionChrome
          bookingId={meta.bookingId}
          clientId={meta.clientId}
          elapsedMs={timer.snapshot.totalElapsedMs}
          applyPreset={seedCircuitFromSheet}
          factHandlerRef={factHandlerRef}
        />
      ) : null}

      {!mirrorOnly && meta.kind === 'gp' && meta.sessionKey ? (
        <LiveGpRoster sessionKey={meta.sessionKey} title={meta.title} />
      ) : null}

      {!mirrorOnly ? (
        <footer className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          {(timer.state.presetId === 'rest' ||
            timer.snapshot.phase?.kind === 'rest' ||
            timer.snapshot.phase?.kind === 'roundRest') && (
            <div className="flex justify-center gap-2">
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
          )}

          {timer.snapshot.isOpenPhase ? (
            <div className="flex justify-center gap-2">
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

          <div className="flex items-center justify-center gap-3">
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
              className="flex h-16 w-16 items-center justify-center rounded-full bg-forma-500 text-ink shadow-lg shadow-forma-500/20"
              aria-label={timer.state.status === 'running' ? 'Пауза' : 'Старт'}
            >
              {timer.state.status === 'running' ? (
                <Pause className="h-7 w-7" />
              ) : (
                <Play className="h-7 w-7 pl-0.5" />
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

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
            >
              Пресет
            </button>
            <button
              type="button"
              onClick={() => setPrefsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
            >
              {timer.state.soundEnabled ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4" />
              )}
              Звук
            </button>
            {meta.planHref ? (
              <Link
                href={meta.planHref}
                className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
              >
                План
              </Link>
            ) : null}
          </div>

          {prefsOpen ? (
            <div className="rounded-2xl border border-white/10 bg-ink-elevated p-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['classic', 'Классика'],
                    ['gong', 'Гонг'],
                    ['whistle', 'Свисток'],
                  ] as Array<[SoundPackId, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => timer.setSoundPack(id)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs',
                      timer.state.soundPack === id
                        ? 'bg-forma-500 text-ink'
                        : 'bg-white/5 text-zinc-400',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-400">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={timer.state.soundEnabled}
                    onChange={(e) =>
                      timer.patchPrefs({ soundEnabled: e.target.checked })
                    }
                  />
                  Звук
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={timer.state.voiceEnabled}
                    onChange={(e) =>
                      timer.patchPrefs({ voiceEnabled: e.target.checked })
                    }
                  />
                  Голос
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={timer.state.vibrateEnabled}
                    onChange={(e) =>
                      timer.patchPrefs({ vibrateEnabled: e.target.checked })
                    }
                  />
                  Вибрация
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                Громкость
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={timer.state.volume}
                  onChange={(e) =>
                    timer.patchPrefs({ volume: Number(e.target.value) })
                  }
                  className="flex-1"
                />
              </label>
              <button
                type="button"
                className="mt-3 w-full rounded-2xl border border-white/10 py-2 text-xs text-zinc-300"
                onClick={async () => {
                  const token = getToken();
                  if (!token) return;
                  const name =
                    window.prompt('Название пресета', timer.state.presetName) ||
                    '';
                  if (!name.trim()) return;
                  try {
                    const created = await api.trainerCreateTimerPreset(token, {
                      name: name.trim(),
                      phases: timer.state.phases,
                      soundPack: timer.state.soundPack,
                    });
                    setPersonal((prev) => [
                      {
                        id: created.id,
                        name: name.trim(),
                        phases: timer.state.phases,
                      },
                      ...prev,
                    ]);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Сохранить как мой пресет
              </button>
            </div>
          ) : null}
        </footer>
      ) : (
        <p className="px-4 pb-6 text-center text-xs text-zinc-600">
          Управление с основного окна · пробел — пауза · стрелки — фаза вперёд /
          назад
        </p>
      )}

      <LivePresetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={timer.applyPreset}
        personal={personal}
      />
    </div>
  );
}
