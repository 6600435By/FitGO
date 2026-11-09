'use client';

import { ResponsiveSheet, SegmentedControl } from '@fitgo/forma-ui';
import {
  ExternalLink,
  Flag,
  MoreHorizontal,
  NotebookPen,
  Timer as TimerIcon,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildPreset,
  formatTimerMs,
  useTrainingTimer,
  type TimerSessionMeta,
} from '@/lib/training-timer';
import { cn } from '@/lib/utils';
import {
  BasicTimerPanel,
  startRestPreset,
} from './basic-timer-panel';
import { LiveBlockCard } from './live-block-card';
import { LiveGpRoster } from './live-gp-roster';
import {
  LivePtSessionChrome,
  useLivePtSheet,
} from './live-pt-session-chrome';
import { LiveSessionSteps } from './live-session-steps';
import { useLiveMode, type LiveWorkMode } from './use-live-mode';
import { useSessionClock } from './use-session-clock';
import type { WorkoutSectionId } from '@fitgo/shared-types';
import { getSessionSectionIds } from '@fitgo/shared-types';

/** Accidental start can be undone without touching the booking in DB. */
const CANCEL_START_WINDOW_MS = 2 * 60 * 1000;

function sessionStorageKey(meta: TimerSessionMeta): string {
  if (meta.kind === 'pt' && meta.bookingId) return `pt:${meta.bookingId}`;
  if (meta.kind === 'gp' && meta.sessionKey) return `gp:${meta.sessionKey}`;
  return meta.kind;
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
  const initial = useMemo(() => buildPreset({ id: 'stopwatch' }), []);
  const timer = useTrainingTimer({
    meta,
    initialPreset: initial,
    mirrorOnly,
  });
  const liveMode = useLiveMode();
  const clockKey = sessionStorageKey(meta);
  const clock = useSessionClock(clockKey);
  const ptSheet = useLivePtSheet(
    !mirrorOnly && meta.kind === 'pt' ? meta.bookingId : undefined,
  );

  const [oneshotOpen, setOneshotOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<WorkoutSectionId | null>(
    null,
  );

  const showTimerUi =
    mirrorOnly || liveMode.mode === 'timer' || oneshotOpen;
  const sectionIds = useMemo(
    () =>
      meta.kind === 'pt' ? getSessionSectionIds(ptSheet.sheet) : [],
    [meta.kind, ptSheet.sheet],
  );
  const resolvedSection =
    activeSection && sectionIds.includes(activeSection)
      ? activeSection
      : sectionIds.find(
          (id) => !ptSheet.sheet.blockProgress?.[id]?.summarySaved,
        ) ??
        sectionIds[0] ??
        null;
  const hasBlocks = meta.kind === 'pt' && sectionIds.length > 0;
  const hasContent = hasBlocks && resolvedSection != null;

  useEffect(() => {
    if (mirrorOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (!showTimerUi) return;
      if (e.code === 'Space') {
        e.preventDefault();
        clock.markActive();
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
  }, [timer, mirrorOnly, showTimerUi, clock]);

  const onSetCompleted = useCallback(
    (restSec: number | undefined) => {
      clock.markActive();
      if (liveMode.mode !== 'timer' || !liveMode.autoRest) return;
      startRestPreset(
        timer.applyPreset,
        () => {
          clock.markActive();
          return timer.play();
        },
        restSec ?? 90,
      );
    },
    [clock, liveMode.mode, liveMode.autoRest, timer],
  );

  const timerControls = {
    state: timer.state,
    snapshot: timer.snapshot,
    flash: timer.flash,
    applyPreset: (preset: Parameters<typeof timer.applyPreset>[0]) => {
      clock.markActive();
      timer.applyPreset(preset);
    },
    toggle: async () => {
      clock.markActive();
      await timer.toggle();
    },
    reset: timer.reset,
    skip: timer.skip,
    bumpRest: timer.bumpRest,
    bumpOpen: timer.bumpOpen,
    patchPrefs: timer.patchPrefs,
  };

  const elapsedForFinish = Math.max(
    clock.elapsedMs,
    timer.snapshot.totalElapsedMs,
  );
  const canCancelStart =
    !mirrorOnly &&
    ((clock.isRunning && clock.elapsedMs < CANCEL_START_WINDOW_MS) ||
      (timer.state.status === 'running' &&
        timer.snapshot.totalElapsedMs < CANCEL_START_WINDOW_MS));

  const cancelAccidentalStart = () => {
    clock.clear();
    timer.reset();
    timer.endAndClear();
  };

  if (mirrorOnly) {
    return (
      <div className="relative flex min-h-dvh flex-col bg-[#070708] text-white">
        <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">
              Экран зала
              {timer.state.presetName ? ` · ${timer.state.presetName}` : ''}
            </p>
            <p className="truncate font-display text-lg font-semibold text-white">
              {meta.title || 'Тренировка'}
            </p>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center px-4 pb-8">
          <BasicTimerPanel timer={timerControls} />
        </div>
        <p className="px-4 pb-6 text-center text-xs text-zinc-600">
          Управление с основного окна
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#070708] text-white">
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            {meta.kind === 'gp' ? 'Группа' : 'ПТ'}
            {clock.isRunning
              ? ` · ${formatTimerMs(clock.elapsedMs, true)}`
              : ''}
          </p>
          <p className="truncate font-display text-lg font-semibold text-white">
            {meta.title || 'Тренировка'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {liveMode.hydrated ? (
            <SegmentedControl<LiveWorkMode>
              size="sm"
              layoutId="live-work-mode"
              options={[
                { value: 'free', label: 'Свободно' },
                { value: 'timer', label: 'Таймер' },
              ]}
              value={liveMode.mode}
              onChange={liveMode.setMode}
              className="hidden sm:flex"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-full border border-white/10 p-2 text-zinc-400"
            aria-label="Ещё"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          <Link
            href={meta.planHref || '/trainer'}
            className="rounded-full border border-white/10 p-2 text-zinc-400"
            aria-label="Закрыть"
            onClick={() => {
              if (timer.state.status === 'complete') {
                timer.endAndClear();
              }
            }}
          >
            <X className="h-5 w-5" />
          </Link>
        </div>
      </header>

      {liveMode.hydrated ? (
        <div className="px-4 pb-2 sm:hidden">
          <SegmentedControl<LiveWorkMode>
            size="sm"
            layoutId="live-work-mode-mobile"
            className="w-full"
            options={[
              { value: 'free', label: 'Свободно' },
              { value: 'timer', label: 'Таймер' },
            ]}
            value={liveMode.mode}
            onChange={liveMode.setMode}
          />
        </div>
      ) : null}

      {hasBlocks && resolvedSection ? (
        <div className="px-4 pb-2">
          <LiveSessionSteps
            sheet={ptSheet.sheet}
            activeId={resolvedSection}
            onSelect={setActiveSection}
          />
        </div>
      ) : null}

      <div
        className={cn(
          'flex flex-1 flex-col gap-4 px-4 pb-4',
          liveMode.mode === 'timer' && hasContent
            ? 'lg:flex-row lg:items-start lg:gap-8 lg:px-8'
            : '',
        )}
      >
        {hasContent && resolvedSection ? (
          <div
            className={cn(
              'flex-1',
              liveMode.mode === 'timer' ? 'lg:max-w-md' : 'mx-auto w-full',
            )}
          >
            <LiveBlockCard
              sheet={ptSheet.sheet}
              sectionId={resolvedSection}
              onChangeSheet={ptSheet.setSheet}
              onSetCompleted={onSetCompleted}
              onAdvance={() => {
                const ids = getSessionSectionIds(ptSheet.sheet);
                const idx = ids.indexOf(resolvedSection);
                const next =
                  ids.slice(idx + 1).find(
                    (id) => !ptSheet.sheet.blockProgress?.[id]?.summarySaved,
                  ) ?? null;
                if (next) setActiveSection(next);
              }}
            />
          </div>
        ) : null}

        {liveMode.mode === 'timer' ? (
          <div
            className={cn(
              'flex flex-1 flex-col items-center justify-center',
              hasContent ? 'lg:pt-2' : 'min-h-[50dvh]',
            )}
          >
            <BasicTimerPanel
              timer={timerControls}
              compact={hasContent}
              showAutoRest={hasContent}
              autoRest={liveMode.autoRest}
              onAutoRestChange={liveMode.setAutoRest}
            />
          </div>
        ) : !hasContent ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <p className="font-display text-2xl font-semibold text-white">
              Тренировка идёт
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-forma-400">
              {formatTimerMs(clock.elapsedMs, true)}
            </p>
            <p className="mt-3 max-w-xs text-sm text-zinc-500">
              Свободный режим — заметка и RPE в конце. Таймер можно открыть
              кнопкой внизу или переключателем сверху.
            </p>
            {!clock.isRunning ? (
              <button
                type="button"
                onClick={() => clock.markActive()}
                className="mt-6 rounded-2xl bg-forma-500 px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Начать
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {meta.kind === 'pt' && meta.bookingId ? (
        <LivePtSessionChrome
          bookingId={meta.bookingId}
          clientId={meta.clientId}
          elapsedMs={elapsedForFinish}
          sheet={ptSheet.sheet}
          setSheet={ptSheet.setSheet}
          hideActionButtons
          notesOpen={notesOpen}
          onNotesOpenChange={setNotesOpen}
          finishOpen={finishOpen}
          onFinishOpenChange={setFinishOpen}
          onFinished={() => {
            clock.clear();
            timer.endAndClear();
          }}
        />
      ) : null}

      {meta.kind === 'gp' && meta.sessionKey ? (
        <LiveGpRoster sessionKey={meta.sessionKey} title={meta.title} />
      ) : null}

      <footer className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        {canCancelStart ? (
          <button
            type="button"
            onClick={cancelAccidentalStart}
            className="mx-auto block w-full max-w-sm rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm font-medium text-rose-300"
          >
            Отменить начало
          </button>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {liveMode.mode === 'free' ? (
            <button
              type="button"
              onClick={() => {
                clock.markActive();
                setOneshotOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
            >
              <TimerIcon className="h-4 w-4 text-forma-400" />
              Таймер
            </button>
          ) : null}
          {meta.kind === 'pt' ? (
            <>
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
              >
                <NotebookPen className="h-4 w-4 text-forma-400" />
                Заметка
              </button>
              <button
                type="button"
                onClick={() => {
                  clock.markActive();
                  setFinishOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-forma-500 px-3 py-2 text-sm font-semibold text-ink"
              >
                <Flag className="h-4 w-4" />
                Завершить
              </button>
            </>
          ) : null}
          {meta.planHref ? (
            <Link
              href={meta.planHref}
              className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
            >
              План
            </Link>
          ) : null}
        </div>
      </footer>

      <ResponsiveSheet
        open={oneshotOpen}
        onOpenChange={setOneshotOpen}
        title="Таймер"
        description="Разовый инструмент — закрытие не меняет режим «Свободно»"
      >
        <BasicTimerPanel timer={timerControls} compact />
      </ResponsiveSheet>

      <ResponsiveSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Ещё"
      >
        <div className="space-y-2">
          <Link
            href={hallHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-3 text-sm text-zinc-200"
            onClick={() => setMenuOpen(false)}
          >
            <ExternalLink className="h-4 w-4 text-forma-400" />
            Экран для зала
          </Link>
          {meta.planHref ? (
            <Link
              href={meta.planHref}
              className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-3 text-sm text-zinc-200"
              onClick={() => setMenuOpen(false)}
            >
              Открыть план
            </Link>
          ) : null}
        </div>
      </ResponsiveSheet>
    </div>
  );
}
