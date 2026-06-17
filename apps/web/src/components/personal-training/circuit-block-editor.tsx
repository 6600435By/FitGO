'use client';

import type {
  CircuitRoundLog,
  CircuitStation,
  CircuitStationFieldId,
  CircuitStationType,
  CircuitWorkout,
} from '@fitgo/shared-types';
import {
  CIRCUIT_DEFAULT_STATION_FIELDS,
  CIRCUIT_STATION_FIELD_IDS,
  CIRCUIT_STATION_FIELD_LABELS,
  CIRCUIT_STATION_FIELD_PLACEHOLDERS,
  CIRCUIT_STATION_MAX,
  CIRCUIT_STATION_MIN,
  CIRCUIT_STATION_TYPE_LABELS,
  createEmptyCircuitStation,
} from '@fitgo/shared-types';
import { Plus, Trash2 } from 'lucide-react';
import { TrainerTip } from './trainer-tip';

interface CircuitBlockEditorProps {
  circuit: CircuitWorkout;
  readOnly: boolean;
  onChange: (circuit: CircuitWorkout) => void;
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

  const toggleField = (field: CircuitStationFieldId) => {
    if (readOnly) return;
    const enabled = activeFields.includes(field);
    if (enabled && activeFields.length <= 1) return;
    const stationFields = enabled
      ? activeFields.filter((f) => f !== field)
      : [...activeFields, field];
    patch({ stationFields });
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
          s.load,
      )
    : circuit.stations;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs text-slate-500">
            Кругов
          </p>
          <NumberInput
            value={circuit.rounds}
            onChange={(v) => patch({ rounds: v ?? 3 })}
            readOnly={readOnly}
            min={1}
            max={20}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500">Станций</p>
          <span className="text-sm text-slate-200">
            {circuit.stations.length}
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500">Отдых между кругами, сек</p>
          <NumberInput
            value={circuit.restBetweenRoundsSec}
            onChange={(v) => patch({ restBetweenRoundsSec: v })}
            readOnly={readOnly}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500">Переход, сек</p>
          <NumberInput
            value={circuit.transitionSec}
            onChange={(v) => patch({ transitionSec: v })}
            readOnly={readOnly}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1 text-xs uppercase text-slate-500">
          План станций
          <TrainerTip tipId="circuit-stations" />
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
                <span className="text-xs font-medium text-slate-500">
                  Станция {index + 1}
                </span>
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
                  Название
                </label>
                {readOnly ? (
                  <p className="text-sm text-slate-200">{station.name || '—'}</p>
                ) : (
                  <input
                    className="input w-full text-sm"
                    placeholder="Упражнение / тренажёр"
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
              </div>
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
            Новая станция
          </button>
        )}
      </div>

      <div className="space-y-3">
        <h5 className="flex items-center gap-1 text-sm font-medium text-slate-300">
          Журнал кругов
          <TrainerTip tipId="circuit-journal" />
          <TrainerTip tipId="circuit-rpe" />
        </h5>
        {circuit.roundLogs.map((log, roundIndex) => (
          <div key={log.round} className="rounded-xl bg-slate-800/40 p-3">
            <p className="mb-2 text-sm font-medium">Круг {log.round}</p>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Ср. ЧСС круга</p>
                <NumberInput
                  value={log.avgHr}
                  onChange={(v) => updateRoundLog(roundIndex, { avgHr: v })}
                  readOnly={readOnly}
                />
              </div>
              <div>
                <p className="text-xs text-slate-500">Макс. ЧСС</p>
                <NumberInput
                  value={log.maxHr}
                  onChange={(v) => updateRoundLog(roundIndex, { maxHr: v })}
                  readOnly={readOnly}
                />
              </div>
              <div>
                <p className="text-xs text-slate-500">Отдых после, сек</p>
                <NumberInput
                  value={log.roundRestSec}
                  onChange={(v) => updateRoundLog(roundIndex, { roundRestSec: v })}
                  readOnly={readOnly}
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
    </div>
  );
}
