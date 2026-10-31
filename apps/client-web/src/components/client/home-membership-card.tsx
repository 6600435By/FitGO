'use client';

import { MembershipStatus, type Membership } from '@fitgo/shared-types';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ProgressRing } from '@/components/forma/progress-ring';
import { MembershipFreezePanel } from '@/components/client/membership-freeze-panel';
import {
  formatDate,
  membershipProgress,
  membershipStatusLabel,
} from '@/lib/utils';
import { cn } from '@/lib/utils';

export function HomeMembershipCard({
  membership,
  membershipSource,
  serviceActions,
  onFrozen,
}: {
  membership: Membership;
  membershipSource?: '1c' | 'osmi' | 'derived' | null;
  serviceActions?: ReactNode;
  onFrozen: (next: Membership) => void;
}) {
  const [open, setOpen] = useState(false);
  const progress = membershipProgress(
    membership.validFrom,
    membership.validUntil,
  );
  const hasDebt = (membership.debtAmount ?? 0) > 0;
  const ringMax =
    membership.visitsTotal && membership.visitsRemaining !== undefined
      ? membership.visitsTotal
      : Math.max(progress.daysLeft + 1, 30);
  const ringValue =
    membership.visitsRemaining !== undefined
      ? membership.visitsRemaining
      : progress.daysLeft;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[1.75rem] border border-forma-500/30 bg-gradient-to-br from-forma-500 via-forma-400 to-amber-500 text-ink shadow-forma-glow',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-4 p-5 text-left touch-manipulation"
        aria-expanded={open}
      >
        <ProgressRing
          value={ringValue}
          max={ringMax}
          size={76}
          stroke={7}
          accent="ink"
          className="shrink-0"
        >
          <div className="text-center">
            <p className="font-display text-lg font-bold leading-none tabular-nums">
              {membership.visitsRemaining !== undefined
                ? membership.visitsRemaining
                : progress.daysLeft}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/60">
              {membership.visitsRemaining !== undefined ? 'виз.' : 'дн.'}
            </p>
          </div>
        </ProgressRing>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink/55">
                Абонемент
              </p>
              <p className="truncate font-display text-xl font-bold leading-tight">
                {membership.name}
              </p>
            </div>
            <ChevronDown
              className={cn(
                'mt-1 h-5 w-5 shrink-0 text-ink/50 transition-transform',
                open && 'rotate-180',
              )}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-semibold">
              {membershipStatusLabel(membership.status)}
            </span>
            {membership.status === MembershipStatus.ACTIVE && (
              <span className="text-xs font-medium text-ink/65">
                до {formatDate(membership.validUntil)}
              </span>
            )}
          </div>
          {hasDebt ? (
            <p className="mt-2 text-xs font-semibold text-rose-900">
              Задолженность {membership.debtAmount!.toFixed(2)}
              {membership.currency ? ` ${membership.currency}` : ''}
            </p>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-ink/10 bg-ink/[0.06] px-5 py-4">
          {membershipSource === 'derived' && (
            <p className="text-xs text-ink/60">
              Срок уточняется из 1С — оценка по последнему визиту
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-ink/10 px-3 py-2.5">
              <p className="text-[11px] font-medium text-ink/55">Действует до</p>
              <p className="font-display text-base font-bold">
                {formatDate(membership.validUntil)}
              </p>
            </div>
            <div className="rounded-2xl bg-ink/10 px-3 py-2.5">
              <p className="text-[11px] font-medium text-ink/55">
                {membership.visitsRemaining !== undefined
                  ? 'Осталось визитов'
                  : 'Тип'}
              </p>
              <p className="font-display text-base font-bold">
                {membership.visitsRemaining !== undefined
                  ? `${membership.visitsRemaining}${
                      membership.visitsTotal ? ` / ${membership.visitsTotal}` : ''
                    }`
                  : 'Безлимит'}
              </p>
            </div>
          </div>

          {(typeof membership.accountBalance === 'number' ||
            typeof membership.debtAmount === 'number') && (
            <div className="grid grid-cols-2 gap-2">
              {typeof membership.accountBalance === 'number' && (
                <div className="rounded-2xl bg-ink/10 px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink/55">Лицевой счёт</p>
                  <p className="font-display text-base font-bold">
                    {membership.accountBalance.toFixed(2)}
                    {membership.currency ? ` ${membership.currency}` : ''}
                  </p>
                </div>
              )}
              {typeof membership.debtAmount === 'number' && (
                <div
                  className={cn(
                    'rounded-2xl px-3 py-2.5',
                    hasDebt ? 'bg-rose-900/20' : 'bg-ink/10',
                  )}
                >
                  <p className="text-[11px] font-medium text-ink/55">Долг</p>
                  <p className="font-display text-base font-bold">
                    {membership.debtAmount.toFixed(2)}
                    {membership.currency ? ` ${membership.currency}` : ''}
                  </p>
                </div>
              )}
            </div>
          )}

          <MembershipFreezePanel
            membership={membership}
            onFrozen={onFrozen}
            onAccent
          />

          {serviceActions}
        </div>
      ) : null}
    </div>
  );
}
