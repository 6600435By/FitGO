import { Gender } from '@prisma/client';

const MALE_ADJECTIVES = [
  'Мощный',
  'Сердитый',
  'Железный',
  'Ночной',
  'Скрытый',
  'Быстрый',
  'Дикий',
  'Стальной',
  'Легендарный',
  'Упрямый',
];

const FEMALE_ADJECTIVES = [
  'Мощная',
  'Сердитая',
  'Железная',
  'Ночная',
  'Скрытая',
  'Быстрая',
  'Дикая',
  'Стальная',
  'Легендарная',
  'Упрямая',
];

const NEUTRAL_ADJECTIVES = [
  'Fit',
  'Pro',
  'Turbo',
  'Mega',
  'Ultra',
  'Super',
  'Active',
  'Power',
];

const NOUNS = [
  'Кабан',
  'Гантеля',
  'Пельмень',
  'Бегун',
  'Планка',
  'Атлет',
  'Тигр',
  'Медведь',
  'Спринтер',
  'Боксёр',
  'Йogi',
  'Кроссфитер',
  'Штанга',
  'Бицепс',
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function suggestNickname(gender?: Gender | null): string {
  let adjective: string;
  if (gender === Gender.MALE) {
    adjective = pick(MALE_ADJECTIVES);
  } else if (gender === Gender.FEMALE) {
    adjective = pick(FEMALE_ADJECTIVES);
  } else {
    adjective = pick([...NEUTRAL_ADJECTIVES, ...MALE_ADJECTIVES, ...FEMALE_ADJECTIVES]);
  }
  return `${adjective} ${pick(NOUNS)}`;
}
