/** Personal motivation goals for «Тренер клуб». */

export type TrainerGoalMetric =
  | 'PT_SESSIONS'
  | 'SALES_SUM'
  | 'ACTIVE_CLIENTS'
  | 'PACKAGES_SOLD'
  | 'NEW_CLIENTS';

export const TRAINER_GOAL_METRIC_LABELS: Record<TrainerGoalMetric, string> = {
  PT_SESSIONS: 'Тренировки за месяц',
  SALES_SUM: 'Сумма продаж',
  ACTIVE_CLIENTS: 'Активные клиенты',
  PACKAGES_SOLD: 'Пакеты продано',
  NEW_CLIENTS: 'Новые клиенты',
};

export const TRAINER_GOAL_METRICS: TrainerGoalMetric[] = [
  'PT_SESSIONS',
  'SALES_SUM',
  'ACTIVE_CLIENTS',
  'PACKAGES_SOLD',
  'NEW_CLIENTS',
];

export interface TrainerPersonalGoalInput {
  metric: TrainerGoalMetric;
  /** Sessions / clients / packages count, or sales in minor units. */
  target: number;
}

export interface TrainerPersonalGoalProgress {
  metric: TrainerGoalMetric;
  label: string;
  target: number;
  current: number;
  /** 0–100 capped. */
  percent: number;
  /** For SALES_SUM: display as money. */
  unit: 'count' | 'money_minor';
}

export interface TrainerPersonalGoalsResponse {
  goals: TrainerPersonalGoalProgress[];
  month: string; // YYYY-MM
}
