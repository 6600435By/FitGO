'use client';

import type { ReferralInfo } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function ClientReferralPage() {
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .referral(token)
      .then(setReferral)
      .catch((err) => setError(err.message));
  }, []);

  const copyLink = () => {
    if (!referral) return;
    navigator.clipboard.writeText(referral.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) return <p className="text-red-400">{error}</p>;

  if (!referral) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Приведи друга</h2>

      <div className="card text-center">
        <p className="text-sm text-slate-400">Ваш реферальный код</p>
        <p className="mt-2 text-3xl font-bold text-fitgo-400">{referral.code}</p>
        <p className="mt-4 text-sm text-slate-400">
          Приглашено: {referral.referralsCount}
        </p>
      </div>

      <div className="card">
        <p className="text-sm text-slate-400">Награда</p>
        <p className="mt-1">{referral.rewardDescription}</p>
      </div>

      <div className="card">
        <p className="mb-2 text-sm text-slate-400">Ссылка для друга</p>
        <p className="break-all text-sm">{referral.link}</p>
        <button onClick={copyLink} className="btn-primary mt-3 w-full">
          {copied ? 'Скопировано!' : 'Копировать ссылку'}
        </button>
      </div>
    </div>
  );
}
