'use client';

import type { PersonalTrainingSessionDetail } from '@fitgo/shared-types';
import Link from 'next/link';
import { formatDate, formatDateTime } from '@/lib/utils';

export type PreviousSessionMeta = {
  bookingId?: string;
  date?: string;
  summary?: string;
  loaded: boolean;
};

function sessionTypeLabel(session: PersonalTrainingSessionDetail): string {
  if (session.ptFlow === 'PERSONAL') return 'Персональная · личный расчёт';
  if (session.ptFlow === 'CLUB' || session.ptControlApplies) {
    return 'Персональная · клуб';
  }
  return 'Персональная тренировка';
}

function financialBasisLabel(session: PersonalTrainingSessionDetail): string {
  if (session.ptFlow === 'PERSONAL') {
    return session.ledgerSettledAt
      ? 'Личный расчёт тренера · списание зафиксировано'
      : 'Личный расчёт тренера';
  }
  if (session.ptFlow === 'CLUB' || session.ptControlApplies) {
    if (session.linkedDocExternalId) {
      return 'Клуб · документ продажи привязан';
    }
    if (session.approvalPhase === 'APPROVED') {
      return 'Клуб · подтверждено администратором';
    }
    return 'Клуб · ждём администратора / документ';
  }
  return 'Основание не указано';
}

function formatTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const sameDay =
    start.toDateString() === end.toDateString();
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };
  if (sameDay) {
    return `${formatDateTime(startAt)} – ${end.toLocaleTimeString('ru-RU', timeOpts)}`;
  }
  return `${formatDateTime(startAt)} – ${formatDateTime(endAt)}`;
}

export function SessionContextStrip({
  session,
  profileAge,
  previous,
  primaryGoal,
  onOpenGoals,
}: {
  session: PersonalTrainingSessionDetail;
  profileAge?: number;
  previous: PreviousSessionMeta;
  primaryGoal?: string;
  onOpenGoals: () => void;
}) {
  const previousHref =
    previous.bookingId
      ? `/trainer/sessions/${previous.bookingId}?clientId=${session.clientId}`
      : null;
  const previousLabel = !previous.loaded
    ? '…'
    : previous.date
      ? [
          formatDate(previous.date),
          previous.summary?.trim() || null,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'прошлого листа нет';
  const planLabel = primaryGoal?.trim() || 'план ещё не задан';

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-300">
        <span>{sessionTypeLabel(session)}</span>
        <span className="text-slate-600">·</span>
        <span>{formatTimeRange(session.startAt, session.endAt)}</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-300">
        <Link
          href={`/trainer/clients/${session.clientId}`}
          className="text-fitgo-400 hover:text-fitgo-300"
        >
          {session.clientName}
        </Link>
        {profileAge != null ? (
          <span className="text-slate-500">{profileAge} лет · из профиля</span>
        ) : null}
      </div>

      <p className="text-sm text-slate-400">{financialBasisLabel(session)}</p>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <button
          type="button"
          onClick={onOpenGoals}
          className="text-fitgo-400 hover:text-fitgo-300"
        >
          Цели
        </button>
        <Link
          href={`/trainer/clients/${session.clientId}?tab=anketa`}
          className="text-fitgo-400 hover:text-fitgo-300"
        >
          Ограничения
        </Link>
        {previousHref ? (
          <Link
            href={previousHref}
            className="text-fitgo-400 hover:text-fitgo-300"
          >
            Последняя тренировка
          </Link>
        ) : (
          <span className="text-slate-500">Последняя тренировка</span>
        )}
      </div>

      <p className="text-[11px] leading-snug text-slate-500">
        <Link
          href={`/trainer/clients/${session.clientId}`}
          className="text-slate-400 hover:text-fitgo-400"
        >
          Клиент
        </Link>
        {' → '}
        {previousHref ? (
          <Link href={previousHref} className="text-slate-400 hover:text-fitgo-400">
            {previousLabel}
          </Link>
        ) : (
          <span>{previousLabel}</span>
        )}
        {' → '}
        <span className="text-slate-300">{planLabel}</span>
      </p>
    </div>
  );
}
