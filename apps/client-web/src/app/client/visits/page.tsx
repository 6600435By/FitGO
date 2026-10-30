'use client';

import {
  VISIT_KIND_LABELS,
  isVerifiedVisitStatus,
  type ClientVisitsResponse,
  type Visit,
  type VisitKind,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatShortVisitDate, formatVisitClock, visitHeadline } from '@/lib/utils';

const KIND_FILTERS: Array<{ value: '' | VisitKind; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'GYM', label: VISIT_KIND_LABELS.GYM },
  { value: 'GROUP', label: VISIT_KIND_LABELS.GROUP },
  { value: 'PT', label: VISIT_KIND_LABELS.PT },
  { value: 'SPA_MASSAGE', label: VISIT_KIND_LABELS.SPA_MASSAGE },
  { value: 'SPA_BODYCOMP', label: VISIT_KIND_LABELS.SPA_BODYCOMP },
  { value: 'SOLARIUM', label: VISIT_KIND_LABELS.SOLARIUM },
];

function verificationLabel(visit: Visit): string {
  switch (visit.verification) {
    case 'VERIFIED_1C':
      return 'Из 1С';
    case 'VERIFIED_TRAINER':
      return 'Подтвердил тренер';
    case 'VERIFIED_CLIENT_SELF':
      return 'Вы подтвердили';
    case 'PENDING':
      return 'Ждёт подтверждения';
    case 'REJECTED':
      return 'Отклонён';
    default:
      return '';
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ClientVisitsPage() {
  return (
    <ModuleGate module="club_card">
      <ClientVisitsPageInner />
    </ModuleGate>
  );
}

function ClientVisitsPageInner() {
  const [data, setData] = useState<ClientVisitsResponse | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'' | VisitKind>('');
  const [range, setRange] = useState<'90' | '180' | '365'>('365');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    const from = isoDaysAgo(Number(range));
    const to = todayIso();
    setError('');
    // Always load full period — kind filter is client-side so chips stay stable.
    api
      .clientVisits(token, { from, to })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<VisitKind, number>> = {};
    for (const visit of data?.visits ?? []) {
      const k = visit.kind;
      if (!k || k === 'UNKNOWN') continue;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const visibleKindFilters = useMemo(
    () =>
      KIND_FILTERS.filter(
        (f) => f.value === '' || (kindCounts[f.value] ?? 0) > 0,
      ),
    [kindCounts],
  );

  useEffect(() => {
    if (kind && (kindCounts[kind] ?? 0) === 0) {
      setKind('');
    }
  }, [kind, kindCounts]);

  const { pending, confirmed } = useMemo(() => {
    const visits = (data?.visits ?? []).filter(
      (visit) => !kind || visit.kind === kind,
    );
    const pendingList: Visit[] = [];
    const confirmedList: Visit[] = [];
    for (const visit of visits) {
      if (isVerifiedVisitStatus(visit.verification)) {
        confirmedList.push(visit);
      } else if (
        visit.verification === 'PENDING' ||
        visit.canSelfConfirm
      ) {
        pendingList.push(visit);
      } else if (visit.verification === 'REJECTED') {
        // skip rejected from main lists
      } else {
        confirmedList.push(visit);
      }
    }
    return { pending: pendingList, confirmed: confirmedList };
  }, [data, kind]);

  async function selfConfirm(bookingId: string) {
    const token = getToken();
    if (!token) return;
    setConfirmingId(bookingId);
    try {
      await api.clientSelfConfirmGroupVisit(token, bookingId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подтвердить');
    } finally {
      setConfirmingId(null);
    }
  }

  if (error && !data) return <p className="text-red-400">{error}</p>;

  const empty = pending.length === 0 && confirmed.length === 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">История посещений</h2>
          <p className="text-sm text-slate-400">
            Зал — только через 1С; группа и персональная — после подтверждения
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['90', '180', '365'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                range === r
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {r === '90' ? '3 мес' : r === '180' ? '6 мес' : 'Год'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-amber-400">{error}</p>}

      {visibleKindFilters.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {visibleKindFilters.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setKind(f.value)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                kind === f.value
                  ? 'bg-slate-100 text-slate-900'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {f.label}
              {f.value ? ` (${kindCounts[f.value] ?? 0})` : ''}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-10 text-center text-slate-400">
          Нет записей о посещениях за выбранный период
        </div>
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-300/90">
                  Нужно подтвердить
                </h3>
                <span className="text-xs text-slate-500">{pending.length}</span>
              </div>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-amber-500/20 bg-slate-900/50">
                {pending.map((visit) => (
                  <VisitRow
                    key={visit.id}
                    visit={visit}
                    tone="pending"
                    confirmingId={confirmingId}
                    onSelfConfirm={selfConfirm}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Посещения
              </h3>
              <span className="text-xs text-slate-500">{confirmed.length}</span>
            </div>
            {confirmed.length === 0 ? (
              <p className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
                Пока нет подтверждённых визитов
              </p>
            ) : (
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
                {confirmed.map((visit) => (
                  <VisitRow
                    key={visit.id}
                    visit={visit}
                    tone="confirmed"
                    confirmingId={confirmingId}
                    onSelfConfirm={selfConfirm}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function VisitRow({
  visit,
  tone,
  confirmingId,
  onSelfConfirm,
}: {
  visit: Visit;
  tone: 'pending' | 'confirmed';
  confirmingId: string | null;
  onSelfConfirm: (bookingId: string) => void;
}) {
  const headline = visitHeadline(visit);
  const when = formatVisitClock(visit.checkIn) ?? '';
  const dateLine = [formatShortVisitDate(visit.date), when].filter(Boolean).join(' · ');

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            tone === 'pending' ? 'bg-amber-400' : 'bg-emerald-400'
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-100">{headline}</p>
              <p className="mt-0.5 text-sm text-slate-400">{dateLine}</p>
            </div>
            <p
              className={`shrink-0 text-xs ${
                tone === 'pending' ? 'text-amber-300' : 'text-emerald-400/90'
              }`}
            >
              {verificationLabel(visit)}
            </p>
          </div>

          {visit.canSelfConfirm && visit.bookingId && (
            <button
              type="button"
              className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
              disabled={confirmingId === visit.bookingId}
              onClick={() => onSelfConfirm(visit.bookingId!)}
            >
              {confirmingId === visit.bookingId
                ? 'Подтверждение…'
                : 'Я был на занятии'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
