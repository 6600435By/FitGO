'use client';

import type { ClubCardView, ClubCrmLinkStatus, Membership } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarcodeCard } from '@/components/barcode-card';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  membershipProgress,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

function formatMoney(amount: number, currency?: string) {
  const cur = currency ?? 'BYN';
  try {
    return new Intl.NumberFormat('ru-BY', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${cur}`;
  }
}

function MembershipDetails({ membership }: { membership: Membership }) {
  const progress = membershipProgress(membership.validFrom, membership.validUntil);
  const hasDebt = (membership.debtAmount ?? 0) > 0;
  const hasAccountBalance = typeof membership.accountBalance === 'number';
  const hasDebtAmount = typeof membership.debtAmount === 'number';

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">Абонемент</p>
          <p className="text-xl font-semibold">{membership.name}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${membershipStatusColor(membership.status)}`}
        >
          {membershipStatusLabel(membership.status)}
        </span>
      </div>

      {progress && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>Осталось {progress.daysLeft} дн.</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-fitgo-500"
              style={{ width: `${100 - progress.percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-800/50 p-3">
          <p className="stat-label">Действует до</p>
          <p className="stat-value text-lg">{formatDate(membership.validUntil)}</p>
        </div>
        {membership.visitsRemaining !== undefined ? (
          <div className="rounded-xl bg-slate-800/50 p-3">
            <p className="stat-label">Осталось визитов</p>
            <p className="stat-value text-lg">
              {membership.visitsRemaining}
              {membership.visitsTotal ? ` / ${membership.visitsTotal}` : ''}
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-800/50 p-3">
            <p className="stat-label">Тип</p>
            <p className="stat-value text-lg">Безлимит</p>
          </div>
        )}
      </div>

      {(hasAccountBalance || hasDebtAmount) && (
        <div className="grid grid-cols-2 gap-3">
          {hasAccountBalance && (
            <div className="rounded-xl bg-slate-800/50 p-3">
              <p className="stat-label">Лицевой счёт</p>
              <p className="stat-value text-lg">
                {formatMoney(membership.accountBalance!, membership.currency)}
              </p>
            </div>
          )}
          {hasDebtAmount && (
            <div
              className={`rounded-xl p-3 ${
                hasDebt ? 'bg-red-500/10' : 'bg-slate-800/50'
              }`}
            >
              <p className="stat-label">Задолженность</p>
              <p
                className={`stat-value text-lg ${hasDebt ? 'text-red-300' : ''}`}
              >
                {formatMoney(membership.debtAmount!, membership.currency)}
              </p>
            </div>
          )}
        </div>
      )}

      {membership.services && membership.services.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-slate-400">Включённые услуги</p>
          <ul className="space-y-1.5">
            {membership.services.map((service) => (
              <li
                key={service.name}
                className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2 text-sm"
              >
                <span>{service.name}</span>
                <span className="text-slate-400">
                  {service.unlimited
                    ? '∞'
                    : service.remaining !== undefined
                      ? service.total
                        ? `${service.remaining} / ${service.total}`
                        : String(service.remaining)
                      : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ClientCardPage() {
  return (
    <ModuleGate module="club_card">
      <ClientCardPageInner />
    </ModuleGate>
  );
}

function ClientCardPageInner() {
  const [card, setCard] = useState<ClubCardView | null>(null);
  const [membershipOnly, setMembershipOnly] = useState<Membership | null>(null);
  const [crmStatus, setCrmStatus] = useState<ClubCrmLinkStatus | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [anketaUrl, setAnketaUrl] = useState<string | undefined>();
  const [syncError, setSyncError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    setError('');
    api
      .clientClubCard(token)
      .then((result) => {
        setNeedsPhone(result.needsPhone);
        setAnketaUrl(result.anketaUrl);
        setSyncError(result.syncError ?? '');
        setCrmStatus(result.crmStatus ?? null);
        setMembershipOnly(result.membership ?? null);
        if (result.card) {
          setCard(result.card);
          return;
        }
        return api.clientDashboard(token).then((dashboard) => {
          setCrmStatus(dashboard.crmStatus ?? result.crmStatus ?? null);
          if (dashboard.accessCard) {
            setCard({
              id: dashboard.accessCard.id,
              barcode: dashboard.accessCard.barcode,
              barcodeFormat: 'CODE128',
              clientName: dashboard.accessCard.clientName,
              clubName: dashboard.accessCard.clubName,
              membership: dashboard.membership,
              syncedAt: new Date().toISOString(),
              source: dashboard.cardSource ?? '1c',
            });
          } else {
            setCard(null);
            setMembershipOnly(dashboard.membership ?? result.membership ?? null);
          }
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSync = async () => {
    const token = getToken();
    if (!token) return;
    setSyncing(true);
    setSyncError('');
    try {
      const result = await api.clientSyncClubCard(token);
      setCard(result.card);
      setCrmStatus(result.crmStatus ?? null);
      setMembershipOnly(result.membership ?? null);
      setSyncError(result.syncError ?? '');
      if (!result.card && result.needsPhone) {
        setNeedsPhone(true);
      }
      if (!result.card) {
        const dashboard = await api.clientDashboard(token);
        setCrmStatus(dashboard.crmStatus ?? result.crmStatus ?? null);
        if (dashboard.accessCard) {
          setCard({
            id: dashboard.accessCard.id,
            barcode: dashboard.accessCard.barcode,
            barcodeFormat: 'CODE128',
            clientName: dashboard.accessCard.clientName,
            clubName: dashboard.accessCard.clubName,
            membership: dashboard.membership,
            syncedAt: new Date().toISOString(),
            source: dashboard.cardSource ?? '1c',
          });
        } else {
          setMembershipOnly(dashboard.membership ?? result.membership ?? null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={load} className="btn-secondary">
          Повторить
        </button>
      </div>
    );
  }

  if (needsPhone && !card) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-slate-400">
          Укажите телефон в профиле — по нему найдём клиента в 1С и клубную карту.
        </p>
        <Link href="/client/profile/complete" className="btn-primary inline-block">
          Заполнить профиль
        </Link>
      </div>
    );
  }

  if (crmStatus === 'PENDING_CRM' && !card) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Карта клуба</h2>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="text-sm text-fitgo-400"
          >
            {syncing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
        <div className="card space-y-3 text-center">
          <p className="text-lg font-semibold">Ожидает оформления в 1С</p>
          <p className="text-slate-400">
            Штрихкод и запись на групповые появятся после заведения клиента на
            ресепшен. Расписание можно смотреть уже сейчас; вход в зал — по
            решению администратора.
          </p>
          <Link href="/client/schedule" className="btn-primary inline-block">
            Смотреть расписание
          </Link>
        </div>
      </div>
    );
  }

  const membership = card?.membership ?? membershipOnly;

  if (!card && !membership) {
    return (
      <div className="card space-y-3 text-center text-slate-400">
        <p>Карта доступа недоступна</p>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="btn-primary w-full"
        >
          {syncing ? 'Синхронизация…' : 'Обновить'}
        </button>
        {anketaUrl && (
          <a
            href={anketaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary block"
          >
            Получить карту на сайте OSMI
          </a>
        )}
      </div>
    );
  }

  if (fullscreen && card) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-4">
        <button
          type="button"
          onClick={() => setFullscreen(false)}
          className="btn-secondary mb-4 self-end"
        >
          Закрыть
        </button>
        <BarcodeCard
          barcode={card.barcode}
          barcodeFormat={card.barcodeFormat}
          clientName={card.clientName}
          clubName={card.clubName}
          membership={membership ?? undefined}
          fullscreen
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Карта клуба</h2>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="text-sm text-fitgo-400"
        >
          {syncing ? 'Обновление…' : 'Обновить'}
        </button>
      </div>

      {syncError && (
        <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
          {syncError}. Показана последняя сохранённая карта.
        </p>
      )}

      {membership && <MembershipDetails membership={membership} />}

      {card && (
        <>
          <BarcodeCard
            barcode={card.barcode}
            barcodeFormat={card.barcodeFormat}
            clientName={card.clientName}
            clubName={card.clubName}
            membership={membership ?? undefined}
          />

          {card.walletUrl && (
            <a
              href={card.walletUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary block text-center"
            >
              Добавить в Apple / Google Wallet
            </a>
          )}

          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="btn-primary w-full"
          >
            Открыть на весь экран
          </button>

          {(card.anketaUrl ?? anketaUrl) && (
            <a
              href={card.anketaUrl ?? anketaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary block text-center text-sm"
            >
              Открыть карту на сайте OSMI
            </a>
          )}
        </>
      )}

      {!card && membership && (
        <p className="text-center text-sm text-slate-400">
          Штрихкод ещё не присвоен в 1С. Обратитесь на ресепшен.
        </p>
      )}
    </div>
  );
}
