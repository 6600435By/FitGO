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
  /** e1cib ref 8deca45d36c32cf111f1c6f94643a7d2 — индивидуальные реформер */
  reformerPersonal: '8deca45d-36c3-2cf1-11f1-c6f94643a7d2',
} as const;

export type PayrollSegmentSets = {
  membership: Set<string>;
  spa: Set<string>;
  shop: Set<string>;
  solarium: Set<string>;
  training: Set<string>;
  reformerPersonal: Set<string>;
};

/** Admin payroll buckets + training (dashboard / PT, not admin %). */
export type SaleClassifyBucket = AdminSaleType | 'training';

let cache: { at: number; sets: PayrollSegmentSets } | null = null;
const CACHE_MS = 15 * 60 * 1000;

export function clearPayrollSegmentCache() {
  cache = null;
}

export function normNom(name: string) {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

export type SegmentMatchKey =
  | 'membership'
  | 'spa'
  | 'shop'
  | 'solarium'
  | 'training';

/** All nomenclature segments that contain this product name (normalized). */
export function matchPayrollSegments(
  productName: string | null | undefined,
  segments: PayrollSegmentSets | null,
  productExternalId?: string | null,
): SegmentMatchKey[] {
  if (!segments) return [];
  const key = normNom(productName ?? '');
  const uuid = (productExternalId ?? '').trim().toLowerCase();
  const out: SegmentMatchKey[] = [];
  const order: SegmentMatchKey[] = [
    'shop',
    'spa',
    'solarium',
    'training',
    'membership',
  ];
  for (const seg of order) {
    const set = segments[seg];
    if (key && set.has(key)) {
      out.push(seg);
      continue;
    }
    if (uuid && set.has(uuid)) out.push(seg);
  }
  return out;
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
    data?: {
      found?: boolean;
      data?: Array<{ name?: string; externalId?: string }>;
    };
  };
  const rows = body.data?.data ?? [];
  const out = new Set<string>();
  for (const row of rows) {
    const n = normNom(row.name ?? '');
    if (n) out.add(n);
    const id = (row.externalId ?? '').trim().toLowerCase();
    if (id) out.add(id);
  }
  return out;
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
    const [membership, spa, shop, solarium, training, reformerPersonal] =
      await Promise.all([
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
        segmentNames(
          base,
          apiKey,
          basicAuth,
          PAYROLL_SEGMENT_UUIDS.reformerPersonal,
        ),
      ]);
    const sets: PayrollSegmentSets = {
      membership,
      spa,
      shop,
      solarium,
      training,
      reformerPersonal,
    };
    if (
      !membership.size &&
      !spa.size &&
      !shop.size &&
      !solarium.size &&
      !training.size &&
      !reformerPersonal.size
    ) {
      return cache?.sets ?? null;
    }
    cache = { at: Date.now(), sets };
    return sets;
  } catch {
    return cache?.sets ?? null;
  }
}

/** Title match for individual reformer (conducted session or pack SKU). */
export function isReformerPersonalTitle(
  productName: string | null | undefined,
): boolean {
  return /индивидуальн.*реформер|реформер.*индивидуальн/i.test(
    productName ?? '',
  );
}

/** Match nomenclature against «Индивидуальные Реформер» segment. */
export function isReformerPersonalNomenclature(
  productName: string | null | undefined,
  productExternalId: string | null | undefined,
  segments: PayrollSegmentSets | null,
): boolean {
  // Title always wins — segment members can lag behind new SKUs in 1C.
  if (isReformerPersonalTitle(productName)) return true;
  if (!segments?.reformerPersonal?.size) return false;
  const key = normNom(productName ?? '');
  const uuid = (productExternalId ?? '').trim().toLowerCase().replace(/-/g, '');
  for (const entry of segments.reformerPersonal) {
    if (key && entry === key) return true;
    const entryId = entry.replace(/-/g, '');
    if (uuid && entryId === uuid) return true;
    if (
      productExternalId &&
      entry === (productExternalId ?? '').trim().toLowerCase()
    )
      return true;
  }
  return false;
}

/** PT / trainer SKUs — never admin membership %, even if 1C tagged membership. */
export function isLikelyTrainingProductName(
  productName: string | null | undefined,
): boolean {
  const name = (productName ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return false;
  if (name.includes('занятие с тренер')) return true;
  if (name.includes('парное занятие')) return true;
  if (/\d+\s*пт/.test(name)) return true;
  if (name.includes('персональн') && name.includes('трен')) return true;
  // «Индивидуальное занятие реформер N» — pack / write-off, not admin membership.
  if (isReformerPersonalTitle(name)) return true;
  return false;
}

/**
 * Classify product for admin payroll.
 * Абонементы в % админа — только сегмент «Абонементы для приложения».
 * «Тренировки» / ПТ — дашборд тренеров, не % админа.
 */
export function classifySaleType(
  rawType: string | undefined,
  productName: string | null | undefined,
  segments: PayrollSegmentSets | null,
  productExternalId?: string | null,
): SaleClassifyBucket {
  const key = normNom(productName ?? '');
  const uuid = (productExternalId ?? '').trim().toLowerCase();
  if (segments) {
    for (const probe of [uuid, key]) {
      if (!probe) continue;
      if (segments.shop.has(probe)) return 'shop';
      if (segments.spa.has(probe)) return 'massage';
      if (segments.solarium.has(probe)) return 'solarium';
      if (segments.training.has(probe)) return 'training';
      if (segments.membership.has(probe)) return 'membership';
    }
  }
  const t = (rawType ?? '').toLowerCase();
  if (t === 'training' || isLikelyTrainingProductName(productName)) {
    return 'training';
  }
  const bucket = normalizeSaleType(rawType, productName);
  // Сегмент абонементов загружен → в membership только его состав, без fallback по rawType.
  if (
    bucket === 'membership' &&
    segments &&
    segments.membership.size > 0 &&
    (!key || !segments.membership.has(key))
  ) {
    return 'training';
  }
  return bucket;
}
