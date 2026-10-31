'use client';

import type { MembershipProduct, PaymentResult } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/forma/button';
import { EmptyState } from '@/components/forma/empty-state';
import { PageHeader } from '@/components/forma/page-header';
import { SkeletonCard } from '@/components/forma/skeleton';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatCurrency, cn } from '@/lib/utils';

export default function ClientProductsPage() {
  return (
    <ModuleGate module="membership_shop">
      <ClientProductsPageInner />
    </ModuleGate>
  );
}

function ClientProductsPageInner() {
  const [products, setProducts] = useState<MembershipProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .clientProducts(token)
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleBuy = async (productId: string) => {
    const token = getToken();
    if (!token) return;
    setPayingId(productId);
    setError('');
    setPayment(null);
    try {
      const result = await api.clientPayment(token, productId);
      setPayment(result);
      if (result.status === 'failed') {
        setError('Оплата не удалась');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setPayingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const popularId =
    products.length > 1
      ? products.slice().sort((a, b) => a.price - b.price)[
          Math.min(1, products.length - 1)
        ]?.id
      : products[0]?.id;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Абонементы"
        subtitle="Тарифы студии Forma"
      />

      <div className="rounded-2xl border border-white/10 bg-ink-raised/60 px-4 py-3 text-sm text-zinc-400">
        Онлайн-оплата на пилоте может быть недоступна. Оформить абонемент можно
        на ресепшен клуба.
      </div>

      {error ? <p className="text-rose-400">{error}</p> : null}

      {payment?.status === 'pending' ? (
        <div className="card border-forma-500/30 bg-forma-500/5">
          <p className="font-display font-semibold text-forma-400">
            Оплата создана
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Сумма: {formatCurrency(payment.amount, payment.currency)}
          </p>
          {payment.paymentUrl ? (
            <a
              href={payment.paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-3 inline-block"
            >
              Перейти к оплате
            </a>
          ) : null}
        </div>
      ) : null}

      {products.length === 0 && !error ? (
        <EmptyState
          title="Каталог пуст"
          description="Оформите абонемент на ресепшен"
        />
      ) : (
        <ul className="space-y-3">
          {products.map((product) => {
            const popular = product.id === popularId;
            return (
              <li
                key={product.id}
                className={cn(
                  'card relative overflow-hidden',
                  popular &&
                    'border-forma-500/40 bg-gradient-to-br from-forma-500/10 to-transparent shadow-forma-glow',
                )}
              >
                {popular ? (
                  <span className="absolute right-3 top-3 rounded-full bg-forma-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                    Популярный
                  </span>
                ) : null}
                <div className="flex items-start justify-between gap-3 pr-16">
                  <div>
                    <p className="font-display text-lg font-semibold text-white">
                      {product.name}
                    </p>
                    {product.description ? (
                      <p className="mt-1 text-sm text-zinc-400">
                        {product.description}
                      </p>
                    ) : null}
                    <p className="mt-3 font-display text-2xl font-bold text-forma-400">
                      {formatCurrency(product.price, product.currency)}
                    </p>
                  </div>
                </div>
                <Button
                  className="mt-4 w-full"
                  loading={payingId === product.id}
                  onClick={() => void handleBuy(product.id)}
                >
                  Купить
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
