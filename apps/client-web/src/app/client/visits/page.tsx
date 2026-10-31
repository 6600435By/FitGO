'use client';

import {
  VISIT_KIND_LABELS,
  isVerifiedVisitStatus,
  type ClientVisitsResponse,
  type Visit,
  type VisitKind,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/forma/button';
import { Chip } from '@/components/forma/chip';
import { EmptyState } from '@/components/forma/empty-state';
import { PageHeader } from '@/components/forma/page-header';
import { SkeletonCard } from '@/components/forma/skeleton';
import { StatTile } from '@/components/forma/stat-tile';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatShortVisitDate, formatVisitClock, visitHeadline } from '@/lib/utils';
import { cn } from '@/lib/utils';

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

function visitDayKey(date: string) {
  return date.includes('T') ? date.slice(0, 10) : date.slice(0, 10);
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
    if (kind && (kindCounts[kind] ?? 0) === 0) setKind('');
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
      } else if (visit.verification !== 'REJECTED') {
        confirmedList.push(visit);
      }
    }
    return { pending: pendingList, confirmed: confirmedList };
  }, [data, kind]);

  const monthGroups = useMemo(() => {
    const map = new Map<string, { label: string; visits: Visit[] }>();
    for (const visit of confirmed) {
      const d = new Date(
        visit.date.includes('T') ? visit.date : `${visit.date}T12:00:00`,
      );
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const existing = map.get(key);
      if (existing) {
        existing.visits.push(visit);
      } else {
        map.set(key, {
          label: d.toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          }),
          visits: [visit],
        });
      }
    }
    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      label: value.label,
      visits: value.visits,
    }));
  }, [confirmed]);

  const heatDays = useMemo(() => {
    const set = new Set(
      (data?.visits ?? [])
        .filter((v) => isVerifiedVisitStatus(v.verification) || !v.verification)
        .map((v) => visitDayKey(v.date)),
    );
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Array.from({ length: 28 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (27 - i));
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      return { key, active: set.has(key), day: d.getDate() };
    });
  }, [data]);

  const monthCount = confirmed.filter((v) => {
    const key = visitDayKey(v.date);
    const now = todayIso().slice(0, 7);
    return key.startsWith(now);
  }).length;

  let streak = 0;
  {
    const set = new Set(confirmed.map((v) => visitDayKey(v.date)));
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const day = String(cursor.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      if (set.has(key)) streak += 1;
      else if (i > 0) break;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

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

  if (error && !data) {
    return <p className="text-rose-400">{error}</p>;
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const empty = pending.length === 0 && confirmed.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Визиты"
        subtitle="Зал — через 1С; группа и персональная — после подтверждения"
      />

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="За месяц" value={monthCount} />
        <StatTile label="Серия" value={`${streak} дн.`} accent={streak > 0} />
        <StatTile label="Всего" value={confirmed.length} />
      </div>

      <div className="card">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
          4 недели
        </p>
        <div className="grid grid-cols-7 gap-1.5">
          {heatDays.map((d) => (
            <div
              key={d.key}
              className={cn(
                'aspect-square rounded-lg',
                d.active
                  ? 'bg-forma-500 shadow-forma-glow'
                  : 'bg-white/[0.06]',
              )}
              title={d.key}
            />
          ))}
        </div>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {(['90', '180', '365'] as const).map((r) => (
          <Chip key={r} active={range === r} onClick={() => setRange(r)}>
            {r === '90' ? '3 мес' : r === '180' ? '6 мес' : 'Год'}
          </Chip>
        ))}
      </div>

      {error ? <p className="text-sm text-amber-300">{error}</p> : null}

      {visibleKindFilters.length > 1 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {visibleKindFilters.map((f) => (
            <Chip
              key={f.value || 'all'}
              active={kind === f.value}
              count={f.value ? kindCounts[f.value] : undefined}
              onClick={() => setKind(f.value)}
            >
              {f.label}
            </Chip>
          ))}
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          title="Нет посещений"
          description="За выбранный период записей нет"
        />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">
                Нужно подтвердить · {pending.length}
              </h3>
              <ul className="space-y-2">
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
          ) : null}

          {monthGroups.map((group) => (
            <section key={group.key} className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                {group.label}
              </h3>
              <ul className="space-y-2">
                {group.visits.map((visit) => (
                  <VisitRow
                    key={visit.id}
                    visit={visit}
                    tone="confirmed"
                    confirmingId={confirmingId}
                    onSelfConfirm={selfConfirm}
                  />
                ))}
              </ul>
            </section>
          ))}
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
  const dateLine = [formatShortVisitDate(visit.date), when]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="card !p-3.5">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
            tone === 'pending' ? 'bg-amber-400' : 'bg-forma-500',
          )}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{headline}</p>
              <p className="mt-0.5 text-sm text-zinc-400">{dateLine}</p>
            </div>
            <p
              className={cn(
                'shrink-0 text-xs',
                tone === 'pending' ? 'text-amber-300' : 'text-forma-400',
              )}
            >
              {verificationLabel(visit)}
            </p>
          </div>
          {visit.canSelfConfirm && visit.bookingId ? (
            <Button
              size="sm"
              className="w-full sm:w-auto"
              loading={confirmingId === visit.bookingId}
              onClick={() => onSelfConfirm(visit.bookingId!)}
            >
              Я был на занятии
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
