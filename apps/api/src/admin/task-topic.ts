export type AdminTaskTopic =
  | 'staff_debt'
  | 'client_debt'
  | 'membership'
  | 'installment'
  | 'manager'
  | 'other';

/** Display filter for auto / manager tasks. Legacy MANUAL stays in «Все». */
export function adminTaskTopic(input: {
  source?: string | null;
  title?: string | null;
  clientName?: string | null;
}): AdminTaskTopic {
  const source = input.source ?? '';
  const title = input.title ?? '';
  const client = input.clientName ?? '';
  if (source === 'MEMBERSHIP_EXPIRING') return 'membership';
  if (source === 'INSTALLMENT_PAYMENT') return 'installment';
  if (source === 'MANAGER') return 'manager';
  if (
    source === 'STAFF_DEBT' ||
    source === 'CLIENT_DEBT' ||
    source === 'DEBT_OVERDUE'
  ) {
    if (
      source === 'STAFF_DEBT' ||
      /\(\s*сотрудник\s*\)/i.test(client) ||
      /долг сотрудника/i.test(title)
    ) {
      return 'staff_debt';
    }
    return 'client_debt';
  }
  return 'other';
}
