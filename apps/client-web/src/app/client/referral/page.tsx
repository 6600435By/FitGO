'use client';

import type { ReferralInfo } from '@fitgo/shared-types';
import { Gift, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/forma/button';
import { PageHeader } from '@/components/forma/page-header';
import { SkeletonCard } from '@/components/forma/skeleton';
import { useToast } from '@/components/forma/toast';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function ClientReferralPage() {
  const toast = useToast();
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

  const copyLink = async () => {
    if (!referral) return;
    try {
      await navigator.clipboard.writeText(referral.link);
      setCopied(true);
      toast.success('Ссылка скопирована');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const share = async () => {
    if (!referral) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Forma — приглашение',
          text: `Присоединяйся в Forma по моему коду ${referral.code}`,
          url: referral.link,
        });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await copyLink();
  };

  if (error) return <p className="text-rose-400">{error}</p>;

  if (!referral) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Приведи друга"
        subtitle="Делитесь Forma — получайте бонусы"
      />

      <div className="overflow-hidden rounded-[1.75rem] border border-forma-500/35 bg-gradient-to-br from-forma-500 via-forma-400 to-amber-500 p-6 text-ink shadow-forma-glow">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink/55">
              Ваш код
            </p>
            <p className="mt-2 font-display text-4xl font-extrabold tracking-wide">
              {referral.code}
            </p>
            <p className="mt-3 text-sm text-ink/70">
              Приглашено: {referral.referralsCount}
            </p>
          </div>
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink/15">
            <Gift className="h-7 w-7" />
          </span>
        </div>
      </div>

      <div className="card">
        <p className="text-sm text-zinc-500">Награда</p>
        <p className="mt-1 text-white">{referral.rewardDescription}</p>
      </div>

      <div className="card space-y-3">
        <p className="text-sm text-zinc-500">Ссылка для друга</p>
        <p className="break-all rounded-2xl bg-ink-raised px-3 py-2 text-sm text-zinc-300">
          {referral.link}
        </p>
        <Button className="w-full" size="lg" onClick={() => void share()}>
          <Share2 className="h-4 w-4" />
          Поделиться
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void copyLink()}>
          {copied ? 'Скопировано!' : 'Копировать ссылку'}
        </Button>
      </div>
    </div>
  );
}
