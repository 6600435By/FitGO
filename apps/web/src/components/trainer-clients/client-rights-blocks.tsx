'use client';

import type { TrainerClientDetail } from '@fitgo/shared-types';
import { MembershipStatus } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import {
  formatDate,
  formatDateTime,
  membershipStatusLabel,
} from '@/lib/utils';

function moneyMajor(amount: number) {
  return `${amount.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} BYN`;
}

function moneyMinor(minor: number) {
  return moneyMajor(minor / 100);
}

function statusHint(status?: MembershipStatus) {
  if (!status) return null;
  if (status === MembershipStatus.ACTIVE) {
    return 'Активен — членство действует по снимку 1С.';
  }
  if (status === MembershipStatus.EXPIRED) {
    return 'Внимание — срок абонемента истёк.';
  }
  if (status === MembershipStatus.FROZEN) {
    return 'Внимание — абонемент заморожен.';
  }
  if (status === MembershipStatus.PENDING) {
    return 'Внимание — абонемент ещё не активирован.';
  }
  return null;
}

/**
 * Separate club membership vs personal PT package — never merge remainders/dates.
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
  const clubDebtKnown = client.clubDebtAmount != null;
  const clubDebtPositive =
    clubDebtKnown && (client.clubDebtAmount as number) > 0;
  const attentionMembership =
    client.membershipStatus === MembershipStatus.EXPIRED ||
    client.membershipStatus === MembershipStatus.FROZEN ||
    client.membershipStatus === MembershipStatus.PENDING ||
    clubDebtPositive ||
    crmPending;

  const ledger = client.ownLedger;
  const hasPackage = Boolean(ledger?.activePackage);
  const priceKnown =
    ledger?.effectiveSessionPriceMinor != null &&
    ledger.effectiveSessionPriceMinor > 0;
  const priceAttention = Boolean(ledger) && !hasPackage && !priceKnown;

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
            <span
              className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200"
              title="Клиент связан с карточкой 1С"
            >
              Подтверждён
            </span>
          ) : null}
          {attentionMembership ? (
            <span
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200"
              title="Нужна проверка CRM, статуса или долга клубу"
            >
              Внимание
            </span>
          ) : null}
        </div>
        {client.membershipName ? (
          <p className="mt-1 text-forma-200">{client.membershipName}</p>
        ) : (
          <p className="mt-1 text-forma-400">Нет данных абонемента</p>
        )}
        <ul className="mt-1 space-y-0.5 text-xs text-forma-400">
          {client.membershipValidUntil ? (
            <li>Срок до {formatDate(client.membershipValidUntil)}</li>
          ) : null}
          {client.sessionsRemaining != null ? (
            <li>Остаток услуг 1С: {client.sessionsRemaining}</li>
          ) : (
            <li>Остаток услуг 1С: нет данных</li>
          )}
          {clubDebtKnown ? (
            <li>
              Долг перед клубом:{' '}
              {(client.clubDebtAmount as number) > 0
                ? moneyMajor(client.clubDebtAmount as number)
                : 'нет'}
            </li>
          ) : (
            <li>Долг перед клубом: нет данных</li>
          )}
          <li>
            Синхронизация 1С:{' '}
            {client.membershipSyncedAt
              ? formatDateTime(client.membershipSyncedAt)
              : 'нет снимка'}
          </li>
        </ul>
        {statusHint(client.membershipStatus) ? (
          <p className="mt-1.5 text-[11px] text-forma-500">
            {statusHint(client.membershipStatus)}
          </p>
        ) : null}
        {crmLinked ? (
          <p className="text-[11px] text-forma-500">
            Подтверждён — клиент связан с карточкой 1С.
          </p>
        ) : null}
        {crmPending ? (
          <p className="text-[11px] text-amber-200/80">
            Внимание — нет карточки 1С, заведите клиента в CRM.
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-forma-500">
          Не смешивается с личным пакетом ПТ: сроки и остатки считаются отдельно.
        </p>
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
            <li>
              Долг клиенту тренеру:{' '}
              {ledger.debtMinor > 0 ? moneyMinor(ledger.debtMinor) : 'нет'}
            </li>
            <li>
              Цена разовой:{' '}
              {priceKnown
                ? `${moneyMinor(ledger.effectiveSessionPriceMinor!)}${
                    ledger.sessionPriceMinor != null
                      ? ' · индивидуальная'
                      : ' · из настроек «Расчёты»'
                  }`
                : 'не задана — сумму не выдумываем'}
            </li>
            <li>
              Локально обновлено:{' '}
              {ledger.localUpdatedAt
                ? formatDateTime(ledger.localUpdatedAt)
                : 'записей ещё не было'}
            </li>
          </ul>
          {hasPackage ? (
            <p className="mt-1.5 text-[11px] text-forma-500">
              Активен — после PERSONAL-занятия спишется 1 тренировка с этого
              пакета.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-forma-500">
              Без пакета после PERSONAL-занятия появится долг тренеру только если
              известна цена.
            </p>
          )}
          {priceAttention ? (
            <p className="text-[11px] text-amber-200/80">
              Внимание — нет пакета и нет цены: долг с суммой не создастся.
            </p>
          ) : null}
          {priceEditor}
        </div>
      ) : null}
    </div>
  );
}
