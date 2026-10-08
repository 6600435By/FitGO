import type { AdminSaleType } from '@fitgo/shared-types';

/** Map 1C / analytics saleType + product name → payroll buckets. */
export function normalizeSaleType(
  rawType: string | undefined,
  productName?: string | null,
): AdminSaleType {
  const t = (rawType ?? '').toLowerCase();
  const name = (productName ?? '').toLowerCase();

  // «Тренировки» — дашборд / ПТ тренеров, не % админа (см. classifySaleType).
  // Without segment sets, leave as shop so it does not inflate membership %.
  if (t === 'training') return 'shop';

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

/**
 * Motivation base (major): cash + card + personalAccount.
 * Excludes cashless. Falls back when split not yet synced.
 */
export function motivationAmountMajor(row: {
  amount: number;
  cash?: number | null;
  card?: number | null;
  cashless?: number | null;
  personalAccount?: number | null;
  paymentMethod?: string | null;
}): number {
  const cash = Number(row.cash) || 0;
  const card = Number(row.card) || 0;
  const cashless = Number(row.cashless) || 0;
  const personalAccount = Number(row.personalAccount) || 0;
  const splitSum = cash + card + cashless + personalAccount;
  if (splitSum > 0.009) {
    return cash + card + personalAccount;
  }
  const method = (row.paymentMethod ?? '').toLowerCase();
  if (method === 'cashless') return 0;
  if (method === 'cash' || method === 'card' || method === 'personalaccount') {
    return Number(row.amount) || 0;
  }
  if (method === 'mixed') {
    // Without split, cannot isolate cashless — keep full amount until re-sync.
    return Number(row.amount) || 0;
  }
  return Number(row.amount) || 0;
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
