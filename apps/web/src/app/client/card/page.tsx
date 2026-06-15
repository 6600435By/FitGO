'use client';

import type { ClubCardView } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarcodeCard } from '@/components/barcode-card';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  membershipProgress,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

export default function ClientCardPage() {
  const [card, setCard] = useState<ClubCardView | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [anketaUrl, setAnketaUrl] = useState<string | undefined>();
  const [syncError, setSyncError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [osmiEnabled, setOsmiEnabled] = useState(true);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    setError('');
    api
      .clientClubCard(token)
      .then((result) => {
        setOsmiEnabled(result.enabled);
        setNeedsPhone(result.needsPhone);
        setAnketaUrl(result.anketaUrl);
        setSyncError(result.syncError ?? '');
        if (result.enabled) {
          setCard(result.card);
          return;
        }
        return api.clientDashboard(token).then((dashboard) => {
          if (dashboard.accessCard) {
            setCard({
              id: dashboard.accessCard.id,
              barcode: dashboard.accessCard.barcode,
              clientName: dashboard.accessCard.clientName,
              clubName: dashboard.accessCard.clubName,
              membership: dashboard.membership,
              syncedAt: new Date().toISOString(),
              source: 'osmi',
            });
          } else {
            setCard(null);
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
      setSyncError(result.syncError ?? '');
      if (!result.card && result.needsPhone) {
        setNeedsPhone(true);
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

  if (needsPhone) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-slate-400">
          Укажите телефон в профиле — по нему выпустим или привяжем клубную карту OSMI.
        </p>
        <Link href="/client/profile/complete" className="btn-primary inline-block">
          Заполнить профиль
        </Link>
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

  if (!card) {
    return (
      <div className="card space-y-3 text-center text-slate-400">
        <p>Карта доступа недоступна</p>
        {osmiEnabled && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary w-full"
          >
            {syncing ? 'Синхронизация…' : 'Выпустить карту'}
          </button>
        )}
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

  const membership = card.membership;
  const progress = membership
    ? membershipProgress(membership.validFrom, membership.validUntil)
    : null;

  if (fullscreen) {
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
        {osmiEnabled && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="text-sm text-fitgo-400"
          >
            {syncing ? 'Обновление…' : 'Обновить'}
          </button>
        )}
      </div>

      {syncError && (
        <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
          {syncError}. Показана последняя сохранённая карта.
        </p>
      )}

      {membership && (
        <div className="card">
          <div className="mb-3 flex items-start justify-between">
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
            <div className="mb-3">
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
        </div>
      )}

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
    </div>
  );
}
