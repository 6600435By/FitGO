'use client';

import type { ClubCardView, ClubCrmLinkStatus, Membership } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarcodeCard } from '@/components/barcode-card';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import {
  readAccessCardCache,
  writeAccessCardCache,
} from '@/lib/access-card-cache';
import { getToken } from '@/lib/auth';

function cardFromCache(): ClubCardView | null {
  const cached = readAccessCardCache();
  if (!cached) return null;
  return {
    id: 'cached',
    barcode: cached.barcode,
    barcodeFormat: cached.barcodeFormat ?? 'CODE128',
    clientName: cached.clientName,
    clubName: cached.clubName,
    membership: null,
    syncedAt: cached.syncedAt ?? new Date().toISOString(),
    source: (cached.source as ClubCardView['source']) ?? '1c',
  };
}

export default function ClientCardPage() {
  return (
    <ModuleGate module="club_card">
      <ClientCardPageInner />
    </ModuleGate>
  );
}

function ClientCardPageInner() {
  const [card, setCard] = useState<ClubCardView | null>(() => cardFromCache());
  const [membershipOnly, setMembershipOnly] = useState<Membership | null>(null);
  const [crmStatus, setCrmStatus] = useState<ClubCrmLinkStatus | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [anketaUrl, setAnketaUrl] = useState<string | undefined>();
  const [syncError, setSyncError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => !readAccessCardCache());
  const [syncing, setSyncing] = useState(false);
  const [fromCache, setFromCache] = useState(() => !!readAccessCardCache());

  const applyCard = useCallback((next: ClubCardView | null) => {
    setCard(next);
    if (next?.barcode) {
      writeAccessCardCache({
        barcode: next.barcode,
        barcodeFormat: next.barcodeFormat,
        clientName: next.clientName,
        clubName: next.clubName,
        syncedAt: next.syncedAt,
        source: next.source,
      });
      setFromCache(false);
    }
  }, []);

  const load = useCallback(
    (opts?: { silent?: boolean }) => {
      const token = getToken();
      if (!token) return;

      if (!opts?.silent && !readAccessCardCache()) {
        setLoading(true);
      }
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
            applyCard(result.card);
            return;
          }
          return api.clientDashboard(token).then((dashboard) => {
            setCrmStatus(dashboard.crmStatus ?? result.crmStatus ?? null);
            if (dashboard.accessCard) {
              applyCard({
                id: dashboard.accessCard.id,
                barcode: dashboard.accessCard.barcode,
                barcodeFormat: 'CODE128',
                clientName: dashboard.accessCard.clientName,
                clubName: dashboard.accessCard.clubName,
                membership: dashboard.membership,
                syncedAt: new Date().toISOString(),
                source: dashboard.cardSource ?? '1c',
              });
            } else if (!readAccessCardCache()) {
              applyCard(null);
              setMembershipOnly(dashboard.membership ?? result.membership ?? null);
            }
          });
        })
        .catch((err) => {
          if (!readAccessCardCache()) setError(err.message);
          else setSyncError(err.message);
        })
        .finally(() => setLoading(false));
    },
    [applyCard],
  );

  useEffect(() => {
    load({ silent: true });
  }, [load]);

  useEffect(() => {
    if (!card?.barcode) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const requestLock = async () => {
      try {
        if (!('wakeLock' in navigator)) return;
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // Unsupported or denied — brightness hint covers it
      }
    };

    void requestLock();
    const onVis = () => {
      if (!cancelled && document.visibilityState === 'visible') {
        void requestLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [card?.barcode]);

  const handleSync = async () => {
    const token = getToken();
    if (!token) return;
    setSyncing(true);
    setSyncError('');
    try {
      const result = await api.clientSyncClubCard(token);
      setCrmStatus(result.crmStatus ?? null);
      setMembershipOnly(result.membership ?? null);
      setSyncError(result.syncError ?? '');
      if (result.card) {
        applyCard(result.card);
      } else {
        if (result.needsPhone) setNeedsPhone(true);
        const dashboard = await api.clientDashboard(token);
        setCrmStatus(dashboard.crmStatus ?? result.crmStatus ?? null);
        if (dashboard.accessCard) {
          applyCard({
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

  if (loading && !card) {
    return (
      <div className="space-y-3">
        <div className="h-72 animate-pulse rounded-3xl bg-slate-800/60" />
        <p className="text-center text-sm text-slate-500">Загрузка карты…</p>
      </div>
    );
  }

  if (error && !card) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={() => load()} className="btn-secondary">
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

  return (
    <div className="space-y-3">
      {card && (
        <>
          <BarcodeCard
            barcode={card.barcode}
            barcodeFormat={card.barcodeFormat}
            clientName={card.clientName}
            clubName={card.clubName}
            membership={membership ?? undefined}
          />

          <p className="text-center text-xs text-slate-400">
            Для надёжного скана увеличьте яркость экрана
            {fromCache ? ' · показан последний сохранённый код' : ''}
          </p>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="text-sm text-fitgo-400"
            >
              {syncing ? 'Обновление…' : 'Обновить'}
            </button>
            <Link href="/client/visits" className="text-sm text-slate-400">
              Визиты →
            </Link>
          </div>

          {card.walletUrl && (
            <a
              href={card.walletUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary block text-center text-sm"
            >
              Добавить в Apple / Google Wallet
            </a>
          )}
        </>
      )}

      {syncError && (
        <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
          {syncError}. Показана последняя сохранённая карта.
        </p>
      )}

      {!card && membership && (
        <p className="text-center text-sm text-slate-400">
          Штрихкод ещё не присвоен в 1С. Обратитесь на ресепшен.
        </p>
      )}
    </div>
  );
}
