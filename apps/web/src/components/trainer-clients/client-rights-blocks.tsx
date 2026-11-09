'use client';

import type { TrainerClientDetail } from '@fitgo/shared-types';
import { MembershipStatus } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { formatDate, membershipStatusLabel } from '@/lib/utils';

function moneyMinor(minor: number) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} BYN`;
}

/**
 * Club membership vs personal PT package — trainer-facing, without club
 * back-office noise (1C service remainder, club face-account debt, sync time).
 */
export function ClientRightsBlocks({
  client,
  priceEditor,
  compact = false,
}: {
  client: TrainerClientDetail;
  /** Optional price controls under the personal PT block (detail page). */
  priceEditor?: ReactNode;
  compact?: boolean;
}) {
  const crmLinked = client.crmStatus === 'LINKED';
  const crmPending = client.crmStatus === 'PENDING_CRM';
  const membershipProblem =
    client.membershipStatus === MembershipStatus.EXPIRED ||
    client.membershipStatus === MembershipStatus.FROZEN ||
    client.membershipStatus === MembershipStatus.PENDING;
  const attentionMembership = membershipProblem || crmPending;

  const ledger = client.ownLedger;
  const hasPackage = Boolean(ledger?.activePackage);
  const priceKnown =
    ledger?.effectiveSessionPriceMinor != null &&
    ledger.effectiveSessionPriceMinor > 0;
  const priceAttention = Boolean(ledger) && !hasPackage && !priceKnown;
  const trainerDebtMinor = ledger?.debtMinor ?? 0;

  return (
    <div className={compact ? 'space-y-3' : 'space-y-3'}>
      <div className="rounded-xl border border-white/10 bg-ink-raised/40 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-forma-100">Абонемент клуба</p>
          {client.membershipStatus ? (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-forma-300">
              {membershipStatusLabel(client.membershipStatus)}
            </span>
          ) : null}
          {crmLinked ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">
              Подтверждён
            </span>
          ) : null}
          {attentionMembership ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
              Внимание
            </span>
          ) : null}
        </div>
        {client.membershipName ? (
          <p className="mt-1 text-forma-200">{client.membershipName}</p>
        ) : (
          <p className="mt-1 text-forma-400">Нет данных абонемента</p>
        )}
        {client.membershipValidUntil ? (
          <p className="mt-1 text-xs text-forma-400">
            Срок до {formatDate(client.membershipValidUntil)}
          </p>
        ) : null}
        {crmPending ? (
          <p className="mt-1.5 text-[11px] text-amber-200/80">
            Нет карточки 1С — заведите клиента в CRM.
          </p>
        ) : null}
        {client.membershipStatus === MembershipStatus.EXPIRED ? (
          <p className="mt-1.5 text-[11px] text-amber-200/80">
            Срок абонемента истёк.
          </p>
        ) : null}
        {client.membershipStatus === MembershipStatus.FROZEN ? (
          <p className="mt-1.5 text-[11px] text-amber-200/80">
            Абонемент заморожен.
          </p>
        ) : null}
      </div>

      {ledger ? (
        <div className="rounded-xl border border-forma-500/20 bg-forma-500/5 px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-forma-100">
              Пакет персональных тренировок
            </p>
            {hasPackage ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">
                Активен
              </span>
            ) : null}
            {priceAttention ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
                Внимание
              </span>
            ) : null}
          </div>
          {ledger.activePackage ? (
            <p className="mt-1 text-forma-200">
              {ledger.activePackage.title}: осталось{' '}
              {ledger.activePackage.sessionsRemaining} из{' '}
              {ledger.activePackage.sessionsTotal}
              {ledger.activePackage.validUntil
                ? ` · до ${formatDate(ledger.activePackage.validUntil)}`
                : ''}
            </p>
          ) : (
            <p className="mt-1 text-forma-400">Нет активного пакета</p>
          )}
          <ul className="mt-1 space-y-0.5 text-xs text-forma-400">
            {trainerDebtMinor > 0 ? (
              <li>Долг за тренировки: {moneyMinor(trainerDebtMinor)}</li>
            ) : null}
            <li>
              Цена разовой:{' '}
              {priceKnown
                ? `${moneyMinor(ledger.effectiveSessionPriceMinor!)}${
                    ledger.sessionPriceMinor != null
                      ? ' · индивидуальная'
                      : ' · из настроек «Расчёты»'
                  }`
                : 'не задана'}
            </li>
          </ul>
          {priceAttention ? (
            <p className="mt-1.5 text-[11px] text-amber-200/80">
              Нет пакета и цены — долг с суммой не создастся.
            </p>
          ) : null}
          {priceEditor}
        </div>
      ) : null}
    </div>
  );
}
