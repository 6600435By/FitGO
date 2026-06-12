'use client';

import { useEffect, useState } from 'react';
import { BarcodeCard } from '@/components/barcode-card';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

interface CardData {
  accessCard: {
    barcode: string;
    clientName: string;
    clubName: string;
  } | null;
}

export default function ClientCardPage() {
  const [data, setData] = useState<CardData | null>(null);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .clientDashboard(token)
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  if (!data.accessCard) {
    return (
      <div className="card text-center text-slate-400">
        <p>Карта доступа недоступна</p>
        <p className="mt-2 text-sm">
          Обратитесь к администратору клуба для получения карты
        </p>
      </div>
    );
  }

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-4">
        <button
          onClick={() => setFullscreen(false)}
          className="btn-secondary mb-4 self-end"
        >
          Закрыть
        </button>
        <BarcodeCard
          barcode={data.accessCard.barcode}
          clientName={data.accessCard.clientName}
          clubName={data.accessCard.clubName}
          fullscreen
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Карта доступа</h2>
      <BarcodeCard
        barcode={data.accessCard.barcode}
        clientName={data.accessCard.clientName}
        clubName={data.accessCard.clubName}
      />
      <button
        onClick={() => setFullscreen(true)}
        className="btn-primary w-full"
      >
        Открыть на весь экран
      </button>
    </div>
  );
}
