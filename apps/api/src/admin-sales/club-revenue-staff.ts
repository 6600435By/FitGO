/**
 * Map ClubRevenue unpaid rows → 1C seller via SaleTransaction sale-doc keys.
 * Cash/debt exports often leave employeeExternalId empty on unpaid lines.
 */

export { saleDocIdsForRevenueRow } from './payment-basis-products';
import { saleDocIdsForRevenueRow } from './payment-basis-products';

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
