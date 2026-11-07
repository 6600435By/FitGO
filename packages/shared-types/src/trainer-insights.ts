/** Forma Coach «Помощник» insights for trainer home. */

export type TrainerInsightKind =
  | 'package_expiring'
  | 'client_ghosting'
  | 'birthday'
  | 'cancel_streak'
  | 'no_measurement'
  | 'new_without_profile'
  | 'pt_no_plan'
  | 'group_low_fill'
  | 'timesheet_open'
  | 'ladder_near'
  | 'pt_no_doc'
  | 'ledger_debt'
  | 'ledger_package_expiring'
  | 'hold_expiring'
  | 'control_pending'
  | 'goal_deadline'
  | 'visit_frequency_drop'
  | 'group_journal_open'
  | 'hold_slot_freed'
  | 'homework_stalled'
  | 'homework_done_praise';

export interface TrainerInsightAction {
  label: string;
  /** In-app path, e.g. /trainer/clients/:id */
  href?: string;
  /** Prefill for chat / SMS template. */
  messageTemplate?: string;
}

export interface TrainerInsight {
  key: string;
  kind: TrainerInsightKind;
  title: string;
  body: string;
  /** Lower = more urgent; home shows top 3 by priority then kind. */
  priority: number;
  clientId?: string;
  clientName?: string;
  action?: TrainerInsightAction;
}

export interface TrainerInsightsResponse {
  insights: TrainerInsight[];
  generatedAt: string;
}

export interface DismissTrainerInsightBody {
  key: string;
  /** Days to snooze; default 3. */
  days?: number;
}
