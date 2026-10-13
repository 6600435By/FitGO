'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

interface FunnelStage {
  stage: string;
  count: number;
}

export default function AdminFunnelPage() {
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .adminFunnel(token)
      .then((data: { funnel: FunnelStage[] }) => setFunnel(data.funnel))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  const maxCount = Math.max(...funnel.map((s) => s.count), 1);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-3">
        {funnel.map((stage, index) => (
          <div key={stage.stage}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{stage.stage}</span>
              <span className="font-medium">{stage.count}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-fitgo-500 transition-all"
                style={{
                  width: `${(stage.count / maxCount) * 100}%`,
                  opacity: 1 - index * 0.15,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-slate-400">
        Данные из клиентской базы клуба. Напоминания — в разделе «Риск».
      </p>
    </div>
  );
}
