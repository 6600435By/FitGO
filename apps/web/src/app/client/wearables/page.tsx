'use client';

import type { WearableSyncResult } from '@fitgo/shared-types';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

const PROVIDERS = [
  { id: 'apple-health', name: 'Apple Health' },
  { id: 'google-fit', name: 'Google Fit' },
];

export default function ClientWearablesPage() {
  const [syncing, setSyncing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, WearableSyncResult>>({});

  const sync = async (provider: string) => {
    const token = getToken();
    if (!token) return;
    setSyncing(provider);
    try {
      const result = await api.syncWearable(token, provider);
      setResults((prev) => ({ ...prev, [provider]: result }));
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Интеграции</h2>
      <p className="text-sm text-slate-400">
        Синхронизация посещений и активности с носимых устройств
      </p>

      <ul className="space-y-3">
        {PROVIDERS.map((p) => (
          <li key={p.id} className="card">
            <div className="flex items-center justify-between">
              <p className="font-medium">{p.name}</p>
              <button
                onClick={() => sync(p.id)}
                disabled={syncing === p.id}
                className="btn-secondary text-sm"
              >
                {syncing === p.id ? '...' : 'Синхронизировать'}
              </button>
            </div>
            {results[p.id] && (
              <p className="mt-2 text-sm text-fitgo-400">
                Импортировано {results[p.id].visitsImported} визитов ·{' '}
                {formatDateTime(results[p.id].lastSyncAt)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
