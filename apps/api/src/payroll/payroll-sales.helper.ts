import { FitgoAnalyticsHttpProvider } from '@fitgo/1c-adapter';
import type { StaffSalesBreakdown } from '@fitgo/shared-types';

/** Map Analytics bySaleType keys → payroll buckets (amounts in major currency units). */
function bucketSaleType(saleType: string): 'membership' | 'service' | 'shop' | null {
  const t = saleType.toLowerCase();
  if (
    t.includes('membership') ||
    t.includes('абонемент') ||
    t.includes('member') ||
    t === 'kp' ||
    t.includes('корп') && t.includes('пакет')
  ) {
    return 'membership';
  }
  if (
    t.includes('product') ||
    t.includes('shop') ||
    t.includes('магазин') ||
    t.includes('товар')
  ) {
    return 'shop';
  }
  if (
    t.includes('service') ||
    t.includes('услуг') ||
    t.includes('extra') ||
    t.includes('доп')
  ) {
    return 'service';
  }
  // Default unknown types to membership for club "Абонементы и КП" until mapped.
  if (t === 'membership' || t === 'subscription') return 'membership';
  if (t === 'product') return 'shop';
  if (t === 'service') return 'service';
  return null;
}

function majorToMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function createAnalyticsProvider(env: {
  baseUrl?: string;
  apiKey?: string;
  basicAuth?: string;
}): FitgoAnalyticsHttpProvider | null {
  const baseUrl = env.baseUrl?.trim();
  const apiKey = env.apiKey?.trim();
  const basicAuth = env.basicAuth?.trim();
  if (!baseUrl || !apiKey || !basicAuth) return null;
  return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
}

export async function fetchStaffSalesFromAnalytics(
  provider: FitgoAnalyticsHttpProvider,
  params: {
    from: string;
    to: string;
    employeeExternalId?: string | null;
  },
): Promise<Omit<StaffSalesBreakdown, 'corporateMinor'> | null> {
  try {
    const stats = await provider.getEmployeeStats({
      from: params.from,
      to: params.to,
    });
    if (!stats?.items?.length) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        fromAnalytics: true,
        hint: 'Analytics: нет строк продаж за период',
      };
    }

    let membership = 0;
    let service = 0;
    let shop = 0;

    const rows = params.employeeExternalId
      ? stats.items.filter(
          (i) =>
            i.employeeExternalId === params.employeeExternalId ||
            i.employeeExternalId?.replace(/^0+/, '') ===
              params.employeeExternalId?.replace(/^0+/, ''),
        )
      : [];

    if (params.employeeExternalId && rows.length === 0) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        fromAnalytics: true,
        hint: `Analytics: нет продаж для employeeCode=${params.employeeExternalId}`,
      };
    }

    for (const row of rows) {
      if (row.bySaleType && Object.keys(row.bySaleType).length > 0) {
        for (const [saleType, amount] of Object.entries(row.bySaleType)) {
          const bucket = bucketSaleType(saleType);
          const minor = majorToMinor(amount);
          if (bucket === 'membership') membership += minor;
          else if (bucket === 'service') service += minor;
          else if (bucket === 'shop') shop += minor;
          else membership += minor;
        }
      } else {
        membership += majorToMinor(row.salesAmount ?? row.netAmount ?? 0);
      }
    }

    return {
      membershipMinor: membership,
      extraServicesMinor: service,
      shopMinor: shop,
      fromAnalytics: true,
    };
  } catch (e) {
    return {
      membershipMinor: 0,
      extraServicesMinor: 0,
      shopMinor: 0,
      fromAnalytics: false,
      hint:
        e instanceof Error
          ? `Analytics недоступен: ${e.message}`
          : 'Analytics недоступен',
    };
  }
}
