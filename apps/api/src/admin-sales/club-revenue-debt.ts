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
