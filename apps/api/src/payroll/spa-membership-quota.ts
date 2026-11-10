/**
 * VIP-included SPA («Массаж классический общий» from membership) → spaQuotaRates.
 * 1C sometimes attaches a catalog unitPrice (e.g. 65 BYN) on the write-off;
 * that must not flip the row onto spaSoldPercent × unit.
 */
import { findMembershipIncludedService } from '@fitgo/shared-types';

export function isSpaVipMembershipQuota(input: {
  writeOffOrigin: string;
  sessionTitle?: string | null;
  payment?: string | null;
  paySource?: string | null;
  isServiceBlock?: boolean;
  bioimpedance?: boolean;
}): boolean {
  if (input.bioimpedance) return false;
  if (input.isServiceBlock || input.writeOffOrigin === 'BLOCK') return false;
  if (input.writeOffOrigin === 'MEMBERSHIP') return true;
  const isPackage =
    (input.paySource ?? '').toUpperCase() === 'PACKAGE' ||
    (input.payment ?? '').toUpperCase() === 'QUOTA';
  if (!isPackage) return false;
  return findMembershipIncludedService(input.sessionTitle)?.kind === 'SPA';
}

export function matchSpaQuotaRateMinor(
  title: string,
  serviceId: string | undefined,
  rates:
    | Array<{ serviceKey: string; rateMinor: number }>
    | undefined
    | null,
): number | undefined {
  if (!rates?.length) return undefined;
  const t = title.toLowerCase();
  const match = rates.find((r) => {
    if (r.serviceKey === 'BODY_COMPOSITION')
      return /состав|анализ|inbody|compos|биоимпеданс|bio.?imped/i.test(t);
    if (r.serviceKey === 'CLASSIC_MASSAGE')
      return /массаж|massage|класси/i.test(t);
    return r.serviceKey === serviceId;
  });
  return match && match.rateMinor > 0 ? match.rateMinor : undefined;
}

/** Prefer fixed VIP quota over % of unit price when spaMembershipQuota. */
export function resolveSpaSessionEarnMinor(input: {
  spaMembershipQuota?: boolean;
  priceMinor?: number | null;
  title: string;
  serviceId?: string;
  spaSoldPercent?: number | null;
  spaQuotaRates?: Array<{ serviceKey: string; rateMinor: number }> | null;
}): { earnMinor?: number; ratePercent?: number } {
  if (input.spaMembershipQuota === true) {
    const fix = matchSpaQuotaRateMinor(
      input.title,
      input.serviceId,
      input.spaQuotaRates,
    );
    if (fix != null) return { earnMinor: fix };
    return {};
  }
  const price = input.priceMinor ?? 0;
  const pct = input.spaSoldPercent;
  if (price > 0 && pct) {
    return {
      ratePercent: pct,
      earnMinor: Math.round((price * pct) / 100),
    };
  }
  return {};
}
