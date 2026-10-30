'use client';

import type {
  CircuitCrossFitFieldId,
  CircuitCrossFitFormat,
  CircuitCrossFitResult,
  CircuitMovementDomain,
  CircuitRoundLog,
  CircuitStation,
  CircuitStationFieldId,
  CircuitStationType,
  CircuitWorkout,
} from '@fitgo/shared-types';
import {
  applyCrossFitFormat,
  CIRCUIT_CROSSFIT_DEFAULT_FIELDS,
  CIRCUIT_CROSSFIT_FIELD_IDS,
  CIRCUIT_CROSSFIT_FIELD_LABELS,
  CIRCUIT_CROSSFIT_FIELD_PLACEHOLDERS,
  CIRCUIT_CROSSFIT_FORMAT_HINTS,
  CIRCUIT_CROSSFIT_FORMAT_IDS,
  CIRCUIT_CROSSFIT_FORMAT_LABELS,
  CIRCUIT_DEFAULT_STATION_FIELDS,
  CIRCUIT_MOVEMENT_DOMAIN_LABELS,
  CIRCUIT_STATION_FIELD_IDS,
  CIRCUIT_STATION_FIELD_LABELS,
  CIRCUIT_STATION_FIELD_PLACEHOLDERS,
  CIRCUIT_STATION_MAX,
  CIRCUIT_STATION_MIN,
  CIRCUIT_STATION_TYPE_LABELS,
  createEmptyCircuitStation,
  defaultCrossFitConfig,
  reorderCircuitStations,
  resizeCircuitStations,
} from '@fitgo/shared-types';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface CircuitBlockEditorProps {
  circuit: CircuitWorkout;
  readOnly: boolean;
  onChange: (circuit: CircuitWorkout) => void;
}

function crossfitResultHasData(result?: CircuitCrossFitResult): boolean {
  return Boolean(
    result?.roundsCompleted != null ||
      result?.extraReps != null ||
      result?.timeSec ||
      result?.notes?.trim(),
  );
}

