/**
 * Pure membership unit-economics helpers shared by API and web what-if UI.
 */
import type {
  MembershipCostBreakdown,
  MembershipWhatIfInput,
  MembershipWhatIfResult,
} from './analytics';

export function computeFullCostBreakdown(input: {
  paidMinor: number;
  salesCommissionPct: number;
  acquiringPct: number;
  taxPct: number;
  trainerMinor: number;
  ptUsed: number;
  ptCostMinor: number;
  massageUsed: number;
  massageCostMinor: number;
  bodyCompositionUsed: number;
  bodyCompositionCostMinor: number;
  solariumMinutesUsed: number;
  solariumMinuteCostMinor: number;
  personalAccountSpentMinor: number;
  personalAccountCogsShare: number;
  visitCount: number;
  overheadPerVisitMinor: number;
  months: number;
  fixedOverheadPerMemberMonthMinor: number;
  includeFixedOverhead: boolean;
}): MembershipCostBreakdown {
  const salesCommissionMinor = Math.round(
    (input.paidMinor * Math.max(0, input.salesCommissionPct)) / 100,
  );
  const acquiringMinor = Math.round(
    (input.paidMinor * Math.max(0, input.acquiringPct)) / 100,
  );
  const taxMinor = Math.round(
    (input.paidMinor * Math.max(0, input.taxPct)) / 100,
  );
  const ptMinor = input.ptUsed * input.ptCostMinor;
  const massageMinor = input.massageUsed * input.massageCostMinor;
  const bodyCompositionMinor =
    input.bodyCompositionUsed * input.bodyCompositionCostMinor;
  const solariumMinor =
    input.solariumMinutesUsed * input.solariumMinuteCostMinor;
  const personalAccountCogsMinor = Math.round(
    input.personalAccountSpentMinor * input.personalAccountCogsShare,
  );
  const overheadMinor = input.visitCount * input.overheadPerVisitMinor;
  const fixedOverheadMinor = input.includeFixedOverhead
    ? Math.round(input.months * input.fixedOverheadPerMemberMonthMinor)
    : 0;
  const variableTotalMinor =
    salesCommissionMinor +
    acquiringMinor +
    taxMinor +
    input.trainerMinor +
    ptMinor +
    massageMinor +
    bodyCompositionMinor +
    solariumMinor +
    personalAccountCogsMinor +
    overheadMinor;
  return {
    salesCommissionMinor,
    acquiringMinor,
    taxMinor,
    trainerMinor: input.trainerMinor,
    ptMinor,
    massageMinor,
    bodyCompositionMinor,
    solariumMinor,
    personalAccountCogsMinor,
    overheadMinor,
    fixedOverheadMinor,
    variableTotalMinor,
    totalMinor: variableTotalMinor + fixedOverheadMinor,
  };
}

export function breakevenPriceMinor(input: {
  salesCommissionPct: number;
  acquiringPct: number;
  taxPct: number;
  fixedVariableCostMinor: number;
}): number | null {
  const pct =
    Math.max(0, input.salesCommissionPct) +
    Math.max(0, input.acquiringPct) +
    Math.max(0, input.taxPct);
  if (pct >= 100) return null;
  const denom = 1 - pct / 100;
  if (denom <= 0) return null;
  return Math.max(0, Math.ceil(input.fixedVariableCostMinor / denom));
}

export function maxDiscountPctFromRetail(
  retailMinor: number | null,
  breakEvenMinor: number | null,
): number | null {
  if (retailMinor == null || retailMinor <= 0 || breakEvenMinor == null) {
    return null;
  }
  return (
    Math.round(((retailMinor - breakEvenMinor) / retailMinor) * 1000) / 10
  );
}

export function maxGpVisitsForTerm(input: {
  paidMinor: number;
  nonTrainerVariableMinor: number;
  avgTrainerPerVisitMinor: number | null;
}): number | null {
  if (
    input.avgTrainerPerVisitMinor == null ||
    input.avgTrainerPerVisitMinor <= 0
  ) {
    return null;
  }
  const room = input.paidMinor - input.nonTrainerVariableMinor;
  if (room <= 0) return 0;
  return Math.max(0, Math.floor(room / input.avgTrainerPerVisitMinor));
}

