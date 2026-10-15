import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomInt } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';

/** Exactly five Cyrillic letters — common nouns for staff passwords. */
const RU_FIVE_LETTER_WORDS = [
  'книга',
  'океан',
  'лимон',
  'ветер',
  'сахар',
  'город',
  'мороз',
  'песня',
  'ягода',
  'маска',
  'парта',
  'школа',
  'трава',
  'земля',
  'ручка',
  'мышка',
  'пятка',
  'банка',
  'ложка',
  'вилка',
  'носок',
  'дверь',
  'стена',
  'полка',
  'диван',
  'столб',
  'берег',
  'озеро',
  'волна',
  'поезд',
  'метро',
  'такси',
  'сумка',
  'лампа',
  'доска',
  'месяц',
  'песок',
  'глина',
  'ветка',
  'груша',
  'слива',
  'арбуз',
  'тыква',
  'редис',
  'перец',
  'булка',
  'батон',
  'сушка',
  'кефир',
  'масло',
  'халва',
  'зефир',
  'пирог',
  'кулич',
  'орехи',
  'вишня',
  'банан',
  'манго',
  'билет',
  'номер',
  'замок',
  'кухня',
  'ванна',
  'губка',
  'ковер',
  'штора',
  'тумба',
  'пуфик',
  'вазон',
  'фикус',
  'лилия',
  'сосна',
  'дубок',
  'шишка',
  'палка',
  'миска',
  'чашка',
  'блюдо',
  'топор',
  'гайка',
  'засов',
  'лента',
  'марка',
  'свеча',
  'шарик',
] as const;

const FIVE_LETTER = [
  ...new Set(
    RU_FIVE_LETTER_WORDS.filter((w) => /^[а-яё]{5}$/i.test(w)).map((w) =>
      w.toLowerCase(),
    ),
  ),
];

export function isValidStaffAppPassword(password: string): boolean {
  return password.trim().length >= 6;
}

/** Format: 5 Cyrillic letters + 2 digits, e.g. книга42 */
export function buildStaffAppPasswordCandidate(): string {
  const words =
    FIVE_LETTER.length > 0
      ? FIVE_LETTER
      : ['книга', 'океан', 'лимон', 'ветер', 'сахар', 'город', 'мороз', 'песня'];
  const word = words[randomInt(words.length)]!;
  const digits = String(randomInt(100)).padStart(2, '0');
  return `${word}${digits}`;
}

export async function allocateStaffAppPassword(
  prisma: PrismaService,
  opts?: { excludeUserId?: string; preferred?: string },
): Promise<string> {
  if (opts?.preferred?.trim()) {
    const preferred = opts.preferred.trim();
    if (!isValidStaffAppPassword(preferred)) {
      throw new BadRequestException('Пароль не короче 6 символов');
    }
    const taken = await prisma.user.findFirst({
      where: {
        appPasswordPlain: preferred,
        ...(opts.excludeUserId ? { NOT: { id: opts.excludeUserId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('Такой пароль уже занят другим сотрудником');
    }
    return preferred;
  }

  const excludeUserId = opts?.excludeUserId;
  for (let attempt = 0; attempt < 80; attempt++) {
    const candidate = buildStaffAppPasswordCandidate();
    const taken = await prisma.user.findFirst({
      where: {
        appPasswordPlain: candidate,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  throw new ConflictException(
    'Не удалось подобрать свободный пароль — попробуйте ещё раз',
  );
}
