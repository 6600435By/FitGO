'use client';

import type {
  CircuitHistoryPoint,
  PrepSectionId,
  WorkoutMainBlock,
  WorkoutSectionId,
  WorkoutSheet,
} from '@fitgo/shared-types';
import {
  CARDIO_DEFAULT_FIELDS,
  COOLDOWN_DEFAULT_FIELDS,
  MOBILITY_DEFAULT_FIELDS,
  STRENGTH_DEFAULT_SET_FIELDS,
  WARMUP_DEFAULT_FIELDS,
  WORKOUT_SECTION_LABELS,
  WORKOUT_SESSION_FORMATS,
  applyWorkoutSessionFormat,
  completeWorkoutSection,
  createDefaultCircuit,
  detectWorkoutSessionFormat,
  ensureCircuitRoundLogs,
  getPrepSections,
  getSessionSectionIds,
  getWorkoutBlocks,
  reopenWorkoutSection,
  saveBlockSummary,
  summarizeWorkoutSession,
  togglePrepSection,
  toggleWorkoutBlock,
  updateSectionSummaryNote,
} from '@fitgo/shared-types';
import { Chip } from '@fitgo/forma-ui';
import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { CardioBlockEditor } from './cardio-block-editor';
import { CircuitBlockEditor } from './circuit-block-editor';
import { CircuitDynamics } from './circuit-dynamics';
import { MobilityBlockEditor } from './mobility-block-editor';
import { PrepBlockEditor } from './prep-block-editor';
import { StrengthBlockEditor } from './strength-block-editor';
import { WorkoutFormaLayout } from './workout-forma-timeline';
import { WorkoutSectionCard } from './workout-section-card';
import { WorkoutSessionFactStrip } from './workout-session-fact-strip';

const MAIN_BLOCK_LABELS: Record<WorkoutMainBlock, string> = {
  strength: 'Силовая',
  cardio: 'Кардио',
  circuit: 'Круговая',
  mobility: 'Биомеханика',
};

type SessionBlockToggle = PrepSectionId | WorkoutMainBlock;

const SESSION_BLOCK_ORDER: SessionBlockToggle[] = [
  'warmup',
  'cooldown',
  'strength',
  'cardio',
  'circuit',
  'mobility',
];

function NumberInput({
  value,
  onChange,
  readOnly,
  placeholder,
  className = '',
}: {
  value?: number;
  onChange: (v: number | undefined) => void;
  readOnly: boolean;
  placeholder?: string;
  className?: string;
}) {
  if (readOnly) return <span>{value ?? '—'}</span>;
  return (
    <input
      type="number"
      min={0}
      className={`input text-sm ${className}`}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) =>
        onChange(e.target.value ? Number(e.target.value) : undefined)
      }
    />
  );
}

function firstOpenSection(sheet: WorkoutSheet): WorkoutSectionId | null {
  const ids = getSessionSectionIds(sheet);
  const open = ids.find((id) => !sheet.blockProgress?.[id]?.summarySaved);
  return open ?? ids[0] ?? null;
}

