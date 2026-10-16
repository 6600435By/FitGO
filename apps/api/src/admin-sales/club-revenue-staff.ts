/**
 * Map ClubRevenue rows → 1C sale author via SaleTransaction sale-doc keys.
 * Cash/debt exports often leave employeeExternalId empty (unpaid lines, оплата с ЛС:
 * регистратор = сама Реализация без Автора/Кассира в шапке).
 *
 * employee* = автор продажи (админ); trainer lives in performer* (Исполнитель).
 */

export { saleDocIdsForRevenueRow } from './payment-basis-products';
import { saleDocIdsForRevenueRow } from './payment-basis-products';

function sameStaffCode(a?: string | null, b?: string | null): boolean {
  const x = (a ?? '').trim().replace(/^0+/, '');
  const y = (b ?? '').trim().replace(/^0+/, '');
  return Boolean(x && y && x === y);
}

export function buildStaffBySaleDoc(
  sales: {
    externalSaleId: string;
    employeeExternalId: string | null;
    employeeName: string | null;
  }[],
): Map<string, { employeeExternalId: string; employeeName: string }> {
  const map = new Map<
    string,
    { employeeExternalId: string; employeeName: string }
  >();
  for (const s of sales) {
    const empId = s.employeeExternalId?.trim();
    if (!empId) continue;
    const saleDoc = s.externalSaleId.split(':')[0];
    if (!saleDoc || map.has(saleDoc)) continue;
    map.set(saleDoc, {
      employeeExternalId: empId,
      employeeName: s.employeeName?.trim() || empId,
    });
  }
  return map;
}

export function attachEmployeeToRevenueRow<
  T extends {
    employeeExternalId: string | null;
    employeeName: string | null;
    externalId: string;
    documentId: string | null;
    performerExternalId?: string | null;
  },
>(
  row: T,
  staffBySaleDoc: Map<
    string,
    { employeeExternalId: string; employeeName: string }
  >,
): T {
  if (row.employeeExternalId?.trim()) return row;
  for (const saleDoc of saleDocIdsForRevenueRow(row)) {
    const hit = staffBySaleDoc.get(saleDoc);
    if (!hit) continue;
    // SaleTransaction synced by an older Analytics build may hold the trainer.
    if (sameStaffCode(hit.employeeExternalId, row.performerExternalId)) continue;
    return {
      ...row,
      employeeExternalId: hit.employeeExternalId,
      employeeName: hit.employeeName,
    };
  }
  return row;
}
