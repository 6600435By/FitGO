import type {
  BuiltPreset,
  IntervalPresetParams,
  PresetBuildInput,
  TimerPhase,
} from './types';
import type { CircuitWorkout } from '@fitgo/shared-types';

export const REST_QUICK_SEC = [30, 60, 90, 120] as const;

export function buildPreset(input: PresetBuildInput): BuiltPreset {
  switch (input.id) {
    case 'stopwatch':
      return {
        id: 'stopwatch',
        name: 'Секундомер',
        phases: [{ kind: 'work', durationSec: null, label: 'Секундомер' }],
      };
    case 'countdown':
      return {
        id: 'countdown',
        name: `Отсчёт ${formatShort(input.params.durationSec)}`,
        phases: [
          {
            kind: 'work',
            durationSec: input.params.durationSec,
            label: 'Отсчёт',
          },
        ],
      };
    case 'intervals':
      return buildIntervals('intervals', 'Интервалы', input.params);
    case 'tabata':
      return buildIntervals('tabata', 'Tabata', {
        workSec: input.params?.workSec ?? 20,
        restSec: input.params?.restSec ?? 10,
        rounds: input.params?.rounds ?? 8,
        prepSec: input.params?.prepSec ?? 3,
      });
    case 'emom': {
      const prep = input.params.prepSec ?? 3;
      const phases: TimerPhase[] = [];
      if (prep > 0) {
        phases.push({ kind: 'prep', durationSec: prep, label: 'Приготовьтесь' });
      }
      for (let i = 0; i < input.params.minutes; i++) {
        phases.push({
          kind: 'work',
          durationSec: 60,
          label: `EMOM ${i + 1}/${input.params.minutes}`,
        });
      }
      return {
        id: 'emom',
        name: `EMOM ${input.params.minutes} мин`,
        phases,
      };
    }
    case 'amrap': {
      const prep = input.params.prepSec ?? 3;
      const phases: TimerPhase[] = [];
      if (prep > 0) {
        phases.push({ kind: 'prep', durationSec: prep, label: 'Приготовьтесь' });
      }
      phases.push({
        kind: 'work',
        durationSec: input.params.totalSec,
        label: 'AMRAP',
      });
      return {
        id: 'amrap',
        name: `AMRAP ${formatShort(input.params.totalSec)}`,
        phases,
      };
    }
    case 'rest':
      return {
        id: 'rest',
        name: `Отдых ${input.params.durationSec} с`,
        phases: [
          {
            kind: 'rest',
            durationSec: input.params.durationSec,
            label: 'Отдых',
          },
        ],
      };
    case 'custom':
      return {
        id: 'custom',
        name: input.params.name?.trim() || 'Своя цепочка',
        phases: input.params.phases.length
          ? input.params.phases
          : [{ kind: 'work', durationSec: 60, label: 'Работа' }],
      };
    default:
      return buildPreset({ id: 'stopwatch' });
  }
}

function buildIntervals(
  id: string,
  name: string,
  params: IntervalPresetParams,
): BuiltPreset {
  const phases: TimerPhase[] = [];
  const prep = params.prepSec ?? 3;
  if (prep > 0) {
    phases.push({ kind: 'prep', durationSec: prep, label: 'Приготовьтесь' });
  }
  for (let r = 0; r < params.rounds; r++) {
    phases.push({
      kind: 'work',
      durationSec: params.workSec,
      label: `Работа ${r + 1}/${params.rounds}`,
    });
    if (r < params.rounds - 1) {
      phases.push({
        kind: 'rest',
        durationSec: params.restSec,
        label: `Отдых ${r + 1}/${params.rounds}`,
      });
    }
  }
  return { id, name, phases };
}

function formatShort(sec: number): string {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60} мин`;
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  return `${sec} с`;
}

export const BUILTIN_PRESET_CARDS: Array<{
  id: PresetBuildInput['id'];
  title: string;
  subtitle: string;
  defaultInput: PresetBuildInput;
}> = [
  {
    id: 'stopwatch',
    title: 'Секундомер',
    subtitle: 'Свободный хронометр',
    defaultInput: { id: 'stopwatch' },
  },
  {
    id: 'countdown',
    title: 'Отсчёт',
    subtitle: '5 минут',
    defaultInput: { id: 'countdown', params: { durationSec: 300 } },
  },
  {
    id: 'intervals',
    title: 'Интервалы',
    subtitle: '40/20 × 8',
    defaultInput: {
      id: 'intervals',
      params: { workSec: 40, restSec: 20, rounds: 8, prepSec: 3 },
    },
  },
  {
    id: 'tabata',
    title: 'Tabata',
    subtitle: '20/10 × 8',
    defaultInput: { id: 'tabata' },
  },
  {
    id: 'emom',
    title: 'EMOM',
    subtitle: '10 минут',
    defaultInput: { id: 'emom', params: { minutes: 10, prepSec: 3 } },
  },
  {
    id: 'amrap',
    title: 'AMRAP',
    subtitle: '12 минут',
    defaultInput: { id: 'amrap', params: { totalSec: 12 * 60, prepSec: 3 } },
  },
  {
    id: 'rest',
    title: 'Отдых',
    subtitle: '60 секунд',
    defaultInput: { id: 'rest', params: { durationSec: 60 } },
  },
  {
    id: 'custom',
    title: 'Своя цепочка',
    subtitle: 'Несколько сегментов',
    defaultInput: {
      id: 'custom',
      params: {
        name: 'Своя цепочка',
        phases: [
          { kind: 'prep', durationSec: 3, label: 'Приготовьтесь' },
          { kind: 'work', durationSec: 45, label: 'Работа' },
          { kind: 'rest', durationSec: 15, label: 'Отдых' },
          { kind: 'work', durationSec: 45, label: 'Работа' },
        ],
      },
    },
  },
];

/** Build phases from a circuit block on the workout sheet. */
export function phasesFromCircuit(
  circuit: CircuitWorkout,
  countdownEnabled = true,
): TimerPhase[] {
  const phases: TimerPhase[] = [];
  const stationCount = circuit.stations.length;
  const rounds = circuit.rounds;

  for (let r = 0; r < rounds; r++) {
    for (let s = 0; s < stationCount; s++) {
      const station = circuit.stations[s];
      const name = station.name?.trim() || `Станция ${s + 1}`;
      const workSec = station.workSec ?? 45;

      if (countdownEnabled) {
        phases.push({
          kind: 'prep',
          durationSec: 3,
          label: 'Приготовьтесь',
        });
      }

      phases.push({
        kind: 'work',
        durationSec: workSec,
        label: name,
      });

      const isLastStation = s === stationCount - 1;
      if (!isLastStation) {
        const rest = station.restSec ?? circuit.transitionSec ?? 15;
        if (rest > 0) {
          phases.push({
            kind: 'rest',
            durationSec: rest,
            label: 'Отдых станции',
          });
        }
      }
    }
    if (r < rounds - 1) {
      const roundRest = circuit.restBetweenRoundsSec ?? 60;
      if (roundRest > 0) {
        phases.push({
          kind: 'roundRest',
          durationSec: roundRest,
          label: `Отдых круга ${r + 1}`,
        });
      }
    }
  }
  return phases;
}