export function maxGpVisitsPerMonth(
  maxForTerm: number | null,
  months: number,
): number | null {
  if (maxForTerm == null) return null;
  const m = Math.max(0.1, months);
  return Math.round((maxForTerm / m) * 10) / 10;
}

export function computeMembershipWhatIf(
  input: MembershipWhatIfInput,
): MembershipWhatIfResult {
  const visitCount = input.gpVisits + input.gymVisits;
  const trainerMinor = Math.round(
    input.gpVisits * Math.max(0, input.avgTrainerPerVisitMinor),
  );
  const cost = computeFullCostBreakdown({
    paidMinor: input.paidMinor,
    salesCommissionPct: input.salesCommissionPct,
    acquiringPct: input.acquiringPct,
    taxPct: input.taxPct,
    trainerMinor,
    ptUsed: input.ptUsed,
    ptCostMinor: input.ptCostMinor,
    massageUsed: input.massageUsed,
    massageCostMinor: input.massageCostMinor,
    bodyCompositionUsed: input.bodyCompositionUsed,
    bodyCompositionCostMinor: input.bodyCompositionCostMinor,
    solariumMinutesUsed: input.solariumMinutesUsed,
    solariumMinuteCostMinor: input.solariumMinuteCostMinor,
    personalAccountSpentMinor: input.personalAccountSpentMinor,
    personalAccountCogsShare: input.personalAccountCogsShare,
    visitCount,
    overheadPerVisitMinor: input.overheadPerVisitMinor,
    months: input.months,
    fixedOverheadPerMemberMonthMinor: input.fixedOverheadPerMemberMonthMinor,
    includeFixedOverhead: input.includeFixedOverhead,
  });
  const marginMinor = input.paidMinor - cost.totalMinor;
  const marginPct =
    input.paidMinor > 0
      ? Math.round((marginMinor / input.paidMinor) * 1000) / 10
      : null;
  const fixedVariable =
    trainerMinor +
    input.ptUsed * input.ptCostMinor +
    input.massageUsed * input.massageCostMinor +
    input.bodyCompositionUsed * input.bodyCompositionCostMinor +
    input.solariumMinutesUsed * input.solariumMinuteCostMinor +
    Math.round(
      input.personalAccountSpentMinor * input.personalAccountCogsShare,
    ) +
    visitCount * input.overheadPerVisitMinor +
    (input.includeFixedOverhead
      ? Math.round(input.months * input.fixedOverheadPerMemberMonthMinor)
      : 0);
  const be = breakevenPriceMinor({
    salesCommissionPct: input.salesCommissionPct,
    acquiringPct: input.acquiringPct,
    taxPct: input.taxPct,
    fixedVariableCostMinor: fixedVariable,
  });
  const nonTrainerVar =
    cost.salesCommissionMinor +
    cost.acquiringMinor +
    cost.taxMinor +
    cost.ptMinor +
    cost.massageMinor +
    cost.bodyCompositionMinor +
    cost.solariumMinor +
    cost.personalAccountCogsMinor +
    cost.overheadMinor +
    (input.includeFixedOverhead ? cost.fixedOverheadMinor : 0);
  const maxTerm = maxGpVisitsForTerm({
    paidMinor: input.paidMinor,
    nonTrainerVariableMinor: nonTrainerVar,
    avgTrainerPerVisitMinor: input.avgTrainerPerVisitMinor || null,
  });
  return {
    cost,
    marginMinor,
    marginPct,
    breakevenPriceMinor: be,
    maxDiscountPctFromRetail: maxDiscountPctFromRetail(
      input.retailPriceMinor,
      be,
    ),
    maxGpVisitsPerMonth: maxGpVisitsPerMonth(maxTerm, input.months),
  };
}
