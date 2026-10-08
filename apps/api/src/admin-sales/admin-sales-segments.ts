import { ConfigService } from '@nestjs/config';
import type { AdminSaleType } from '@fitgo/shared-types';
import { normalizeSaleType } from './admin-sales.util';

/**
 * Nomenclature segments (e1cib → UUID as in Integration / club 1C).
 * Абонементы / Спа / Магазин / Солярий — ЗП админов;
 * Тренировки — дашборд + учёт ПТ (не в % админа).
 */
export const PAYROLL_SEGMENT_UUIDS = {
  membership: '8deca45d-36c3-2cf1-11f1-b9b9443ea0e2', // Абонементы для приложения
  spa: '8deca45d-36c3-2cf1-11f1-b9bd204f566c', // Спа кабинет приложение
  shop: '8deca45d-36c3-2cf1-11f1-b9bc96765cb9', // Магазин приложение
  /** e1cib ref 81197085c20c362e11eb227969a8b477 */
  solarium: '69a8b477-2279-11eb-8119-7085c20c362e',
  /** e1cib ref 81167085c20c362e11eb0959bebe7aeb — продажи тренеров / ПТ */
  training: 'bebe7aeb-0959-11eb-8116-7085c20c362e',
} as const;

export type PayrollSegmentSets = {
  membership: Set<string>;
  spa: Set<string>;
  shop: Set<string>;
  solarium: Set<string>;
  training: Set<string>;
};

/** Admin payroll buckets + training (dashboard / PT, not admin %). */
export type SaleClassifyBucket = AdminSaleType | 'training';

let cache: { at: number; sets: PayrollSegmentSets } | null = null;
const CACHE_MS = 15 * 60 * 1000;

function normNom(name: string) {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

function fitgoBaseUrl(config: ConfigService): string | null {
  const explicit = config.get<string>('FORMA_FITGO_URL')?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const analytics = config.get<string>('FORMA_ANALYTICS_URL')?.trim();
  if (!analytics) return null;
  return analytics.replace(/\/analytics\/v1\/?$/, '/fitgo/v1');
}

async function fetchSegmentMembers(
  base: string,
  apiKey: string,
  basicAuth: string,
  query: string,
): Promise<Set<string>> {
  const res = await fetch(`${base}/segments/members?${query}`, {
    headers: { apikey: apiKey, Authorization: `Basic ${basicAuth}` },
  });
  if (!res.ok) return new Set();
  const body = (await res.json()) as {
    data?: { found?: boolean; data?: Array<{ name?: string }> };
  };
  const rows = body.data?.data ?? [];
  return new Set(rows.map((row) => normNom(row.name ?? '')).filter(Boolean));
}

async function segmentNames(
  base: string,
  apiKey: string,
  basicAuth: string,
  uuid: string,
  key?: string,
): Promise<Set<string>> {
  if (key) {
    const byKey = await fetchSegmentMembers(
      base,
      apiKey,
      basicAuth,
      `key=${encodeURIComponent(key)}`,
    );
    if (byKey.size) return byKey;
  }
  return fetchSegmentMembers(
    base,
    apiKey,
    basicAuth,
    `uuid=${encodeURIComponent(uuid)}`,
  );
}

/** Live 1C segment compositions (cached 15 min). Null when FitGO Integration unreachable. */
export async function loadPayrollSegmentSets(
  config: ConfigService,
): Promise<PayrollSegmentSets | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.sets;
  const base = fitgoBaseUrl(config);
  const apiKey = config.get<string>('FORMA_API_KEY')?.trim();
  const basicAuth = config.get<string>('FORMA_BASIC_AUTH')?.trim();
  if (!base || !apiKey || !basicAuth) return cache?.sets ?? null;
  try {
    const [membership, spa, shop, solarium, training] = await Promise.all([
      segmentNames(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.membership,
        'nom.membershipApp',
      ),
      segmentNames(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.spa,
        'nom.spaCabinet',
      ),
      segmentNames(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.shop,
        'nom.shop',
      ),
      segmentNames(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.solarium,
        'nom.solarium',
      ),
      segmentNames(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.training,
        'nom.training',
      ),
    ]);
    const sets: PayrollSegmentSets = {
      membership,
      spa,
      shop,
      solarium,
      training,
    };
    if (
      !membership.size &&
      !spa.size &&
      !shop.size &&
      !solarium.size &&
      !training.size
    ) {
      return cache?.sets ?? null;
    }
    cache = { at: Date.now(), sets };
    return sets;
  } catch {
    return cache?.sets ?? null;
  }
}

/**
 * Classify product. Segment membership wins over raw Analytics saleType.
 * `training` = сегмент «Тренировки» — дашборд / ПТ, не % админа.
 */
export function classifySaleType(
  rawType: string | undefined,
  productName: string | null | undefined,
  segments: PayrollSegmentSets | null,
): SaleClassifyBucket {
  const key = normNom(productName ?? '');
  if (segments && key) {
    if (segments.shop.has(key)) return 'shop';
    if (segments.spa.has(key)) return 'massage';
    if (segments.solarium.has(key)) return 'solarium';
    if (segments.training.has(key)) return 'training';
    if (segments.membership.has(key)) return 'membership';
  }
  const t = (rawType ?? '').toLowerCase();
  if (t === 'training') return 'training';
  return normalizeSaleType(rawType, productName);
}
