'use client';

import type {
  CircuitHistoryPoint,
  WorkoutMainBlock,
  WorkoutSheet,
} from '@fitgo/shared-types';
import {
  CARDIO_DEFAULT_FIELDS,
  COOLDOWN_DEFAULT_FIELDS,
  MOBILITY_DEFAULT_FIELDS,
  STRENGTH_DEFAULT_SET_FIELDS,
  WARMUP_DEFAULT_FIELDS,
  WORKOUT_SECTION_LABELS,
  WORKOUT_WEEKDAY_LABELS,
  ageFromDateOfBirth,
  compileSessionSummary,
  completeWorkoutSection,
  completeWorkoutSession,
  createDefaultCircuit,
  createEmptyWorkoutSheet,
  ensureCircuitRoundLogs,
  estimatedMaxHr,
  buildWorkoutSessionPlan,
  getPrepSections,
  getWorkoutBlocks,
  isPrepSectionEnabled,
  isSectionCollapsed,
  isSectionSummarizing,
  reopenWorkoutSection,
  saveBlockSummary,
  summarizeCircuitSession,
  summarizeWorkoutSession,
  togglePrepSection,
  toggleSectionCollapsed,
  toggleWorkoutBlock,
  updateSectionSummaryNote,
} from '@fitgo/shared-types';
import type { PrepSectionId, WorkoutSectionId } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { CircuitDynamics } from './circuit-dynamics';
import { CircuitBlockEditor } from './circuit-block-editor';
import { CardioBlockEditor } from './cardio-block-editor';
import { MobilityBlockEditor } from './mobility-block-editor';
import { PrepBlockEditor } from './prep-block-editor';
import { StrengthBlockEditor } from './strength-block-editor';
import { SectionTitle, TrainerTip } from './trainer-tip';
import { WorkoutSectionCard } from './workout-section-card';
import { WorkoutSessionController } from './workout-session-controller';
import { WorkoutSessionSummaryPanel } from './workout-session-summary';
import { Lock } from 'lucide-react';

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

function sessionBlockLabel(id: SessionBlockToggle): string {
  if (id === 'warmup' || id === 'cooldown') {
    return WORKOUT_SECTION_LABELS[id];
  }
  return MAIN_BLOCK_LABELS[id];
}

interface WorkoutSheetEditorProps {
  bookingId: string;
  sheet: WorkoutSheet;
  sessionDate: string;
  clientName: string;
  clientDateOfBirth?: string;
  /** ЧСС в покое из анкеты клиента (подставляется автоматически, если в листе пусто) */
  clientRestingHr?: number;
  canEdit: boolean;
  isTrainer: boolean;
  onChange: (sheet: WorkoutSheet) => void;
  onResetTemplate?: () => void;
  onCopyPrevious?: () => void;
}

function weekdayIndex(isoDate: string): number {
  const day = new Date(isoDate).getDay();
  return day === 0 ? 6 : day - 1;
}

function NumberInput({
  value,
  onChange,
  readOnly,
  placeholder,
  className = '',
  min = 0,
  max,
}: {
  value?: number;
  onChange: (v: number | undefined) => void;
  readOnly: boolean;
  placeholder?: string;
  className?: string;
  min?: number;
  max?: number;
}) {
  if (readOnly) {
    return <span>{value ?? '—'}</span>;
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      className={`input text-sm ${className}`}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) =>
        onChange(e.target.value ? Number(e.target.value) : undefined)
      }
    />
  );
}

