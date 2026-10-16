/**
 * Map ClubRevenue unpaid rows → 1C seller via SaleTransaction sale-doc keys.
 * Cash/debt exports often leave employeeExternalId empty on unpaid lines.
 *
 * Do not backfill PT / training lines from SaleTransaction: register «Сотрудник»
 * is the seller/manager; trainer is 1C «Исполнитель» (Analytics employee* after publish).
 */

export { saleDocIdsForRevenueRow } from './payment-basis-products';
import { saleDocIdsForRevenueRow } from './payment-basis-products';

function isTrainingRevenueRow(row: {
  saleType?: string | null;
  productName?: string | null;
}): boolean {
  if ((row.saleType ?? '').toLowerCase() === 'training') return true;
  const p = (row.productName ?? '').toLowerCase();
  if (!p) return false;
  if (p.includes('занятие с тренер') || p.includes('занятие с трен')) return true;
  if (p.includes('персональн') && p.includes('трен')) return true;
  if (p.includes('парное занятие')) return true;
  return false;
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
    saleType?: string | null;
    productName?: string | null;
  },
>(
  row: T,
  staffBySaleDoc: Map<
    string,
    { employeeExternalId: string; employeeName: string }
  >,
): T {
  if (row.employeeExternalId?.trim()) return row;
  // PT paid from ЛС often has empty employee in cash export; SaleTransaction
  // seller is the manager (Гилева…), not Исполнитель — do not invent attribution.
  if (isTrainingRevenueRow(row)) return row;
  for (const saleDoc of saleDocIdsForRevenueRow(row)) {
    const hit = staffBySaleDoc.get(saleDoc);
    if (hit) {
      return {
        ...row,
        employeeExternalId: hit.employeeExternalId,
        employeeName: hit.employeeName,
      };
    }
  }
  return row;
}
