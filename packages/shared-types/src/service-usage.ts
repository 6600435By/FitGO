export type ServiceControlLevel = 'BASE' | 'ELEVATED';

export type ServicePresenceStatus =
  | 'PENDING'
  | 'VERIFIED_1C'
  | 'ADMIN_OVERRIDE';

export type ServicePerformanceStatus =
  | 'PENDING'
  | 'CONFIRMED_BY_PERFORMER'
  | 'REJECTED';

export type ServiceUsageStatus =
  | 'BOOKED'
  | 'NO_SHOW'
  | 'ATTENDED'
  | 'CONSUMED'
  | 'CANCELLED';

export type ServicePaymentStatus =
  | 'N_A'
  | 'PENDING_PAYMENT'
  | 'DEBT'
  | 'PAID';

export interface ServiceUsageControl {
  controlLevel: ServiceControlLevel;
  presenceStatus: ServicePresenceStatus;
  performanceStatus: ServicePerformanceStatus;
  usageStatus: ServiceUsageStatus;
  paymentStatus: ServicePaymentStatus;
  reviewFlag: boolean;
  eligibleForMotivation: boolean;
  isComplimentary?: boolean;
}

export function isElevatedOrigin(origin: string): boolean {
  return origin !== 'CLIENT_BOOKED';
}

export function controlLevelFromOrigin(origin: string): ServiceControlLevel {
  return isElevatedOrigin(origin) ? 'ELEVATED' : 'BASE';
}

export function initialControlFields(input: {
  origin: string;
  paymentType?: 'QUOTA' | 'PAID';
  isComplimentary?: boolean;
}): {
  controlLevel: ServiceControlLevel;
  reviewFlag: boolean;
  paymentStatus: ServicePaymentStatus;
  usageStatus: ServiceUsageStatus;
  presenceStatus: ServicePresenceStatus;
  performanceStatus: ServicePerformanceStatus;
  eligibleForMotivation: boolean;
  isComplimentary: boolean;
} {
  const elevated = isElevatedOrigin(input.origin);
  return {
    controlLevel: elevated ? 'ELEVATED' : 'BASE',
    reviewFlag: elevated,
    paymentStatus: input.paymentType === 'PAID' ? 'PENDING_PAYMENT' : 'N_A',
    usageStatus: 'BOOKED',
    presenceStatus: 'PENDING',
    performanceStatus: 'PENDING',
    eligibleForMotivation: false,
    isComplimentary: Boolean(input.isComplimentary),
  };
}

export function toUsageControl(row: {
  controlLevel: string;
  presenceStatus: string;
  performanceStatus: string;
  usageStatus: string;
  paymentStatus: string;
  reviewFlag: boolean;
  eligibleForMotivation: boolean;
  isComplimentary?: boolean;
}): ServiceUsageControl {
  return {
    controlLevel: row.controlLevel as ServiceControlLevel,
    presenceStatus: row.presenceStatus as ServicePresenceStatus,
    performanceStatus: row.performanceStatus as ServicePerformanceStatus,
    usageStatus: row.usageStatus as ServiceUsageStatus,
    paymentStatus: row.paymentStatus as ServicePaymentStatus,
    reviewFlag: row.reviewFlag,
    eligibleForMotivation: row.eligibleForMotivation,
    isComplimentary: row.isComplimentary,
  };
}

/** Dual-gate: presence + performer → ATTENDED; motivation eligibility. */
export function computeUsageAfterGates(input: {
  presenceStatus: string;
  performanceStatus: string;
  usageStatus: string;
  isComplimentary?: boolean;
  consumedInCrm?: boolean;
}): {
  usageStatus: ServiceUsageStatus;
  eligibleForMotivation: boolean;
} {
  if (input.usageStatus === 'CANCELLED' || input.usageStatus === 'NO_SHOW') {
    return {
      usageStatus: input.usageStatus as ServiceUsageStatus,
      eligibleForMotivation: false,
    };
  }

  const presenceOk =
    input.presenceStatus === 'VERIFIED_1C' ||
    input.presenceStatus === 'ADMIN_OVERRIDE';
  const performanceOk =
    input.performanceStatus === 'CONFIRMED_BY_PERFORMER';

  if (presenceOk && performanceOk) {
    const usageStatus: ServiceUsageStatus = input.consumedInCrm
      ? 'CONSUMED'
      : 'ATTENDED';
    return {
      usageStatus,
      eligibleForMotivation: !input.isComplimentary,
    };
  }

  return {
    usageStatus: 'BOOKED',
    eligibleForMotivation: false,
  };
}

export function originBadgeLabel(origin?: string | null): string | null {
  switch (origin) {
    case 'TRAINER_ASSIGNED':
      return 'Записал тренер';
    case 'SPECIALIST_ASSIGNED':
      return 'Записал специалист';
    case 'ADMIN_ASSIGNED':
    case 'ADMIN_BOOKED':
      return 'Записал администратор';
    case 'STAFF_BOOKED':
      return 'Записал сотрудник';
    case 'CLIENT_BOOKED':
      return 'Вы записались';
    default:
      return null;
  }
}
