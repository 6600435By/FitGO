'use client';

import type { MembershipProduct, PaymentResult } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatCurrency } from '@/lib/utils';

export default function ClientProductsPage() {
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
            <div className="mb-2 flex items-start justify-between">
              <div>
                <p className="font-semibold">{product.name}</p>
                {product.description && (
                  <p className="mt-1 text-sm text-slate-400">
                    {product.description}
                  </p>
                )}
              </div>
              <p className="text-lg font-bold text-fitgo-400">
                {formatCurrency(product.price, product.currency)}
              </p>
            </div>
            <p className="mb-3 text-sm text-slate-400">
              {product.durationDays} дней
              {product.visitsIncluded
                ? ` · ${product.visitsIncluded} визитов`
                : ' · безлимит'}
            </p>
            <button
              onClick={() => handleBuy(product.id)}
              disabled={payingId === product.id}
              className="btn-primary w-full"
            >
              Купить
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
