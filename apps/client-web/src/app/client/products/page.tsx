'use client';

import type { MembershipProduct, PaymentResult } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatCurrency } from '@/lib/utils';

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
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Абонементы</h2>

      <div className="card border border-slate-700 text-sm text-slate-400">
        Онлайн-оплата на пилоте может быть недоступна. Оформить абонемент можно
        на ресепшен клуба.
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {payment?.status === 'pending' && (
        <div className="card border-fitgo-500/30 bg-fitgo-500/5">
          <p className="font-medium text-fitgo-400">Оплата создана</p>
          <p className="mt-1 text-sm text-slate-400">
            Сумма: {formatCurrency(payment.amount, payment.currency)}
          </p>
          {payment.paymentUrl && (
            <a
              href={payment.paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-3 inline-block"
            >
              Перейти к оплате
            </a>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {products.map((product) => (
          <li key={product.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{product.name}</p>
                {product.description && (
                  <p className="mt-1 text-sm text-slate-400">{product.description}</p>
                )}
                <p className="mt-2 text-fitgo-400">
                  {formatCurrency(product.price, product.currency)}
                </p>
              </div>
              <button
                type="button"
                disabled={payingId === product.id}
                onClick={() => handleBuy(product.id)}
                className="btn-primary shrink-0 disabled:opacity-50"
              >
                {payingId === product.id ? '…' : 'Купить'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {products.length === 0 && !error && (
        <div className="card text-center text-slate-400">
          Каталог пуст — оформите абонемент на ресепшен.
        </div>
      )}
    </div>
  );
}
