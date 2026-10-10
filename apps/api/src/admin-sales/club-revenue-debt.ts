/**
 * Open client debt is the 1C register balance (ТипРасчета = Долг, СуммаОстаток < 0).
 * A cash refund must not be stored again as an unpaid sale, and a deleted
 * basis document is not a debt on the counterparty card.
 */
export function isCollectibleClientDebt(row: {
  externalId?: string | null;
  productName?: string | null;
}): boolean {
  const id = row.externalId ?? '';
  if (id.includes(':refund:')) return false;
  const name = (row.productName ?? '').trim().toLowerCase();
  if (name === 'возврат') return false;
  if (name.includes('(удален)')) return false;
  return true;
}

/** 1C labels staff buyers as «Имя (сотрудник)» on unpaid sales / debt tasks. */
const STAFF_DEBTOR_RE = /\(\s*сотрудник\s*\)/i;

export function isStaffDebtorName(
  clientName?: string | null,
  title?: string | null,
): boolean {
  if (clientName && STAFF_DEBTOR_RE.test(clientName)) return true;
  if (title && (/долг сотрудника/i.test(title) || STAFF_DEBTOR_RE.test(title))) {
    return true;
  }
  return false;
}
