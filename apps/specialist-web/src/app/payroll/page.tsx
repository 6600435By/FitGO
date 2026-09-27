'use client';

import type { PayrollPeriodSummary } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function monthRange(d = new Date()) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('ru-BY', {
    style: 'currency',
    currency: currency || 'BYN',
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export default function PayrollPage() {
  const initial = useMemo(() => monthRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [summary, setSummary] = useState<PayrollPeriodSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      setSummary(await api.specialistPayrollSummary(token, from, to));
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Моя ЗП</h1>

      <section className="panel flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span style={{ color: 'var(--muted)' }}>С</span>
          <input
            type="date"
            className="field"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span style={{ color: 'var(--muted)' }}>По</span>
          <input
            type="date"
            className="field"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void load()}
        >
          Показать
        </button>
      </section>

      {error && (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {summary && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              ['Оклад', summary.baseSalaryMinor],
              ['Мотивация', summary.motivationMinor],
              ['Итого', summary.totalMinor],
            ].map(([label, value]) => (
              <div key={label as string} className="panel">
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  {label}
                </p>
                <p className="mt-1 font-display text-2xl">
                  {money(value as number, summary.currency)}
                </p>
              </div>
            ))}
          </section>

          {summary.payChips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {summary.payChips.map((c) => (
                <span
                  key={c}
                  className="rounded-full px-3 py-1 text-xs"
                  style={{
                    border: '1px solid var(--line)',
                    color: 'var(--muted)',
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}

          <section className="panel space-y-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
              Услуги за период ({summary.workUnits.length})
            </h2>
            {summary.workUnits.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                Нет начислений
              </p>
            ) : (
              <ul className="divide-y text-sm" style={{ borderColor: 'var(--line)' }}>
                {summary.workUnits.slice(0, 40).map((u) => (
                  <li
                    key={u.id}
                    className="flex items-start justify-between gap-3 py-2"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <div>
                      <p className="font-medium">{u.title}</p>
                      <p style={{ color: 'var(--muted)' }}>
                        {new Date(u.occurredAt).toLocaleDateString('ru-RU')}
                        {u.clientName ? ` · ${u.clientName}` : ''}
                        {u.payrollTrusted ? '' : ' · не в ЗП'}
                      </p>
                    </div>
                    <p className="tabular-nums">
                      {u.priceMinor != null
                        ? money(u.priceMinor, summary.currency)
                        : u.kind}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
