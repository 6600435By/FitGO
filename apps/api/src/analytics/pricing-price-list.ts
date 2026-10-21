import { ConfigService } from '@nestjs/config';
import { PAYROLL_SEGMENT_UUIDS } from '../admin-sales/admin-sales-segments';

export type PricingPriceMap = Map<
  string,
  { name: string; priceMinor: number }
>;

type SegmentPriceCache = {
  at: number;
  bySegment: Record<string, PricingPriceMap>;
};

const CACHE_MS = 15 * 60 * 1000;
let cache: SegmentPriceCache | null = null;

function fitgoBaseUrl(config: ConfigService): string | null {
  const explicit = config.get<string>('FORMA_FITGO_URL')?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const analytics = config.get<string>('FORMA_ANALYTICS_URL')?.trim();
  if (!analytics) return null;
  return analytics.replace(/\/analytics\/v1\/?$/, '/fitgo/v1');
}

async function fetchMembers(
  base: string,
  apiKey: string,
  basicAuth: string,
  query: string,
): Promise<Array<{ externalId: string; name: string; priceMinor: number }>> {
  const res = await fetch(`${base}/segments/members?${query}`, {
    headers: { apikey: apiKey, Authorization: `Basic ${basicAuth}` },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data?: {
      data?: Array<{
        name?: string;
        externalId?: string;
        price?: number;
      }>;
    };
  };
  const rows = body.data?.data ?? [];
  const out: Array<{ externalId: string; name: string; priceMinor: number }> =
    [];
  for (const row of rows) {
    const id = (row.externalId ?? '').trim().toLowerCase();
    if (!id) continue;
    out.push({
      externalId: id,
      name: (row.name ?? '').trim(),
      priceMinor: Math.round(Number(row.price ?? 0) * 100),
    });
  }
  return out;
}

async function loadOne(
  base: string,
  apiKey: string,
  basicAuth: string,
  uuid: string,
  key?: string,
): Promise<PricingPriceMap> {
  const map: PricingPriceMap = new Map();
  const queries: string[] = [];
  if (key) queries.push(`key=${encodeURIComponent(key)}`);
  queries.push(`uuid=${encodeURIComponent(uuid)}`);
  for (const q of queries) {
    const rows = await fetchMembers(base, apiKey, basicAuth, q);
    if (!rows.length) continue;
    for (const r of rows) {
      map.set(r.externalId, { name: r.name, priceMinor: r.priceMinor });
    }
    if (map.size) break;
  }
  return map;
}

/** List prices from 1C nomenclature segments (cached 15 min). */
export async function loadSegmentPriceLists(
  config: ConfigService,
): Promise<{
  bySegment: Record<string, PricingPriceMap>;
  asOf: string | null;
}> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return {
      bySegment: cache.bySegment,
      asOf: new Date(cache.at).toISOString(),
    };
  }
  const base = fitgoBaseUrl(config);
  const apiKey = config.get<string>('FORMA_API_KEY')?.trim();
  const basicAuth = config.get<string>('FORMA_BASIC_AUTH')?.trim();
  if (!base || !apiKey || !basicAuth) {
    return { bySegment: cache?.bySegment ?? {}, asOf: null };
  }
  try {
    const [membership, spa, shop, solarium, training] = await Promise.all([
      loadOne(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.membership,
        'nom.membershipApp',
      ),
      loadOne(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.spa,
        'nom.spaCabinet',
      ),
      loadOne(base, apiKey, basicAuth, PAYROLL_SEGMENT_UUIDS.shop, 'nom.shop'),
      loadOne(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.solarium,
        'nom.solarium',
      ),
      loadOne(
        base,
        apiKey,
        basicAuth,
        PAYROLL_SEGMENT_UUIDS.training,
        'nom.training',
      ),
    ]);
    const bySegment = {
      membership,
      spa,
      shop,
      solarium,
      training,
    };
    cache = { at: Date.now(), bySegment };
    return { bySegment, asOf: new Date(cache.at).toISOString() };
  } catch {
    return {
      bySegment: cache?.bySegment ?? {},
      asOf: cache ? new Date(cache.at).toISOString() : null,
    };
  }
}

export function clearSegmentPriceListCache() {
  cache = null;
}
