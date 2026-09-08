'use client';

import { MembershipStatus, type Membership } from '@fitgo/shared-types';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Бюджет дней заморозки: всего / использовано / осталось */
function freezeBudget(membership: Membership): {
  total: number | null;
  used: number | null;
  remaining: number;
} {
  const remaining = membership.freezeDaysRemaining ?? 0;
  const total =
    typeof membership.freezeDaysTotal === 'number'
      ? membership.freezeDaysTotal
      : null;
  const used =
    total != null ? Math.max(0, total - remaining) : null;
  return { total, used, remaining };
}

function FreezeBudgetLine({ membership }: { membership: Membership }) {
  const { total, used, remaining } = freezeBudget(membership);
  if (total == null) {
    return (
      <p className="text-xs text-slate-400">
        Осталось дней заморозки: <span className="text-slate-200">{remaining}</span>
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 text-center text-xs">
      <div className="rounded-lg bg-slate-900/60 px-2 py-1.5">
        <p className="text-slate-500">Всего</p>
        <p className="font-medium text-slate-200">{total}</p>
      </div>
      <div className="rounded-lg bg-slate-900/60 px-2 py-1.5">
        <p className="text-slate-500">Использовано</p>
        <p className="font-medium text-slate-200">{used}</p>
      </div>
      <div className="rounded-lg bg-slate-900/60 px-2 py-1.5">
        <p className="text-slate-500">Осталось</p>
        <p className="font-medium text-sky-200">{remaining}</p>
      </div>
    </div>
  );
}

type Props = {
  membership: Membership;
  onFrozen?: (membership: Membership) => void;
};

export function MembershipFreezePanel({ membership, onFrozen }: Props) {
  const remaining = membership.freezeDaysRemaining ?? 0;
  const [fromDate, setFromDate] = useState(todayIso);
  const [days, setDays] = useState(Math.min(1, Math.max(1, remaining)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const untilPreview = useMemo(() => {
    if (!fromDate || !days || days < 1) return null;
    return addDaysIso(fromDate, days);
  }, [fromDate, days]);

  if (membership.freezeAllowed !== true) {
    return null;
  }

  if (membership.status === MembershipStatus.FROZEN) {
    return (
      <div className="space-y-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-sm">
        <div>
          <p className="font-medium text-sky-200">Абонемент заморожен</p>
          {membership.frozenUntil && (
            <p className="mt-1 text-slate-400">
              До {formatDate(membership.frozenUntil)}. Срок действия продлён на
              дни заморозки.
            </p>
          )}
        </div>
        <FreezeBudgetLine membership={membership} />
      </div>
    );
  }

  if (membership.status !== MembershipStatus.ACTIVE) {
    return null;
  }

  if (remaining <= 0) {
    return (
      <div className="space-y-2 rounded-xl bg-slate-800/50 p-3 text-sm">
        <p className="text-slate-400">Дней заморозки не осталось</p>
        <FreezeBudgetLine membership={membership} />
      </div>
    );
  }

  const submit = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.clientFreezeMembership(token, {
        days,
        fromDate,
      });
      onFrozen?.(result.membership);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось заморозить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/80 bg-slate-800/30 p-3">
      <div>
        <p className="font-medium">Заморозка абонемента</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Срок действия абонемента увеличится на выбранные дни.
        </p>
      </div>

      <FreezeBudgetLine membership={membership} />

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-slate-400">
          С
          <input
            type="date"
            min={todayIso()}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
          />
        </label>
        <label className="block text-xs text-slate-400">
          На срок (дни)
          <input
            type="number"
            min={1}
            max={remaining}
            value={days}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setDays(Math.max(1, Math.min(remaining, Math.trunc(n))));
            }}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
          />
        </label>
      </div>

      {untilPreview && (
        <p className="text-xs text-slate-400">
          До {formatDate(untilPreview)} · абонемент продлится на {days} дн.
        </p>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      {!confirming ? (
        <button
          type="button"
          className="btn-secondary w-full text-sm"
          disabled={busy || days < 1 || days > remaining}
          onClick={() => setConfirming(true)}
        >
          Заморозить
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary flex-1 text-sm"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary flex-1 text-sm"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? '…' : 'Подтвердить'}
          </button>
        </div>
      )}
    </div>
  );
}