export function WorkoutFormaSheetBody({
  sheet,
  readOnly,
  isTrainer,
  circuitHistory,
  currentCircuitPoint,
  onChange,
}: {
  sheet: WorkoutSheet;
  readOnly: boolean;
  isTrainer: boolean;
  circuitHistory: CircuitHistoryPoint[];
  currentCircuitPoint: CircuitHistoryPoint | null;
  onChange: (sheet: WorkoutSheet) => void;
}) {
  const format = detectWorkoutSessionFormat(sheet);
  const sections = getSessionSectionIds(sheet);
  const [focusedId, setFocusedId] = useState<WorkoutSectionId | null>(() =>
    firstOpenSection(sheet),
  );
  const [fieldsOpenFor, setFieldsOpenFor] = useState<WorkoutSectionId | null>(
    null,
  );

  useEffect(() => {
    const ids = getSessionSectionIds(sheet);
    if (ids.length === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !ids.includes(focusedId)) {
      setFocusedId(firstOpenSection(sheet));
    }
  }, [sheet, focusedId]);

  const sessionSummary = useMemo(() => summarizeWorkoutSession(sheet), [sheet]);

  const update = (patch: Partial<WorkoutSheet>) => {
    onChange({ ...sheet, ...patch });
  };

  const markDone = (sectionId: WorkoutSectionId) => {
    let next = completeWorkoutSection(sheet, sectionId);
    next = saveBlockSummary(next, sectionId);
    onChange(next);
    const remaining = getSessionSectionIds(next).find(
      (id) => !next.blockProgress?.[id]?.summarySaved,
    );
    setFocusedId(remaining ?? sectionId);
    setFieldsOpenFor(null);
  };

  const durationHeader = (sectionId: WorkoutSectionId) => {
    const map: Partial<
      Record<WorkoutSectionId, { value?: number; key: keyof WorkoutSheet }>
    > = {
      warmup: { value: sheet.warmupDurationMin, key: 'warmupDurationMin' },
      strength: { value: sheet.strengthDurationMin, key: 'strengthDurationMin' },
      cardio: { value: sheet.cardioTotalMin, key: 'cardioTotalMin' },
      mobility: { value: sheet.mobilityDurationMin, key: 'mobilityDurationMin' },
      cooldown: { value: sheet.cooldownDurationMin, key: 'cooldownDurationMin' },
    };
    const entry = map[sectionId];
    if (!entry) return null;
    return (
      <>
        <span className="text-xs text-zinc-500">Время</span>
        <NumberInput
          value={entry.value}
          onChange={(v) => update({ [entry.key]: v })}
          readOnly={readOnly}
          placeholder="мин"
          className="w-16"
        />
      </>
    );
  };

  const renderFocused = () => {
    if (!focusedId) return null;
    const fieldsOpen = fieldsOpenFor === focusedId;
    const progress = sheet.blockProgress?.[focusedId];
    const cardProps = {
      sectionId: focusedId,
      progress,
      collapsed: Boolean(progress?.summarySaved && progress?.collapsed !== false),
      summarizing: false,
      readOnly,
      isTrainer,
      forma: true as const,
      onToggleCollapse: () => {
        if (!progress?.summarySaved) return;
        onChange({
          ...sheet,
          blockProgress: {
            ...sheet.blockProgress,
            [focusedId]: {
              ...progress,
              collapsed: progress.collapsed === false,
            },
          },
        });
      },
      onComplete: () => markDone(focusedId),
      onSaveSummary: () => onChange(saveBlockSummary(sheet, focusedId)),
      onReopen: () => onChange(reopenWorkoutSection(sheet, focusedId)),
      onSummaryNoteChange: (note: string) =>
        onChange(updateSectionSummaryNote(sheet, focusedId, note)),
      onOpenFields: readOnly
        ? undefined
        : () =>
            setFieldsOpenFor((cur) => (cur === focusedId ? null : focusedId)),
      onDone: () => markDone(focusedId),
      headerExtra: durationHeader(focusedId),
    };

    switch (focusedId) {
      case 'warmup':
        return (
          <WorkoutSectionCard {...cardProps}>
            <PrepBlockEditor
              variant="warmup"
              forma
              fieldsOpen={fieldsOpen}
              activities={sheet.warmupActivities ?? []}
              activeFields={sheet.warmupFields ?? WARMUP_DEFAULT_FIELDS}
              readOnly={readOnly}
              onChange={(warmupActivities) => update({ warmupActivities })}
              onFieldsChange={(warmupFields) => update({ warmupFields })}
            />
          </WorkoutSectionCard>
        );
      case 'cooldown':
        return (
          <WorkoutSectionCard {...cardProps}>
            <PrepBlockEditor
              variant="cooldown"
              forma
              fieldsOpen={fieldsOpen}
              activities={sheet.cooldownActivities ?? []}
              activeFields={sheet.cooldownFields ?? COOLDOWN_DEFAULT_FIELDS}
              readOnly={readOnly}
              onChange={(cooldownActivities) => update({ cooldownActivities })}
              onFieldsChange={(cooldownFields) => update({ cooldownFields })}
            />
          </WorkoutSectionCard>
        );
      case 'strength':
        return (
          <WorkoutSectionCard {...cardProps}>
            <StrengthBlockEditor
              forma
              fieldsOpen={fieldsOpen}
              exercises={sheet.strengthExercises}
              activeFields={
                sheet.strengthSetFields ?? STRENGTH_DEFAULT_SET_FIELDS
              }
              readOnly={readOnly}
              onChange={(strengthExercises) => update({ strengthExercises })}
              onFieldsChange={(strengthSetFields) =>
                update({ strengthSetFields })
              }
            />
          </WorkoutSectionCard>
        );
      case 'cardio':
        return (
          <WorkoutSectionCard {...cardProps}>
            <CardioBlockEditor
              forma
              fieldsOpen={fieldsOpen}
              exercises={sheet.cardioExercises}
              activeFields={sheet.cardioFields ?? CARDIO_DEFAULT_FIELDS}
              readOnly={readOnly}
              onChange={(cardioExercises) => update({ cardioExercises })}
              onFieldsChange={(cardioFields) => update({ cardioFields })}
            />
          </WorkoutSectionCard>
        );
      case 'circuit':
        return sheet.circuit ? (
          <WorkoutSectionCard {...cardProps}>
            <CircuitBlockEditor
              circuit={sheet.circuit}
              readOnly={readOnly}
              onChange={(circuit) =>
                onChange(ensureCircuitRoundLogs({ ...sheet, circuit }))
              }
            />
            {circuitHistory.length > 0 || currentCircuitPoint ? (
              <div className="mt-4">
                <p className="mb-2 text-xs uppercase text-zinc-500">
                  Динамика круговых
                </p>
                <CircuitDynamics
                  history={circuitHistory}
                  current={currentCircuitPoint}
                />
              </div>
            ) : null}
          </WorkoutSectionCard>
        ) : null;
      case 'mobility':
        return (
          <WorkoutSectionCard {...cardProps}>
            <MobilityBlockEditor
              forma
              fieldsOpen={fieldsOpen}
              exercises={sheet.mobilityExercises}
              activeFields={sheet.mobilityFields ?? MOBILITY_DEFAULT_FIELDS}
              readOnly={readOnly}
              onChange={(mobilityExercises) => update({ mobilityExercises })}
              onFieldsChange={(mobilityFields) => update({ mobilityFields })}
            />
          </WorkoutSectionCard>
        );
      default:
        return null;
    }
  };

  const isEnabled = (id: SessionBlockToggle) => {
    if (id === 'warmup' || id === 'cooldown') {
      return getPrepSections(sheet).includes(id);
    }
    return getWorkoutBlocks(sheet).includes(id);
  };

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <div>
          <p className="mb-2 text-xs uppercase text-zinc-500">Формат занятия</p>
          <div className="flex flex-wrap gap-2">
            {WORKOUT_SESSION_FORMATS.map((f) => (
              <Chip
                key={f.id}
                active={format === f.id}
                onClick={() => {
                  if (f.id === 'custom' && format === 'custom') return;
                  onChange(applyWorkoutSessionFormat(sheet, f.id));
                  setFieldsOpenFor(null);
                }}
              >
                {f.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {WORKOUT_SESSION_FORMATS.find((f) => f.id === format)?.description}
          </p>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">
          Формат:{' '}
          <span className="text-zinc-200">
            {WORKOUT_SESSION_FORMATS.find((f) => f.id === format)?.label}
          </span>
          {sections.length > 0 ? (
            <>
              {' '}
              ·{' '}
              {sections.map((id) => WORKOUT_SECTION_LABELS[id]).join(' · ')}
            </>
          ) : null}
        </p>
      )}

      {format === 'custom' && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          {SESSION_BLOCK_ORDER.map((block) => {
            const enabled = isEnabled(block);
            return (
              <button
                key={block}
                type="button"
                onClick={() => {
                  if (block === 'warmup' || block === 'cooldown') {
                    onChange(togglePrepSection(sheet, block));
                  } else {
                    let next = toggleWorkoutBlock(sheet, block);
                    if (
                      block === 'circuit' &&
                      !sheet.circuit &&
                      next.circuit
                    ) {
                      next = ensureCircuitRoundLogs(next);
                    }
                    onChange(next);
                  }
                }}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition',
                  enabled
                    ? 'bg-forma-500 text-ink'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10',
                )}
              >
                {enabled ? '✓ ' : ''}
                {block === 'warmup' || block === 'cooldown'
                  ? WORKOUT_SECTION_LABELS[block]
                  : MAIN_BLOCK_LABELS[block]}
              </button>
            );
          })}
        </div>
      ) : null}

      <WorkoutFormaLayout
        sheet={sheet}
        focusedId={focusedId}
        onFocus={(id) => {
          setFocusedId(id);
          setFieldsOpenFor(null);
        }}
      >
        {renderFocused()}
      </WorkoutFormaLayout>

      <WorkoutSessionFactStrip summary={sessionSummary} />

      {isTrainer ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-400" />
            <h4 className="font-semibold text-amber-200">
              Личные заметки тренера
            </h4>
          </div>
          <p className="mb-3 text-xs text-amber-200/60">
            Только для вас — клиент не видит.
          </p>
          {readOnly ? (
            <p className="whitespace-pre-wrap text-sm text-zinc-300">
              {sheet.trainerPrivateNotes?.trim() || '—'}
            </p>
          ) : (
            <textarea
              className="input min-h-[100px] w-full border-amber-500/20 text-sm"
              placeholder="План на следующую, особенности клиента…"
              value={sheet.trainerPrivateNotes ?? ''}
              onChange={(e) => update({ trainerPrivateNotes: e.target.value })}
            />
          )}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-ink-raised/40 p-4">
        <h4 className="font-display text-sm font-semibold text-white">
          Заметка клиенту
        </h4>
        {readOnly ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
            {sheet.notes?.trim() || '—'}
          </p>
        ) : (
          <textarea
            className="input mt-2 min-h-[88px] w-full text-sm"
            placeholder="Кратко для клиента — что получилось и на что обратить внимание"
            value={sheet.notes ?? ''}
            onChange={(e) => update({ notes: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}
