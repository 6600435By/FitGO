/** Pure settle decision for «Тренер клуб» personal package / debt. */

export type PersonalSettleDecision =
  | { action: 'skip'; reason: 'missing' | 'already_settled' | 'not_personal' | 'cancelled' }
  | { action: 'mark_complimentary' }
  | {
      action: 'debit_package';
      packageId: string;
      remaining: number;
      exhausted: boolean;
    }
  | { action: 'raise_debt'; priceMinor: number }
  | { action: 'mark_settled_zero' };

export type ActivePackageCandidate = {
  id: string;
  sessionsRemaining: number;
  status: string;
  validUntil?: Date | null;
};

/**
 * Pick the package that settlePersonalSession would debit
 * (ACTIVE, remaining > 0, not expired; earliest validUntil then soldAt).
 */
export function pickActivePackage(
  packages: ActivePackageCandidate[],
  now = new Date(),
): ActivePackageCandidate | null {
  const eligible = packages.filter(
    (p) =>
      p.status === 'ACTIVE' &&
      p.sessionsRemaining > 0 &&
      (p.validUntil == null || p.validUntil.getTime() >= now.getTime()),
  );
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    const av = a.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
    const bv = b.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
    if (av !== bv) return av - bv;
    return 0;
  });
  return eligible[0] ?? null;
}

export function afterPackageDebit(sessionsRemaining: number): {
  remaining: number;
  exhausted: boolean;
  status: 'ACTIVE' | 'EXHAUSTED';
} {
  const remaining = sessionsRemaining - 1;
  const exhausted = remaining <= 0;
  return {
    remaining,
    exhausted,
    status: exhausted ? 'EXHAUSTED' : 'ACTIVE',
  };
}

/**
 * Effective one-shot price: booking override → client override → trainer default.
 * Wall-clock / schedule never sets this.
 */
export function resolvePersonalSessionPriceMinor(input: {
  bookingPriceMinor?: number | null;
  clientSessionPriceMinor?: number | null;
  defaultSessionPriceMinor?: number | null;
}): number {
  if (input.bookingPriceMinor != null && input.bookingPriceMinor >= 0) {
    return input.bookingPriceMinor;
  }
  if (
    input.clientSessionPriceMinor != null &&
    input.clientSessionPriceMinor >= 0
  ) {
    return input.clientSessionPriceMinor;
  }
  return input.defaultSessionPriceMinor ?? 0;
}

export function decidePersonalSessionSettle(input: {
  booking: {
    ledgerSettledAt?: Date | null;
    isComplimentary?: boolean | null;
    ptFlow?: string | null;
    status?: string | null;
    priceMinor?: number | null;
  } | null;
  activePackage?: ActivePackageCandidate | null;
  defaultSessionPriceMinor?: number | null;
  /** Per-client override from TrainerClientBalance.sessionPriceMinor. */
  clientSessionPriceMinor?: number | null;
  now?: Date;
}): PersonalSettleDecision {
  const b = input.booking;
  if (!b) return { action: 'skip', reason: 'missing' };
  if (b.ledgerSettledAt) return { action: 'skip', reason: 'already_settled' };
  if (b.isComplimentary) return { action: 'mark_complimentary' };
  if (b.ptFlow !== 'PERSONAL') return { action: 'skip', reason: 'not_personal' };
  if (b.status === 'CANCELLED') return { action: 'skip', reason: 'cancelled' };

  const pkg = input.activePackage
    ? pickActivePackage([input.activePackage], input.now)
    : null;
  if (pkg) {
    const next = afterPackageDebit(pkg.sessionsRemaining);
    return {
      action: 'debit_package',
      packageId: pkg.id,
      remaining: next.remaining,
      exhausted: next.exhausted,
    };
  }

  const price = resolvePersonalSessionPriceMinor({
    bookingPriceMinor: b.priceMinor,
    clientSessionPriceMinor: input.clientSessionPriceMinor,
    defaultSessionPriceMinor: input.defaultSessionPriceMinor,
  });
  if (price > 0) return { action: 'raise_debt', priceMinor: price };
  return { action: 'mark_settled_zero' };
}

/** Late cancel / no-show may debit package only for PERSONAL flow. */
export function shouldDebitPackageOnCancel(input: {
  debitPackage?: boolean;
  ptFlow?: string | null;
}): boolean {
  return Boolean(input.debitPackage && input.ptFlow === 'PERSONAL');
}
