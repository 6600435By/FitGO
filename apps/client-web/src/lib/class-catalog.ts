export interface ClassCatalogEntry {
  match: RegExp;
  blurb: string;
  intensity: 1 | 2 | 3 | 4 | 5;
  accent: string;
}

/** Soft copy for group classes — matched by title from 1C. */
export const CLASS_CATALOG: ClassCatalogEntry[] = [
  {
    match: /пилатес|pilates/i,
    blurb: 'Контроль корпуса, дыхание и точность движений.',
    intensity: 2,
    accent: '#a7f3d0',
  },
  {
    match: /йога|yoga|stretch|стретч|растяж/i,
    blurb: 'Мягкая мобильность и восстановление после нагрузок.',
    intensity: 1,
    accent: '#c4b5fd',
  },
  {
    match: /cycle|сайкл|spin|вело/i,
    blurb: 'Интервалы на байке под музыку — кардио на максимум.',
    intensity: 5,
    accent: '#fca5a5',
  },
  {
    match: /functional|функцион|cross|hiit|интервал/i,
    blurb: 'Сила + выносливость в динамичном формате.',
    intensity: 4,
    accent: '#fdba74',
  },
  {
    match: /barree|barre|барр/i,
    blurb: 'Балетная пластика и силовая работа без ударной нагрузки.',
    intensity: 3,
    accent: '#f9a8d4',
  },
  {
    match: /силовая|strength|pump|атлетик/i,
    blurb: 'Работа с весом тела и оборудованием на силу.',
    intensity: 4,
    accent: '#93c5fd',
  },
  {
    match: /танц|dance|zumba|латин/i,
    blurb: 'Кардио через движение и ритм.',
    intensity: 3,
    accent: '#fcd34d',
  },
];

const FALLBACK: Omit<ClassCatalogEntry, 'match'> = {
  blurb: 'Групповое занятие студии Forma. Приходите за 5–10 минут до старта.',
  intensity: 3,
  accent: '#ffd000',
};

export function lookupClass(title: string) {
  for (const entry of CLASS_CATALOG) {
    if (entry.match.test(title)) {
      return {
        blurb: entry.blurb,
        intensity: entry.intensity,
        accent: entry.accent,
      };
    }
  }
  return FALLBACK;
}

export function timeOfDay(iso: string): 'morning' | 'day' | 'evening' {
  const h = new Date(iso).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'day';
  return 'evening';
}

export const TIME_OF_DAY_LABEL = {
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
} as const;

export function durationLabel(startAt: string, endAt?: string) {
  if (!endAt) return null;
  const mins = Math.round(
    (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000,
  );
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return `${mins} мин`;
}

export function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function addDaysKey(key: string, days: number) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
