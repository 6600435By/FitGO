/** Built-in homework templates for Forma Coach (trainer → client). */

export type HomeworkItemKind = 'exercise' | 'cardio' | 'nutrition' | 'habit';

export interface HomeworkTemplateItem {
  kind: HomeworkItemKind;
  title: string;
  target?: string;
  timesRequired?: number;
}

export interface HomeworkTemplate {
  id: string;
  title: string;
  description: string;
  items: HomeworkTemplateItem[];
}

export const HOMEWORK_TEMPLATES: HomeworkTemplate[] = [
  {
    id: 'mobility-daily',
    title: 'Мобилити каждый день',
    description: '10–15 мин растяжки до следующей ПТ',
    items: [
      {
        kind: 'exercise',
        title: 'Мобилити бёдер и грудного отдела',
        target: '10–15 мин',
        timesRequired: 4,
      },
      {
        kind: 'habit',
        title: 'Отметить самочувствие после',
        timesRequired: 4,
      },
    ],
  },
  {
    id: 'steps-z2',
    title: 'Шаги / зона 2',
    description: 'Лёгкая активность между тренировками',
    items: [
      {
        kind: 'cardio',
        title: 'Прогулка или вело',
        target: '30–40 мин, Z2',
        timesRequired: 3,
      },
      {
        kind: 'habit',
        title: '8 000 шагов за день',
        timesRequired: 5,
      },
    ],
  },
  {
    id: 'core-home',
    title: 'Кор дома',
    description: 'Короткий кор 3 раза до следующей ПТ',
    items: [
      {
        kind: 'exercise',
        title: 'Планка',
        target: '3 × 40–60 сек',
        timesRequired: 3,
      },
      {
        kind: 'exercise',
        title: 'Dead bug или bird-dog',
        target: '3 × 8 на сторону',
        timesRequired: 3,
      },
    ],
  },
  {
    id: 'protein-water',
    title: 'Белок и вода',
    description: 'Питательные привычки до следующей встречи',
    items: [
      {
        kind: 'nutrition',
        title: 'Белок в каждый приём пищи',
        target: 'ладонь / порция',
        timesRequired: 5,
      },
      {
        kind: 'habit',
        title: '2 л воды за день',
        timesRequired: 5,
      },
    ],
  },
  {
    id: 'technique-drill',
    title: 'Техника движения',
    description: 'Закрепить паттерн без большой нагрузки',
    items: [
      {
        kind: 'exercise',
        title: 'Разбор техники из тренировки',
        target: '2–3 подхода лёгких',
        timesRequired: 3,
      },
      {
        kind: 'habit',
        title: 'Короткое видео себе / заметка',
        timesRequired: 1,
      },
    ],
  },
  {
    id: 'sleep-recovery',
    title: 'Сон и восстановление',
    description: 'Режим до следующей ПТ',
    items: [
      {
        kind: 'habit',
        title: 'Лёг до 23:00',
        timesRequired: 4,
      },
      {
        kind: 'habit',
        title: 'Без экрана за 30 мин до сна',
        timesRequired: 4,
      },
    ],
  },
];

export function getHomeworkTemplate(
  templateId: string,
): HomeworkTemplate | undefined {
  return HOMEWORK_TEMPLATES.find((t) => t.id === templateId);
}
