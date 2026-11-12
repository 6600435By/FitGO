import type { WorkUnit } from '@fitgo/shared-types';

export type WorkUnitStatusLevel = 'ok' | 'gift' | 'check' | 'excluded';

export type WorkUnitStatus = {
  level: WorkUnitStatusLevel;
  label: string;
  reason?: string;
};

export type StatusFilter = 'ALL' | 'IN_PAY' | 'CHECK' | 'EXCLUDED';

export type AttentionKind =
  | 'controlMiss'
  | 'excluded'
  | 'noEarn'
  | 'catalog'
  | 'anomaly';

export type AttentionChip = {
  kind: AttentionKind;
  count: number;
  /** Optional money sum in minor units (earn or sold). */
  amountMinor?: number;
  label: string;
};

function hintReason(u: WorkUnit): string | undefined {
  const hints = (u.trustHints ?? []).filter(
    (h) => h && h !== 'В расчёте' && h !== 'В расчете',
  );
  return hints.length ? hints.join(' · ') : undefined;
}

/**
 * Human-readable status for a payroll work unit.
 * Prefer actionable labels over GREEN/AMBER/RED dots.
 */
export function classifyWorkUnit(u: WorkUnit): WorkUnitStatus {
  if (u.isComplimentary) {
    return {
      level: 'gift',
      label: 'подарок',
      reason: 'в счёт ступени, без оплаты',
    };
  }

  if (!u.payrollTrusted) {
    const reason =
      hintReason(u) ||
      (u.trustBand === 'RED'
        ? 'не в расчёте'
        : u.trustBand === 'AMBER'
          ? 'ожидает подтверждения'
          : 'не в ЗП');
    return {
      level: 'excluded',
      label: 'не в ЗП',
      reason,
    };
  }

  if (u.spaBlockPriceSource === 'CATALOG') {
    return {
      level: 'check',
      label: 'проверить',
      reason: 'цена из каталога −N%, проверить оплату',
    };
  }

  const payKind = u.kind === 'PT' || u.kind === 'SPA' || u.kind === 'GROUP';
  if (payKind) {
    const hasPrice = (u.priceMinor ?? 0) > 0;
    const earnMissing = u.earnMinor == null || u.earnMinor === 0;
    if (hasPrice && earnMissing) {
      return {
        level: 'check',
        label: 'проверить',
        reason: 'нет начисления — проверьте ставку на дату',
      };
    }
    if (!hasPrice && u.kind !== 'GROUP' && u.earnMinor == null) {
      return {
        level: 'check',
        label: 'проверить',
        reason: 'нет цены / основы для %',
      };
    }
  }

  const reason = hintReason(u);
  if (reason && u.trustBand !== 'GREEN') {
    return {
      level: 'check',
      label: 'проверить',
      reason,
    };
  }

  return { level: 'ok', label: 'в ЗП' };
}

export function matchesStatusFilter(
  status: WorkUnitStatus,
  filter: StatusFilter,
): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'IN_PAY') return status.level === 'ok' || status.level === 'gift';
  if (filter === 'CHECK') return status.level === 'check';
  return status.level === 'excluded';
}

export function statusRowClass(level: WorkUnitStatusLevel): string {
  if (level === 'excluded') {
    return 'border-l-2 border-l-red-400/70 bg-red-500/[0.04]';
  }
  if (level === 'check') {
    return 'border-l-2 border-l-amber-400/70 bg-amber-500/[0.04]';
  }
  if (level === 'gift') {
    return 'border-l-2 border-l-violet-400/50';
  }
  return 'border-l-2 border-l-transparent';
}

export function statusBadgeClass(level: WorkUnitStatusLevel): string {
  if (level === 'excluded') return 'text-red-300';
  if (level === 'check') return 'text-amber-300';
  if (level === 'gift') return 'text-violet-300';
  return 'text-slate-500';
}

