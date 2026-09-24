import type { AdminSaleType } from '@fitgo/shared-types';

/** Map 1C / analytics saleType + product name → payroll buckets. */
export function normalizeSaleType(
  rawType: string | undefined,
  productName?: string | null,
): AdminSaleType {
  const t = (rawType ?? '').toLowerCase();
  const name = (productName ?? '').toLowerCase();

  // Name wins over raw type: 1C used to tag solarium packages as membership
  // because ЧленствоПакетУслуг is filled on «Солярий 30/60».
  if (
    t.includes('solarium') ||
    t.includes('соляри') ||
    name.includes('соляри')
  ) {
    return 'solarium';
  }
  if (
    t.includes('massage') ||
    t.includes('массаж') ||
    name.includes('массаж') ||
    name.includes('спа')
  ) {
    return 'massage';
  }
  if (
    t.includes('product') ||
    t.includes('shop') ||
    t.includes('магазин') ||
    t.includes('товар') ||
    t.includes('бар') ||
    name.includes('бар')
  ) {
    return 'shop';
  }
  if (
    t.includes('membership') ||
    t.includes('абонемент') ||
    t.includes('member') ||
    t === 'kp' ||
    name.includes('абонемент') ||
    name.includes('vip') ||
    name.includes('все включено') ||
    name.includes('клубн')
  ) {
    return 'membership';
  }
  if (t.includes('service') || t.includes('услуг')) {
    return 'massage';
  }
  return 'shop';
}

export function majorToMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function startOfDayUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function endOfDayUtc(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999Z`);
}

export function attributionLabel(
  mode: 'individual' | 'shiftShare' | undefined,
): string {
  return mode === 'shiftShare' ? 'По графику смены' : 'Тому, кто продал';
}
