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
  blurb: 'Групповое занятие студии Форма. Приходите за 5–10 минут до старта.',
  intensity: 3,
  accent: '#ffd000',
};

/** Known English / mixed titles → Russian for client schedule. */
const TITLE_ALIASES: Array<[RegExp, string]> = [
  [/^pilates(?:\s+reformer)?$/i, 'Пилатес'],
  [/^yoga$/i, 'Йога'],
  [/^stretch(?:ing)?$/i, 'Стретчинг'],
  [/^functional(?:\s+training)?$/i, 'Функциональный тренинг'],
  [/^hiit$/i, 'HIIT'],
  [/^(?:cycle|spin(?:ning)?)$/i, 'Сайкл'],
  [/^barre+$/i, 'Барре'],
  [/^zumba$/i, 'Зумба'],
  [/^pump|body\s*pump$/i, 'Силовая'],
  [/^cross(?:fit)?$/i, 'Кросс'],
  [/^personal(?:\s+training)?$|^pt$/i, 'Персональная'],
];

function softenWordCase(word: string): string {
  if (word.length <= 1) return word;
  const letters = word.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
  if (!letters) return word;
  const upper = letters === letters.toLocaleUpperCase('ru-RU');
  const lower = letters === letters.toLocaleLowerCase('ru-RU');
  if (!upper || lower) return word;
  return word.charAt(0) + word.slice(1).toLocaleLowerCase('ru-RU');
}

/** Client-facing class title: no ALL CAPS / raw English catalog codes. */
export function formatClassTitle(raw: string | null | undefined): string {
  const t = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  for (const [re, label] of TITLE_ALIASES) {
    if (re.test(t)) return label;
  }
  return t.split(' ').map(softenWordCase).join(' ');
}

/** Фамилия + Имя only (drop отчество / extra tokens); soften ALL CAPS. */
export function formatPersonName(raw: string | null | undefined): string {
  const parts = (raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(softenWordCase);
  if (parts.length === 0) return '';
  return parts.slice(0, 2).join(' ');
}

export function formatTrainerName(
  lastName: string | null | undefined,
  firstName: string | null | undefined,
): string {
  return formatPersonName(
    [lastName?.trim(), firstName?.trim()].filter(Boolean).join(' '),
  );
}

export function ruKindWord(count: number): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return 'видов';
  if (n1 === 1) return 'вид';
  if (n1 >= 2 && n1 <= 4) return 'вида';
  return 'видов';
}

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