export function WorkoutSheetEditor({
  bookingId,
  sheet,
  sessionDate,
  clientName,
  clientDateOfBirth,
  clientRestingHr,
  canEdit,
  isTrainer,
  onChange,
  onResetTemplate,
  onCopyPrevious,
}: WorkoutSheetEditorProps) {
  const readOnly = !canEdit || !isTrainer;
  const activeWeekday = weekdayIndex(sessionDate);
  const activeBlocks = getWorkoutBlocks(sheet);
  const prepSections = getPrepSections(sheet);
  const hasWarmup = isPrepSectionEnabled(sheet, 'warmup');
  const hasCooldown = isPrepSectionEnabled(sheet, 'cooldown');
  const hasCircuit = activeBlocks.includes('circuit');
  const hasStrength = activeBlocks.includes('strength');
  const hasMobility = activeBlocks.includes('mobility');

  const sessionSteps = useMemo(() => buildWorkoutSessionPlan(sheet), [sheet]);
  const canStartSession = !readOnly && sessionSteps.length > 0;

  const [circuitHistory, setCircuitHistory] = useState<CircuitHistoryPoint[]>([]);
  const [copyBusy, setCopyBusy] = useState(false);

  const suggestedAge = useMemo(
    () =>
      clientDateOfBirth
        ? ageFromDateOfBirth(clientDateOfBirth, new Date(sessionDate))
        : undefined,
    [clientDateOfBirth, sessionDate],
  );

  const suggestedMaxHr = useMemo(
    () => estimatedMaxHr(sheet.clientAge ?? suggestedAge),
    [sheet.clientAge, suggestedAge],
  );

  useEffect(() => {
    if (readOnly || clientRestingHr == null || sheet.restingHr != null) return;
    onChange({ ...sheet, restingHr: clientRestingHr });
    // Только при появлении значения из анкеты, если в листе ещё пусто
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientRestingHr, readOnly]);

  useEffect(() => {
    if (!hasCircuit) return;
    const token = getToken();
    if (!token) return;
    api
      .personalSessionCircuitHistory(token, bookingId)
      .then(setCircuitHistory)
      .catch(() => setCircuitHistory([]));
  }, [bookingId, hasCircuit]);

  const currentCircuitPoint = useMemo(() => {
    if (!hasCircuit) return null;
    return summarizeCircuitSession(bookingId, sessionDate, sheet);
  }, [bookingId, sessionDate, sheet, hasCircuit]);

  const update = (patch: Partial<WorkoutSheet>) => {
    onChange({ ...sheet, ...patch });
  };

  const sectionCardProps = (sectionId: WorkoutSectionId) => ({
    sectionId,
    progress: sheet.blockProgress?.[sectionId],
    collapsed: isSectionCollapsed(sheet, sectionId),
    summarizing: isSectionSummarizing(sheet, sectionId),
    readOnly,
    isTrainer,
    onToggleCollapse: () => onChange(toggleSectionCollapsed(sheet, sectionId)),
    onComplete: () => onChange(completeWorkoutSection(sheet, sectionId)),
    onSaveSummary: () => onChange(saveBlockSummary(sheet, sectionId)),
    onReopen: () => onChange(reopenWorkoutSection(sheet, sectionId)),
    onSummaryNoteChange: (note: string) =>
      onChange(updateSectionSummaryNote(sheet, sectionId, note)),
  });

  const compiledSummary = useMemo(() => compileSessionSummary(sheet), [sheet]);
  const sessionSummary = useMemo(() => summarizeWorkoutSession(sheet), [sheet]);

  const handleCompleteSession = () => {
    onChange(completeWorkoutSession(sheet));
  };

  const toggleBlock = (block: WorkoutMainBlock) => {
    if (readOnly) return;
    onChange(toggleWorkoutBlock(sheet, block));
  };

  const isSessionBlockEnabled = (id: SessionBlockToggle): boolean => {
    if (id === 'warmup' || id === 'cooldown') {
      return prepSections.includes(id);
    }
    return activeBlocks.includes(id);
  };

  const toggleSessionBlock = (id: SessionBlockToggle) => {
    if (readOnly) return;
    if (id === 'warmup' || id === 'cooldown') {
      onChange(togglePrepSection(sheet, id));
      return;
    }
    toggleBlock(id);
  };

  const applySuggestedAge = () => {
    if (suggestedAge) update({ clientAge: suggestedAge });
  };

  const applySuggestedRestingHr = () => {
    if (clientRestingHr != null) update({ restingHr: clientRestingHr });
  };

  const handleCopyPrevious = async () => {
    if (onCopyPrevious) {
      onCopyPrevious();
      return;
    }
    const token = getToken();
    if (!token) return;
    setCopyBusy(true);
    try {
      const { sheet: prev } = await api.personalSessionPreviousSheet(token, bookingId);
      if (prev) {
        const next =
          getWorkoutBlocks(prev).includes('circuit')
            ? ensureCircuitRoundLogs({ ...prev, circuit: prev.circuit ? { ...prev.circuit, roundLogs: [] } : createDefaultCircuit() })
            : prev;
        onChange(next);
      }
    } finally {
      setCopyBusy(false);
    }
  };

  const updateCircuit = (patch: Partial<NonNullable<WorkoutSheet['circuit']>>) => {
    const circuit = { ...(sheet.circuit ?? createDefaultCircuit()), ...patch };
    onChange(ensureCircuitRoundLogs({ ...sheet, circuit }));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-wide">ПРОГРАММА ТРЕНИРОВОК</h3>
          <div className="flex flex-wrap gap-2">
            {isTrainer && canEdit && (
              <button
                type="button"
                disabled={copyBusy}
                onClick={handleCopyPrevious}
                className="text-xs text-fitgo-400 hover:text-fitgo-300 disabled:opacity-50"
              >
                {copyBusy ? 'Загрузка…' : 'С прошлой тренировки'}
              </button>
            )}
            {isTrainer && canEdit && onResetTemplate && (
              <button
                type="button"
                onClick={onResetTemplate}
                className="text-xs text-amber-400 hover:text-amber-300"
              >
                Сбросить шаблон
              </button>
            )}
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs uppercase text-slate-500">Дата</p>
            <p className="font-medium">
              {new Date(sessionDate).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-slate-500">Клиент</p>
            <p className="font-medium">{clientName}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-slate-500">Возраст</p>
            <div className="flex items-center gap-2">
              <NumberInput
                value={sheet.clientAge}
                onChange={(v) => update({ clientAge: v })}
                readOnly={readOnly}
                placeholder="лет"
                className="max-w-[100px]"
                min={1}
                max={120}
              />
              {!readOnly && suggestedAge && sheet.clientAge !== suggestedAge && (
                <button
                  type="button"
                  onClick={applySuggestedAge}
                  className="text-xs text-fitgo-400"
                >
                  Из профиля ({suggestedAge})
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-slate-500">ЧСС в покое</p>
            <div className="flex items-center gap-2">
              <NumberInput
                value={sheet.restingHr}
                onChange={(v) => update({ restingHr: v })}
                readOnly={readOnly}
                placeholder="уд/мин"
                className="max-w-[100px]"
                min={30}
                max={120}
              />
              {!readOnly &&
                clientRestingHr != null &&
                sheet.restingHr !== clientRestingHr && (
                  <button
                    type="button"
                    onClick={applySuggestedRestingHr}
                    className="text-xs text-fitgo-400"
                  >
                    Из анкеты ({clientRestingHr})
                  </button>
                )}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              Пульс в покое. Норма 50–80 уд/мин
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs uppercase text-slate-500">День недели</p>
            <div className="flex flex-wrap gap-1">
              {WORKOUT_WEEKDAY_LABELS.map((label, index) => (
                <span
                  key={label}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    index === activeWeekday
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {!readOnly && (
          <div className="mb-2">
            <div className="mb-2 flex items-center gap-1.5">
              <p className="text-xs uppercase text-slate-500">Блоки тренировки</p>
              <TrainerTip tipId="blocks" />
            </div>
            <div className="flex flex-wrap gap-2">
              {SESSION_BLOCK_ORDER.map((block) => {
                const enabled = isSessionBlockEnabled(block);
                return (
                  <button
                    key={block}
                    type="button"
                    onClick={() => toggleSessionBlock(block)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      enabled
                        ? 'bg-fitgo-500 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {enabled ? '✓ ' : ''}
                    {sessionBlockLabel(block)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Снимите галочку, чтобы убрать блок из тренировки
            </p>
          </div>
        )}
        {readOnly && (
          <p className="mb-4 text-sm text-slate-400">
            Блоки:{' '}
            <span className="text-slate-200">
              {SESSION_BLOCK_ORDER.filter(isSessionBlockEnabled)
                .map(sessionBlockLabel)
                .join(' · ')}
            </span>
          </p>
        )}

        <WorkoutSessionController
          sheet={sheet}
          canStart={canStartSession}
          onChange={onChange}
        />

      </div>

      {hasWarmup && (
        <WorkoutSectionCard
          {...sectionCardProps('warmup')}
          tipId="warmup"
          headerExtra={
            <>
              <span>Время</span>
              <NumberInput
                value={sheet.warmupDurationMin}
                onChange={(v) => update({ warmupDurationMin: v })}
                readOnly={readOnly}
                placeholder="мин"
                className="w-20"
              />
            </>
          }
        >
          <PrepBlockEditor
            variant="warmup"
            activities={sheet.warmupActivities ?? []}
            activeFields={sheet.warmupFields ?? WARMUP_DEFAULT_FIELDS}
            readOnly={readOnly}
            onChange={(warmupActivities) => update({ warmupActivities })}
            onFieldsChange={(warmupFields) => update({ warmupFields })}
          />
        </WorkoutSectionCard>
      )}

      {hasStrength && (
        <WorkoutSectionCard
          {...sectionCardProps('strength')}
          tipId="strength"
          headerExtra={
            <>
              <span>Время</span>
              <NumberInput
                value={sheet.strengthDurationMin}
                onChange={(v) => update({ strengthDurationMin: v })}
                readOnly={readOnly}
                placeholder="мин"
                className="w-20"
              />
            </>
          }
        >
          <StrengthBlockEditor
            exercises={sheet.strengthExercises}
            activeFields={sheet.strengthSetFields ?? STRENGTH_DEFAULT_SET_FIELDS}
            readOnly={readOnly}
            onChange={(strengthExercises) => update({ strengthExercises })}
            onFieldsChange={(strengthSetFields) => update({ strengthSetFields })}
          />
        </WorkoutSectionCard>
      )}

      {activeBlocks.includes('cardio') && (
        <WorkoutSectionCard
          {...sectionCardProps('cardio')}
          tipId="cardio"
          headerExtra={
            <>
              <span>Общее время</span>
              <NumberInput
                value={sheet.cardioTotalMin}
                onChange={(v) => update({ cardioTotalMin: v })}
                readOnly={readOnly}
                placeholder="мин"
                className="w-20"
              />
            </>
          }
        >
          <CardioBlockEditor
            exercises={sheet.cardioExercises}
            activeFields={sheet.cardioFields ?? CARDIO_DEFAULT_FIELDS}
            readOnly={readOnly}
            onChange={(cardioExercises) => update({ cardioExercises })}
            onFieldsChange={(cardioFields) => update({ cardioFields })}
          />
        </WorkoutSectionCard>
      )}

      {hasCircuit && sheet.circuit && (
        <WorkoutSectionCard {...sectionCardProps('circuit')} tipId="circuit">
          <CircuitBlockEditor
            circuit={sheet.circuit}
            readOnly={readOnly}
            onChange={(circuit) => updateCircuit(circuit)}
          />
          <div className="mt-4">
            <SectionTitle>Динамика круговых</SectionTitle>
            <div className="mt-3">
              <CircuitDynamics
                history={circuitHistory}
                current={currentCircuitPoint}
              />
            </div>
          </div>
        </WorkoutSectionCard>
      )}

      {hasMobility && (
        <WorkoutSectionCard
          {...sectionCardProps('mobility')}
          tipId="mobility"
          headerExtra={
            <>
              <span>Время</span>
              <NumberInput
                value={sheet.mobilityDurationMin}
                onChange={(v) => update({ mobilityDurationMin: v })}
                readOnly={readOnly}
                placeholder="мин"
                className="w-20"
              />
            </>
          }
        >
          <MobilityBlockEditor
            exercises={sheet.mobilityExercises}
            activeFields={sheet.mobilityFields ?? MOBILITY_DEFAULT_FIELDS}
            readOnly={readOnly}
            onChange={(mobilityExercises) => update({ mobilityExercises })}
            onFieldsChange={(mobilityFields) => update({ mobilityFields })}
          />
        </WorkoutSectionCard>
      )}

      {hasCooldown && (
        <WorkoutSectionCard
          {...sectionCardProps('cooldown')}
          tipId="cooldown"
          headerExtra={
            <>
              <span>Время</span>
              <NumberInput
                value={sheet.cooldownDurationMin}
                onChange={(v) => update({ cooldownDurationMin: v })}
                readOnly={readOnly}
                placeholder="мин"
                className="w-20"
              />
            </>
          }
        >
          <PrepBlockEditor
            variant="cooldown"
            activities={sheet.cooldownActivities ?? []}
            activeFields={sheet.cooldownFields ?? COOLDOWN_DEFAULT_FIELDS}
            readOnly={readOnly}
            onChange={(cooldownActivities) => update({ cooldownActivities })}
            onFieldsChange={(cooldownFields) => update({ cooldownFields })}
          />
        </WorkoutSectionCard>
      )}

      <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
        <div className="mb-3">
          <SectionTitle tipId="session-vitals">ПОКАЗАТЕЛИ СЕССИИ</SectionTitle>
          <p className="mt-1 text-xs text-slate-500">
            Общее состояние клиента в конце занятия — для отслеживания восстановления и
            нагрузки между тренировками
          </p>
        </div>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs uppercase text-slate-500">Максимальная ЧСС</p>
            <div className="flex items-center gap-2">
              <NumberInput
                value={sheet.maxHr}
                onChange={(v) => update({ maxHr: v })}
                readOnly={readOnly}
                placeholder="уд/мин"
              />
              {!readOnly && suggestedMaxHr && sheet.maxHr !== suggestedMaxHr && (
                <button
                  type="button"
                  onClick={() => update({ maxHr: suggestedMaxHr })}
                  className="shrink-0 text-xs text-fitgo-400 hover:text-fitgo-300"
                  title="Подставить оценку 220 − возраст клиента"
                >
                  ≈ {suggestedMaxHr}
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              {suggestedMaxHr
                ? `Оценка 220 − возраст (${sheet.clientAge ?? suggestedAge}): ${suggestedMaxHr} уд/мин — нажмите «≈ ${suggestedMaxHr}», чтобы подставить`
                : 'Укажите возраст клиента в шапке — появится оценка 220 − возраст'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-slate-500">
              RPE сессии (1–10)
            </p>
            <NumberInput
              value={sheet.sessionRpe}
              onChange={(v) => update({ sessionRpe: v })}
              readOnly={readOnly}
              min={1}
              max={10}
              placeholder="—"
            />
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              Насколько тяжело было всё занятие целиком (как Feel в TrainingPeaks)
            </p>
          </div>
        </div>

        <div className="mb-4 border-t border-slate-700 pt-4">
          <div className="mb-3">
            <h4 className="font-semibold">СВОДКА ТРЕНИРОВКИ</h4>
            <p className="mt-1 text-xs text-slate-500">
              Автоматически по заполненным блокам — объём, RPE, пульс, структура времени
            </p>
          </div>
          <WorkoutSessionSummaryPanel summary={sessionSummary} />
        </div>

        <div className="mb-4 border-t border-slate-700 pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">ИТОГ ЗАНЯТИЯ</h4>
            {sheet.sessionCompleted && (
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                Занятие завершено
              </span>
            )}
          </div>

          {readOnly ? (
            <p className="whitespace-pre-wrap text-sm text-slate-300">
              {sheet.notes?.trim() || sheet.sessionSummaryNote?.trim() || 'Нет примечаний'}
            </p>
          ) : (
            <textarea
              className="input min-h-[120px] w-full text-sm"
              placeholder="Заполняется автоматически при сохранении итогов блоков…"
              value={sheet.notes ?? compiledSummary}
              onChange={(e) => update({ notes: e.target.value })}
              rows={5}
            />
          )}

          {isTrainer && !readOnly && !sheet.sessionCompleted && (
            <button
              type="button"
              onClick={handleCompleteSession}
              className="btn-primary mt-3 w-full"
            >
              Завершить занятие
            </button>
          )}

          {isTrainer && !readOnly && sheet.sessionCompleted && (
            <button
              type="button"
              onClick={() =>
                update({
                  sessionCompleted: undefined,
                  sessionCompletedAt: undefined,
                })
              }
              className="btn-secondary mt-3 w-full text-sm"
            >
              Редактировать итог
            </button>
          )}
        </div>
      </div>

      {isTrainer && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-400" />
            <h4 className="font-semibold text-amber-200">Личные заметки тренера</h4>
          </div>
          <p className="mb-3 text-xs text-amber-200/60">
            Только для вас — клиент не видит. План на следующую тренировку,
            особенности клиента, наблюдения.
          </p>
          {readOnly ? (
            <p className="whitespace-pre-wrap text-sm text-slate-300">
              {sheet.trainerPrivateNotes?.trim() || '—'}
            </p>
          ) : (
            <textarea
              className="input min-h-[100px] w-full border-amber-500/20 text-sm"
              placeholder="Например: снизить нагрузку на колено, обсудить питание…"
              value={sheet.trainerPrivateNotes ?? ''}
              onChange={(e) => update({ trainerPrivateNotes: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}

export { createEmptyWorkoutSheet };
