'use client';

import { MembershipStatus, type Membership } from '@fitgo/shared-types';
import { Snowflake } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/forma/button';
import { Sheet } from '@/components/forma/sheet';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  const used = total != null ? Math.max(0, total - remaining) : null;
  return { total, used, remaining };
}

function FreezeBudgetLine({ membership }: { membership: Membership }) {
  const { total, used, remaining } = freezeBudget(membership);
  if (total == null) {
    return (
      <p className="text-sm text-zinc-400">
        Осталось дней заморозки:{' '}
        <span className="font-medium text-white">{remaining}</span>
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 text-center text-xs">
      <div className="rounded-2xl bg-ink-raised px-2 py-2">
        <p className="text-zinc-500">Всего</p>
        <p className="font-display font-semibold text-white">{total}</p>
      </div>
      <div className="rounded-2xl bg-ink-raised px-2 py-2">
        <p className="text-zinc-500">Использовано</p>
        <p className="font-display font-semibold text-white">{used}</p>
      </div>
      <div className="rounded-2xl bg-ink-raised px-2 py-2">
        <p className="text-zinc-500">Осталось</p>
        <p className="font-display font-semibold text-forma-400">{remaining}</p>
      </div>
    </div>
  );
}

type Props = {
  membership: Membership;
  onFrozen?: (membership: Membership) => void;
  /** Trigger on yellow membership card (dark text). */
  onAccent?: boolean;
};

export function MembershipFreezePanel({
  membership,
  onFrozen,
  onAccent = false,
}: Props) {
  const remaining = membership.freezeDaysRemaining ?? 0;
  const [fromDate, setFromDate] = useState(todayIso);
  const [days, setDays] = useState(Math.min(1, Math.max(1, remaining || 1)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);

  const untilPreview = useMemo(() => {
    if (!fromDate || !days || days < 1) return null;
    return addDaysIso(fromDate, days);
  }, [fromDate, days]);

  if (membership.freezeAllowed !== true) {
    return null;
  }

  const isFrozen = membership.status === MembershipStatus.FROZEN;
  const isActive = membership.status === MembershipStatus.ACTIVE;

  if (!isFrozen && !isActive) {
    return null;
  }

  const triggerClass = onAccent
    ? 'border-ink/15 bg-ink/5 text-ink hover:bg-ink/10'
    : 'border-white/10 bg-ink-raised text-white hover:bg-white/[0.06]';

  const openSheet = () => {
    setError('');
    setConfirming(false);
    setOpen(true);
  };

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
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось заморозить');
    } finally {
      setBusy(false);
    }
  };

  const title = isFrozen ? 'Абонемент заморожен' : 'Заморозка абонемента';
  const subtitle = isFrozen
    ? membership.frozenUntil
      ? `До ${formatDate(membership.frozenUntil)}`
      : undefined
    : remaining <= 0
      ? 'Дней не осталось'
      : `Осталось ${remaining} дн.`;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-medium touch-manipulation',
          triggerClass,
        )}
      >
        <Snowflake className="h-4 w-4" />
        {isFrozen ? 'О заморозке' : 'Заморозить'}
      </button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={subtitle}
      >
        <div className="space-y-4">
          {isFrozen ? (
            <>
              {membership.frozenUntil ? (
                <p className="text-sm text-zinc-400">
                  До {formatDate(membership.frozenUntil)}. Срок действия продлён
                  на дни заморозки.
                </p>
              ) : null}
              <FreezeBudgetLine membership={membership} />
            </>
          ) : remaining <= 0 ? (
            <>
              <p className="text-sm text-zinc-400">
                Дней заморозки не осталось
              </p>
              <FreezeBudgetLine membership={membership} />
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-400">
                Срок действия абонемента увеличится на выбранные дни.
              </p>

              <FreezeBudgetLine membership={membership} />

              <div className="grid grid-cols-2 gap-2">
                <DateField
                  label="С"
                  value={fromDate}
                  min={todayIso()}
                  onChange={setFromDate}
                />
                <label className="block text-xs text-zinc-400">
                  На срок (дни)
                  <input
                    type="number"
                    min={1}
                    max={remaining}
                    value={days}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setDays(
                        Math.max(1, Math.min(remaining, Math.trunc(n))),
                      );
                    }}
                    className="input mt-1 w-full"
                  />
                </label>
              </div>

              {untilPreview ? (
                <p className="text-xs text-zinc-400">
                  До {formatDate(untilPreview)} · абонемент продлится на {days}{' '}
                  дн.
                </p>
              ) : null}

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}

              {!confirming ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy || days < 1 || days > remaining}
                  onClick={() => setConfirming(true)}
                >
                  Заморозить
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Отмена
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy}
                    loading={busy}
                    onClick={() => void submit()}
                  >
                    Подтвердить
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