/** Units that need attention from the payroll summary alone. */
export function attentionFromUnits(units: WorkUnit[]): {
  excluded: WorkUnit[];
  noEarn: WorkUnit[];
  catalog: WorkUnit[];
  gifts: WorkUnit[];
  checkOrExcluded: WorkUnit[];
} {
  const excluded: WorkUnit[] = [];
  const noEarn: WorkUnit[] = [];
  const catalog: WorkUnit[] = [];
  const gifts: WorkUnit[] = [];
  const checkOrExcluded: WorkUnit[] = [];

  for (const u of units) {
    const st = classifyWorkUnit(u);
    if (u.isComplimentary) gifts.push(u);
    if (st.level === 'excluded') excluded.push(u);
    if (st.level === 'check' || st.level === 'excluded') {
      checkOrExcluded.push(u);
    }
    if (
      st.level === 'check' &&
      st.reason?.includes('нет начисления')
    ) {
      noEarn.push(u);
    }
    if (u.spaBlockPriceSource === 'CATALOG') catalog.push(u);
  }

  return { excluded, noEarn, catalog, gifts, checkOrExcluded };
}

export function buildAttentionChips(input: {
  controlMissCount: number;
  units: WorkUnit[];
  anomalyHints: string[];
}): AttentionChip[] {
  const { excluded, noEarn, catalog } = attentionFromUnits(input.units);
  const chips: AttentionChip[] = [];

  if (input.controlMissCount > 0) {
    chips.push({
      kind: 'controlMiss',
      count: input.controlMissCount,
      label: 'Не прошли контроль',
    });
  }
  if (excluded.length > 0) {
    chips.push({
      kind: 'excluded',
      count: excluded.length,
      label: 'Не в ЗП',
    });
  }
  if (noEarn.length > 0) {
    chips.push({
      kind: 'noEarn',
      count: noEarn.length,
      label: 'Нет начисления',
    });
  }
  if (catalog.length > 0) {
    chips.push({
      kind: 'catalog',
      count: catalog.length,
      label: 'Цена из каталога',
    });
  }
  if (input.anomalyHints.length > 0) {
    chips.push({
      kind: 'anomaly',
      count: input.anomalyHints.length,
      label: 'Подсказки',
    });
  }
  return chips;
}

export type ReportTabId =
  | 'overview'
  | 'pt'
  | 'group'
  | 'reformer'
  | 'spa'
  | 'shift'
  | 'gifts'
  | 'attention'
  | 'adjustments';

/** Group reformer hall or personal reformer PT. */
export function isReformerWorkUnit(u: WorkUnit): boolean {
  return Boolean(u.isReformerPersonal) || u.roomKey === 'REFORMER';
}

export function tabForAttention(kind: AttentionKind): ReportTabId {
  if (kind === 'anomaly') return 'overview';
  return 'attention';
}

export function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

export function unitEarnMinor(u: WorkUnit): number {
  if (u.isComplimentary || !u.payrollTrusted) return 0;
  if (u.earnMinor != null) return u.earnMinor;
  if (u.kind === 'SHIFT' && u.priceMinor != null) return u.priceMinor;
  return 0;
}

export function unitSoldMinor(u: WorkUnit): number {
  if (
    (u.kind === 'SPA' || u.kind === 'PT') &&
    u.priceMinor != null &&
    u.priceMinor > 0 &&
    u.payrollTrusted &&
    !u.isComplimentary
  ) {
    return u.priceMinor;
  }
  return 0;
}

export function sumEarn(units: WorkUnit[]): number {
  return units.reduce((acc, u) => acc + unitEarnMinor(u), 0);
}

export function sumSold(units: WorkUnit[]): number {
  return units.reduce((acc, u) => acc + unitSoldMinor(u), 0);
}

export function filterUnitsByKind(
  units: WorkUnit[],
  kind: 'PT' | 'GROUP' | 'SPA' | 'SHIFT' | 'GIFTS' | 'REFORMER',
): WorkUnit[] {
  if (kind === 'REFORMER') return units.filter(isReformerWorkUnit);
  if (kind === 'GIFTS') return units.filter((u) => u.isComplimentary);
  if (kind === 'PT') {
    return units.filter((u) => u.kind === 'PT' && !isReformerWorkUnit(u));
  }
  if (kind === 'GROUP') {
    return units.filter((u) => u.kind === 'GROUP' && !isReformerWorkUnit(u));
  }
  return units.filter((u) => u.kind === kind);
}