function circuitJournalHasData(circuit: CircuitWorkout): boolean {
  if (crossfitResultHasData(circuit.crossfitResult)) return true;
  return circuit.roundLogs.some(
    (log) =>
      Boolean(
        log.roundWorkSec ||
          log.avgHr ||
          log.maxHr ||
          log.roundRestSec ||
          log.stations.some(
            (s) => s.rpe || s.actualHr || Boolean(s.notes?.trim()),
          ),
      ),
  );
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
    return <span className="text-sm text-slate-200">{value ?? '—'}</span>;
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

export function CircuitBlockEditor({
  circuit,
  readOnly,
  onChange,
}: CircuitBlockEditorProps) {
  const activeFields = circuit.stationFields ?? CIRCUIT_DEFAULT_STATION_FIELDS;
  const crossfitEnabled = Boolean(circuit.crossfitEnabled);
  const crossfit = circuit.crossfit ?? defaultCrossFitConfig();
  const crossfitFields =
    crossfit.stationFields ?? CIRCUIT_CROSSFIT_DEFAULT_FIELDS;
  const crossfitFormat = crossfit.format;
  const journalHasData = circuitJournalHasData(circuit);
  const [journalOpen, setJournalOpen] = useState(
    () => readOnly && journalHasData,
  );

  const patch = (next: Partial<CircuitWorkout>) => {
    onChange({ ...circuit, ...next });
  };

  const updateStation = (index: number, station: CircuitStation) => {
    const stations = [...circuit.stations];
    stations[index] = station;
    patch({ stations });
  };

  const addStation = () => {
    if (circuit.stations.length >= CIRCUIT_STATION_MAX) return;
    patch({ stations: [...circuit.stations, createEmptyCircuitStation()] });
  };

  const removeStation = (index: number) => {
    if (circuit.stations.length <= CIRCUIT_STATION_MIN) return;
    patch({ stations: circuit.stations.filter((_, i) => i !== index) });
  };

  const moveStation = (fromIndex: number, toIndex: number) => {
    patch(reorderCircuitStations(circuit, fromIndex, toIndex));
  };

  const setStationCount = (count: number | undefined) => {
    if (count == null) return;
    patch(resizeCircuitStations(circuit, count));
  };

  const toggleField = (field: CircuitStationFieldId) => {
    if (readOnly) return;
    const enabled = activeFields.includes(field);
    if (enabled && activeFields.length <= 1) return;
    const stationFields = enabled
      ? activeFields.filter((f) => f !== field)
      : [...activeFields, field];
    patch({ stationFields });
  };

  const toggleCrossFit = () => {
    if (readOnly) return;
    if (crossfitEnabled) {
      patch({ crossfitEnabled: false });
      return;
    }
    patch({
      crossfitEnabled: true,
      crossfit: circuit.crossfit ?? defaultCrossFitConfig(),
    });
  };

  const setCrossFitFormat = (format: CircuitCrossFitFormat) => {
    if (readOnly) return;
    onChange(applyCrossFitFormat(circuit, format));
  };

  const updateCrossFit = (next: Partial<typeof crossfit>) => {
    patch({
      crossfit: { ...crossfit, ...next },
    });
  };

  const toggleCrossFitField = (field: CircuitCrossFitFieldId) => {
    if (readOnly) return;
    const enabled = crossfitFields.includes(field);
    if (enabled && crossfitFields.length <= 1) return;
    const stationFields = enabled
      ? crossfitFields.filter((f) => f !== field)
      : [...crossfitFields, field];
    updateCrossFit({ stationFields });
  };

  const updateCrossFitResult = (next: Partial<CircuitCrossFitResult>) => {
    patch({
      crossfitResult: { ...(circuit.crossfitResult ?? {}), ...next },
    });
  };

  const updateRoundLog = (roundIndex: number, logPatch: Partial<CircuitRoundLog>) => {
    const roundLogs = circuit.roundLogs.map((log, i) =>
      i === roundIndex ? { ...log, ...logPatch } : log,
    );
    patch({ roundLogs });
  };

  const updateRoundStation = (
    roundIndex: number,
    stationIndex: number,
    resultPatch: Partial<CircuitRoundLog['stations'][number]>,
  ) => {
    const log = circuit.roundLogs[roundIndex];
    const stations = log.stations.map((s, i) =>
      i === stationIndex ? { ...s, ...resultPatch } : s,
    );
    updateRoundLog(roundIndex, { stations });
  };

  const visibleStations = readOnly
    ? circuit.stations.filter(
        (s) =>
          s.name.trim() ||
          s.stationType ||
          s.workSec ||
          s.restSec ||
          s.tempo ||
          s.targetHr ||
          s.load ||
          s.reps ||
          s.rxLoad ||
          s.scaledLoad ||
          s.movementDomain,
      )
    : circuit.stations;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex min-w-0 flex-col">
          <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
            Кругов
          </p>
          <NumberInput
            value={circuit.rounds}
            onChange={(v) => patch({ rounds: v ?? 3 })}
            readOnly={readOnly}
            min={1}
            max={20}
            className="w-full"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
            Станций
          </p>
          <NumberInput
            value={circuit.stations.length}
            onChange={setStationCount}
            readOnly={readOnly}
            min={CIRCUIT_STATION_MIN}
            max={CIRCUIT_STATION_MAX}
            className="w-full"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
            Переход, сек
          </p>
          <NumberInput
            value={circuit.transitionSec}
            onChange={(v) => patch({ transitionSec: v })}
            readOnly={readOnly}
            min={0}
            className="w-full"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
            Отдых между кругами, сек
          </p>
          <NumberInput
            value={circuit.restBetweenRoundsSec}
            onChange={(v) => patch({ restBetweenRoundsSec: v })}
            readOnly={readOnly}
            min={0}
            className="w-full"
          />
        </div>
      </div>

      {!readOnly && (
        <div>
          <p className="mb-2 text-xs text-slate-500">Режим</p>
          <button
            type="button"
            onClick={toggleCrossFit}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              crossfitEnabled
                ? 'bg-amber-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {crossfitEnabled ? '✓ ' : ''}
            CrossFit
          </button>
        </div>
      )}

      {readOnly && crossfitEnabled && (
        <p className="text-xs font-medium text-amber-400/90">
          CrossFit · {CIRCUIT_CROSSFIT_FORMAT_LABELS[crossfitFormat]}
        </p>
      )}

      {crossfitEnabled && (
        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          {!readOnly && (
            <>
              <div>
                <p className="mb-2 text-xs text-slate-500">Формат WOD</p>
                <div className="flex flex-wrap gap-1.5">
                  {CIRCUIT_CROSSFIT_FORMAT_IDS.map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => setCrossFitFormat(format)}
                      title={CIRCUIT_CROSSFIT_FORMAT_HINTS[format]}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        crossfitFormat === format
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {CIRCUIT_CROSSFIT_FORMAT_LABELS[format]}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                  {CIRCUIT_CROSSFIT_FORMAT_HINTS[crossfitFormat]}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(crossfitFormat === 'amrap' || crossfitFormat === 'chipper') && (
                  <div className="flex min-w-0 flex-col">
                    <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                      Лимит, мин
                    </p>
                    <NumberInput
                      value={crossfit.timeCapMin}
                      onChange={(v) => updateCrossFit({ timeCapMin: v })}
                      readOnly={readOnly}
                      min={1}
                      max={60}
                      className="w-full"
                    />
                  </div>
                )}
                {crossfitFormat === 'emom' && (
                  <>
                    <div className="flex min-w-0 flex-col">
                      <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                        Длительность, мин
                      </p>
                      <NumberInput
                        value={crossfit.emomDurationMin}
                        onChange={(v) => updateCrossFit({ emomDurationMin: v })}
                        readOnly={readOnly}
                        min={1}
                        max={60}
                        className="w-full"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                        Интервал, сек
                      </p>
                      <NumberInput
                        value={crossfit.emomIntervalSec}
                        onChange={(v) => updateCrossFit({ emomIntervalSec: v })}
                        readOnly={readOnly}
                        min={30}
                        max={180}
                        className="w-full"
                      />
                    </div>
                  </>
                )}
                {crossfitFormat === 'tabata' && (
                  <>
                    <div className="flex min-w-0 flex-col">
                      <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                        Работа, сек
                      </p>
                      <NumberInput
                        value={crossfit.tabataWorkSec}
                        onChange={(v) => updateCrossFit({ tabataWorkSec: v })}
                        readOnly={readOnly}
                        min={10}
                        max={60}
                        className="w-full"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                        Отдых, сек
                      </p>
                      <NumberInput
                        value={crossfit.tabataRestSec}
                        onChange={(v) => updateCrossFit({ tabataRestSec: v })}
                        readOnly={readOnly}
                        min={5}
                        max={60}
                        className="w-full"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                        Раундов
                      </p>
                      <NumberInput
                        value={crossfit.tabataRounds}
                        onChange={(v) => {
                          updateCrossFit({ tabataRounds: v });
                          if (v) patch({ rounds: v });
                        }}
                        readOnly={readOnly}
                        min={1}
                        max={20}
                        className="w-full"
                      />
                    </div>
                  </>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs text-slate-500">Поля движения</p>
                <div className="flex flex-wrap gap-1.5">
                  {CIRCUIT_CROSSFIT_FIELD_IDS.map((field) => {
                    const enabled = crossfitFields.includes(field);
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => toggleCrossFitField(field)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          enabled
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {enabled ? '✓ ' : ''}
                        {CIRCUIT_CROSSFIT_FIELD_LABELS[field]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {readOnly && (
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
              {(crossfitFormat === 'amrap' || crossfitFormat === 'chipper') &&
                crossfit.timeCapMin != null && (
                  <span>Лимит: {crossfit.timeCapMin} мин</span>
                )}
              {crossfitFormat === 'emom' && (
                <>
                  {crossfit.emomDurationMin != null && (
                    <span>EMOM: {crossfit.emomDurationMin} мин</span>
                  )}
                  {crossfit.emomIntervalSec != null && (
                    <span>Интервал: {crossfit.emomIntervalSec} с</span>
                  )}
                </>
              )}
              {crossfitFormat === 'tabata' && (
                <span>
                  Tabata {crossfit.tabataWorkSec ?? 20}/{crossfit.tabataRestSec ?? 10} ×{' '}
                  {crossfit.tabataRounds ?? 8}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs uppercase text-slate-500">
          {crossfitEnabled ? 'План движений' : 'План станций'}
        </p>

        {!readOnly && (
          <div className="mb-3">
            <p className="mb-2 text-xs text-slate-500">Поля станции</p>
            <div className="flex flex-wrap gap-1.5">
              {CIRCUIT_STATION_FIELD_IDS.map((field) => {
                const enabled = activeFields.includes(field);
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => toggleField(field)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      enabled
                        ? 'bg-fitgo-500 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {enabled ? '✓ ' : ''}
                    {CIRCUIT_STATION_FIELD_LABELS[field]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {visibleStations.map((station, index) => (
            <div
              key={index}
              className="rounded-xl border border-slate-700/80 bg-slate-800/30 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {!readOnly && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => moveStation(index, index - 1)}
                        disabled={index === 0}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-25"
                        aria-label="Переместить станцию выше"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStation(index, index + 1)}
                        disabled={index >= circuit.stations.length - 1}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-25"
                        aria-label="Переместить станцию ниже"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <span className="text-xs font-medium text-slate-500">
                    {crossfitEnabled ? `Движение ${index + 1}` : `Станция ${index + 1}`}
                  </span>
                </div>
                {!readOnly && circuit.stations.length > CIRCUIT_STATION_MIN && (
                  <button
                    type="button"
                    onClick={() => removeStation(index)}
                    className="rounded p-1 text-slate-600 hover:text-red-400"
                    aria-label="Удалить станцию"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="mb-2">
                <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  {crossfitEnabled ? 'Движение' : 'Название'}
                </label>
                {readOnly ? (
                  <p className="text-sm text-slate-200">{station.name || '—'}</p>
                ) : (
                  <input
                    className="input w-full text-sm"
                    placeholder={
                      crossfitEnabled
                        ? 'Thrusters, Pull-ups, Row 500 м…'
                        : 'Упражнение / тренажёр'
                    }
                    value={station.name}
                    onChange={(e) =>
                      updateStation(index, { ...station, name: e.target.value })
                    }
                  />
                )}
              </div>

              {activeFields.includes('stationType') && (
                <div className="mb-2">
                  <label className="mb-1 block text-[10px] uppercase text-slate-600">
                    {CIRCUIT_STATION_FIELD_LABELS.stationType}
                  </label>
                  {readOnly ? (
                    <p className="text-sm text-slate-200">
                      {station.stationType
                        ? CIRCUIT_STATION_TYPE_LABELS[station.stationType]
                        : '—'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(
                        Object.keys(
                          CIRCUIT_STATION_TYPE_LABELS,
                        ) as CircuitStationType[]
                      ).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() =>
                            updateStation(index, { ...station, stationType: type })
                          }
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                            station.stationType === type
                              ? 'bg-fitgo-500/30 text-fitgo-300 ring-1 ring-fitgo-500/50'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {CIRCUIT_STATION_TYPE_LABELS[type]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                {activeFields
                  .filter((f) => f !== 'stationType')
                  .map((field) => (
                    <div key={field}>
                      <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                        {CIRCUIT_STATION_FIELD_LABELS[field]}
                      </label>
                      {field === 'workSec' || field === 'restSec' ? (
                        <NumberInput
                          value={station[field]}
                          onChange={(v) =>
                            updateStation(index, { ...station, [field]: v })
                          }
                          readOnly={readOnly}
                          placeholder={CIRCUIT_STATION_FIELD_PLACEHOLDERS[field]}
                        />
                      ) : field === 'targetHr' ? (
                        <NumberInput
                          value={station.targetHr}
                          onChange={(v) =>
                            updateStation(index, { ...station, targetHr: v })
                          }
                          readOnly={readOnly}
                          placeholder={CIRCUIT_STATION_FIELD_PLACEHOLDERS[field]}
                        />
                      ) : readOnly ? (
                        <p className="text-sm text-slate-200">
                          {station[field]?.toString().trim() || '—'}
                        </p>
                      ) : (
                        <input
                          className="input w-full px-2 py-1.5 text-sm"
                          placeholder={CIRCUIT_STATION_FIELD_PLACEHOLDERS[field]}
                          value={station[field] ?? ''}
                          onChange={(e) =>
                            updateStation(index, {
                              ...station,
                              [field]: e.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                {crossfitEnabled &&
                  crossfitFields
                    .filter((f) => f !== 'movementDomain')
                    .map((field) => (
                      <div key={field}>
                        <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                          {CIRCUIT_CROSSFIT_FIELD_LABELS[field]}
                        </label>
                        {readOnly ? (
                          <p className="text-sm text-slate-200">
                            {station[field]?.trim() || '—'}
                          </p>
                        ) : (
                          <input
                            className="input w-full px-2 py-1.5 text-sm"
                            placeholder={
                              CIRCUIT_CROSSFIT_FIELD_PLACEHOLDERS[field]
                            }
                            value={station[field] ?? ''}
                            onChange={(e) =>
                              updateStation(index, {
                                ...station,
                                [field]: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
              </div>

              {crossfitEnabled && crossfitFields.includes('movementDomain') && (
                <div className="mt-2">
                  <label className="mb-1 block text-[10px] uppercase text-slate-600">
                    {CIRCUIT_CROSSFIT_FIELD_LABELS.movementDomain}
                  </label>
                  {readOnly ? (
                    <p className="text-sm text-slate-200">
                      {station.movementDomain
                        ? CIRCUIT_MOVEMENT_DOMAIN_LABELS[station.movementDomain]
                        : '—'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(
                        Object.keys(
                          CIRCUIT_MOVEMENT_DOMAIN_LABELS,
                        ) as CircuitMovementDomain[]
                      ).map((domain) => (
                        <button
                          key={domain}
                          type="button"
                          onClick={() =>
                            updateStation(index, {
                              ...station,
                              movementDomain: domain,
                            })
                          }
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                            station.movementDomain === domain
                              ? 'bg-amber-500/30 text-amber-200 ring-1 ring-amber-500/50'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {CIRCUIT_MOVEMENT_DOMAIN_LABELS[domain]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {!readOnly && circuit.stations.length < CIRCUIT_STATION_MAX && (
          <button
            type="button"
            onClick={addStation}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-400 hover:border-fitgo-500/50 hover:text-fitgo-400"
          >
            <Plus className="h-4 w-4" />
            {crossfitEnabled ? 'Новое движение' : 'Новая станция'}
          </button>
        )}
      </div>

      {(journalOpen || !readOnly) && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setJournalOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-700/80 bg-slate-800/30 px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-slate-800/50"
            aria-expanded={journalOpen}
          >
            <span>{crossfitEnabled ? 'Журнал / результат' : 'Журнал кругов'}</span>
            <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
              {!journalOpen && journalHasData && 'Есть записи'}
              {!journalOpen && !readOnly && 'Развернуть'}
              {journalOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </span>
          </button>
          {journalOpen && crossfitEnabled && (
            <div className="rounded-xl border border-amber-500/20 bg-slate-800/40 p-3">
              <p className="mb-2 text-sm font-medium text-amber-200/90">Результат WOD</p>
              {crossfitFormat === 'amrap' && (
                <div className="mb-2 grid gap-2 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col">
                    <p className="mb-1 text-xs text-slate-500">Круги</p>
                    <NumberInput
                      value={circuit.crossfitResult?.roundsCompleted}
                      onChange={(v) => updateCrossFitResult({ roundsCompleted: v })}
                      readOnly={readOnly}
                      min={0}
                      className="w-full"
                    />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <p className="mb-1 text-xs text-slate-500">+ повторы</p>
                    <NumberInput
                      value={circuit.crossfitResult?.extraReps}
                      onChange={(v) => updateCrossFitResult({ extraReps: v })}
                      readOnly={readOnly}
                      min={0}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
              {(crossfitFormat === 'for_time' || crossfitFormat === 'chipper') && (
                <div className="mb-2 flex min-w-0 flex-col">
                  <p className="mb-1 text-xs text-slate-500">Итог, сек</p>
                  <NumberInput
                    value={circuit.crossfitResult?.timeSec}
                    onChange={(v) => updateCrossFitResult({ timeSec: v })}
                    readOnly={readOnly}
                    min={1}
                    className="w-full"
                  />
                </div>
              )}
              {(crossfitFormat === 'emom' || crossfitFormat === 'tabata') && (
                <p className="mb-2 text-xs text-slate-500">
                  Детали по раундам — в журнале ниже
                </p>
              )}
              <div>
                <p className="mb-1 text-xs text-slate-500">Заметка</p>
                {readOnly ? (
                  <p className="text-sm text-slate-300">
                    {circuit.crossfitResult?.notes?.trim() || '—'}
                  </p>
                ) : (
                  <input
                    className="input w-full text-sm"
                    placeholder="RX / Scaled, техника, срыв…"
                    value={circuit.crossfitResult?.notes ?? ''}
                    onChange={(e) =>
                      updateCrossFitResult({ notes: e.target.value })
                    }
                  />
                )}
              </div>
            </div>
          )}
          {journalOpen &&
            circuit.roundLogs.map((log, roundIndex) => (
              <div key={log.round} className="rounded-xl bg-slate-800/40 p-3">
            <p className="mb-2 text-sm font-medium">Круг {log.round}</p>
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <div className="flex min-w-0 flex-col">
                <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                  Время круга, сек
                </p>
                <NumberInput
                  value={log.roundWorkSec}
                  onChange={(v) => updateRoundLog(roundIndex, { roundWorkSec: v })}
                  readOnly={readOnly}
                  className="w-full"
                />
              </div>
              <div className="flex min-w-0 flex-col">
                <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                  Ср. ЧСС круга
                </p>
                <NumberInput
                  value={log.avgHr}
                  onChange={(v) => updateRoundLog(roundIndex, { avgHr: v })}
                  readOnly={readOnly}
                  className="w-full"
                />
              </div>
              <div className="flex min-w-0 flex-col">
                <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                  Макс. ЧСС
                </p>
                <NumberInput
                  value={log.maxHr}
                  onChange={(v) => updateRoundLog(roundIndex, { maxHr: v })}
                  readOnly={readOnly}
                  className="w-full"
                />
              </div>
              <div className="flex min-w-0 flex-col">
                <p className="mb-1 flex min-h-8 items-end text-xs leading-tight text-slate-500">
                  Отдых после, сек
                </p>
                <NumberInput
                  value={log.roundRestSec}
                  onChange={(v) => updateRoundLog(roundIndex, { roundRestSec: v })}
                  readOnly={readOnly}
                  className="w-full"
                />
              </div>
            </div>
            <div className="space-y-2">
              {log.stations.map((result, stationIndex) => {
                const stationName =
                  circuit.stations[stationIndex]?.name ||
                  `Станция ${stationIndex + 1}`;
                if (
                  readOnly &&
                  !result.rpe &&
                  !result.actualHr &&
                  !result.notes
                ) {
                  return null;
                }
                return (
                  <div
                    key={stationIndex}
                    className="rounded-lg bg-slate-900/50 p-2"
                  >
                    <p className="mb-2 truncate text-xs font-medium text-slate-400">
                      {stationName}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                          ЧСС
                        </label>
                        <NumberInput
                          value={result.actualHr}
                          onChange={(v) =>
                            updateRoundStation(roundIndex, stationIndex, {
                              actualHr: v,
                            })
                          }
                          readOnly={readOnly}
                          placeholder="ЧСС"
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                          RPE
                        </label>
                        <NumberInput
                          value={result.rpe}
                          onChange={(v) =>
                            updateRoundStation(roundIndex, stationIndex, {
                              rpe: v,
                            })
                          }
                          readOnly={readOnly}
                          placeholder="RPE"
                          min={1}
                          max={10}
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                          Заметка
                        </label>
                        {readOnly ? (
                          <p className="text-sm text-slate-300">
                            {result.notes || '—'}
                          </p>
                        ) : (
                          <input
                            className="input w-full text-sm"
                            placeholder="Заметка"
                            value={result.notes ?? ''}
                            onChange={(e) =>
                              updateRoundStation(roundIndex, stationIndex, {
                                notes: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
