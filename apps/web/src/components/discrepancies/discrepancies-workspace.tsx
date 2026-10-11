'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DiscrepancyGroupResponse,
  DiscrepancySaleLine,
  DiscrepancySalesResponse,
  DiscrepancySegmentProduct,
  DiscrepancySegmentsResponse,
  DiscrepancySpaPtResponse,
  DiscrepancySummary,
  DiscrepancyTab,
} from '@fitgo/shared-types';
import {
  DISCREPANCY_RETENTION_DAYS,
  DISCREPANCY_SEGMENT_TITLES,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { DateField } from '@/components/admin-sales/date-field';

const TABS: { id: DiscrepancyTab; label: string }[] = [
  { id: 'segments', label: 'Сегменты' },
  { id: 'sales', label: 'Касса' },
  { id: 'spa', label: 'SPA' },
  { id: 'gp', label: 'ГП' },
  { id: 'pt', label: 'ПТ' },
];

/** Club calendar day (Europe/Minsk, UTC+3). */
function todayIso() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekBounds(): { from: string; to: string } {
  const to = todayIso();
  const d = new Date(`${to}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return { from: addDays(to, -dow), to };
}

function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function money(n: number) {
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusRu(s: string) {
  if (s === 'OK') return 'В сегменте';
  if (s === 'GUESSED') return 'Угадано';
  if (s === 'CONFLICT') return 'Конфликт';
  return 'Вне сегментов';
}

function statusClass(s: string) {
  if (s === 'OK') return 'text-emerald-400';
  if (s === 'GUESSED') return 'text-amber-300';
  return 'text-red-400';
}

function oldestAllowed() {
  return addDays(todayIso(), -DISCREPANCY_RETENTION_DAYS);
}

/** Deep-link to Продажи filtered by exact nomenclature (name and/or 1C UUID). */
function productSalesHref(
  p: Pick<DiscrepancySegmentProduct, 'name' | 'uuid'>,
  from: string,
  to: string,
) {
  const q = new URLSearchParams({
    from,
    to,
    product: p.name,
    productExact: '1',
  });
  if (p.uuid?.trim()) q.set('productId', p.uuid.trim());
  return `/super-admin/sales?${q.toString()}`;
}

export function DiscrepanciesWorkspace() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const defaults = useMemo(() => weekBounds(), []);

  const tab = ((): DiscrepancyTab => {
    const t = search.get('tab')?.trim() as DiscrepancyTab | undefined;
    if (t && TABS.some((x) => x.id === t)) return t;
    return 'segments';
  })();
  const from = search.get('from')?.trim() || defaults.from;
  const to = search.get('to')?.trim() || defaults.to;
  const employee = search.get('employee')?.trim() || '';
  const showAcked =
    search.get('showAcked') === '1' || search.get('showAcked') === 'true';
  const statusFilter = search.get('status')?.trim()?.toUpperCase() || '';
  const tenderFilter = ((): 'all' | 'cash' | 'card' => {
    const t = search.get('tender')?.trim()?.toLowerCase();
    if (t === 'cash' || t === 'card') return t;
    return 'all';
  })();

  const [customPeriod, setCustomPeriod] = useState(false);
  const [summary, setSummary] = useState<DiscrepancySummary | null>(null);
  const [segments, setSegments] = useState<DiscrepancySegmentsResponse | null>(
    null,
  );
  const [sales, setSales] = useState<DiscrepancySalesResponse | null>(null);
  const [spa, setSpa] = useState<DiscrepancySpaPtResponse | null>(null);
  const [pt, setPt] = useState<DiscrepancySpaPtResponse | null>(null);
  const [group, setGroup] = useState<DiscrepancyGroupResponse | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const setParams = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`);
    },
    [pathname, router, search],
  );

  const applyPreset = (id: string) => {
    setCustomPeriod(id === 'custom');
    if (id === 'today') {
      const t = todayIso();
      setParams({ from: t, to: t });
      return;
    }
    if (id === 'yesterday') {
      const y = addDays(todayIso(), -1);
      setParams({ from: y, to: y });
      return;
    }
    if (id === 'week') {
      const b = weekBounds();
      setParams({ from: b.from, to: b.to });
      return;
    }
    if (id === 'month') {
      const b = monthBounds();
      setParams({ from: b.from, to: b.to });
      return;
    }
    if (id === 'prevMonth') {
      const now = new Date();
      const fromD = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
      const toD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      setParams({
        from: fromD.toISOString().slice(0, 10),
        to: toD.toISOString().slice(0, 10),
      });
    }
  };

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setMessage('');
    const common = { from, to, employee: employee || undefined, showAcked };
    const jobs: Promise<unknown>[] = [
      api.discrepanciesSummary(token, common).then(setSummary),
    ];
    if (tab === 'segments') {
      jobs.push(api.discrepanciesSegments(token, common).then(setSegments));
    } else if (tab === 'sales') {
      jobs.push(api.discrepanciesSales(token, common).then(setSales));
    } else if (tab === 'spa') {
      jobs.push(api.discrepanciesSpa(token, common).then(setSpa));
    } else if (tab === 'pt') {
      jobs.push(api.discrepanciesPt(token, common).then(setPt));
    } else if (tab === 'gp') {
      jobs.push(api.discrepanciesGroup(token, common).then(setGroup));
    }
    Promise.all(jobs)
      .catch((e) => setMessage(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [from, to, employee, showAcked, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const ackItem = async (
    ackTab: DiscrepancyTab,
    itemKey: string,
    fingerprint: string,
  ) => {
    const token = getToken();
    if (!token) return;
    const note = window.prompt('Комментарий (необязательно)');
    if (note === null) return;
    try {
      await api.discrepanciesAck(token, {
        tab: ackTab,
        itemKey,
        fingerprint,
        note: note || undefined,
      });
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const employees =
    tab === 'segments'
      ? segments?.employees
      : tab === 'sales'
        ? sales?.employees
        : tab === 'spa'
          ? spa?.employees
          : tab === 'pt'
            ? pt?.employees
            : group?.employees;

  const badge = (id: DiscrepancyTab) => {
    if (!summary) return null;
    const n = summary[id];
    if (!n) return null;
    return (
      <span className="ml-1 rounded-full bg-slate-800 px-1.5 text-[10px] text-amber-300">
        {n}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Нестыковки</h1>
        <p className="text-sm text-slate-400">
          Сегменты 1С, касса Webkassa, списания с истекающих пакетов и поздние
          записи ГП. Период до {DISCREPANCY_RETENTION_DAYS} дней.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ['today', 'Сегодня'],
          ['yesterday', 'Вчера'],
          ['week', 'Неделя'],
          ['month', 'Месяц'],
          ['prevMonth', 'Прошлый месяц'],
          ['custom', 'Свой'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs ${
              (id === 'custom' && customPeriod) ||
              (id === 'week' && !customPeriod && from === weekBounds().from)
                ? 'border-emerald-600 text-emerald-300'
                : 'border-slate-700 text-slate-300'
            }`}
            onClick={() => applyPreset(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {customPeriod ? (
        <div className="flex flex-wrap gap-3">
          <DateField
            label="С"
            value={from}
            onChange={(v) => {
              if (v < oldestAllowed()) return;
              setParams({ from: v });
            }}
          />
          <DateField
            label="По"
            value={to}
            onChange={(v) => setParams({ to: v })}
          />
        </div>
      ) : null}

      <div className="-mx-1 sticky top-0 z-10 flex gap-2 overflow-x-auto bg-slate-950/95 px-1 py-2 backdrop-blur">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              tab === t.id
                ? 'bg-emerald-700/30 text-emerald-200'
                : 'bg-slate-900 text-slate-400'
            }`}
            onClick={() => setParams({ tab: t.id, employee: null, status: null })}
          >
            {t.label}
            {badge(t.id)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-500">
          Сотрудник
          <select
            className="input mt-1 block min-w-[12rem] text-sm"
            value={employee}
            onChange={(e) => setParams({ employee: e.target.value || null })}
          >
            <option value="">Все</option>
            {(employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.count})
              </option>
            ))}
          </select>
        </label>
        <label className="mt-5 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={showAcked}
            onChange={(e) =>
              setParams({ showAcked: e.target.checked ? '1' : null })
            }
          />
          Показать разобранные
        </label>
      </div>

      {message ? <p className="text-sm text-red-400">{message}</p> : null}
      {loading ? (
        <p className="text-sm text-slate-400">Загрузка…</p>
      ) : tab === 'segments' && segments ? (
        <SegmentsTab
          data={segments}
          statusFilter={statusFilter}
          from={from}
          to={to}
          onStatus={(s) => setParams({ status: s || null })}
          onRecheck={async () => {
            const token = getToken();
            if (!token) return;
            setBusy('recheck');
            try {
              await api.discrepanciesRecheckSegments(token);
              load();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Ошибка');
            } finally {
              setBusy('');
            }
          }}
          busy={busy === 'recheck'}
          onAck={(itemKey, fingerprint) =>
            void ackItem('segments', itemKey, fingerprint)
          }
        />
      ) : tab === 'sales' && sales ? (
        <SalesTab
          data={sales}
          from={from}
          to={to}
          tenderFilter={tenderFilter}
          onTender={(t) =>
            setParams({ tender: t === 'all' ? null : t })
          }
          expandedDay={expandedDay}
          setExpandedDay={setExpandedDay}
          onSync={async () => {
            const token = getToken();
            if (!token) return;
            setBusy('sync');
            try {
              await api.webkassaSync(token, from, to);
              load();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Ошибка выгрузки');
            } finally {
              setBusy('');
            }
          }}
          onUpload={async (file) => {
            const token = getToken();
            if (!token) return;
            setBusy('upload');
            try {
              await api.webkassaUpload(token, file);
              load();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Ошибка загрузки');
            } finally {
              setBusy('');
            }
          }}
          onAck={(itemKey, fingerprint) =>
            void ackItem('sales', itemKey, fingerprint)
          }
          busy={busy}
        />
      ) : tab === 'spa' && spa ? (
        <PerformerTab kind="SPA" data={spa} from={from} to={to} />
      ) : tab === 'pt' && pt ? (
        <PerformerTab kind="PT" data={pt} from={from} to={to} />
      ) : tab === 'gp' && group ? (
        <GroupTab data={group} from={from} to={to} />
      ) : (
        <p className="text-sm text-slate-500">Нет данных</p>
      )}
    </div>
  );
}

function SegmentsTab({
  data,
  statusFilter,
  from,
  to,
  onStatus,
  onRecheck,
  busy,
  onAck,
}: {
  data: DiscrepancySegmentsResponse;
  statusFilter: string;
  from: string;
  to: string;
  onStatus: (s: string) => void;
  onRecheck: () => void;
  busy: boolean;
  onAck: (itemKey: string, fingerprint: string) => void;
}) {
  const products = data.products.filter((p) => {
    if (!statusFilter) return p.status !== 'OK';
    return p.status === statusFilter;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {data.segments.map((s) => (
          <div key={s.key} className="card p-3">
            <p className="text-xs text-slate-500">{s.title}</p>
            <p className="text-lg font-semibold">{s.salesCount}</p>
            <p className="text-xs text-slate-400">{money(s.amount)} BYN</p>
          </div>
        ))}
        <div className="card border-amber-900/40 p-3">
          <p className="text-xs text-slate-500">Проблемы</p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className={statusFilter === 'UNASSIGNED' ? 'text-red-300' : 'text-red-400'}
              onClick={() => onStatus('UNASSIGNED')}
            >
              вне {data.problems.unassigned}
            </button>
            <button
              type="button"
              className={statusFilter === 'GUESSED' ? 'text-amber-200' : 'text-amber-300'}
              onClick={() => onStatus('GUESSED')}
            >
              угадано {data.problems.guessed}
            </button>
            <button
              type="button"
              className={statusFilter === 'CONFLICT' ? 'text-red-300' : 'text-red-400'}
              onClick={() => onStatus('CONFLICT')}
            >
              конфликт {data.problems.conflict}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={busy}
          onClick={onRecheck}
        >
          {busy ? 'Обновление…' : 'Обновить сегменты и перепроверить'}
        </button>
        {statusFilter ? (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => onStatus('')}
          >
            Сбросить фильтр статуса
          </button>
        ) : null}
      </div>

      {data.missingEmployees.length > 0 ? (
        <div className="card space-y-2 p-3">
          <p className="text-sm font-medium">Сотрудники вне staff-сегментов</p>
          <ul className="space-y-1 text-sm text-slate-300">
            {data.missingEmployees.map((e) => (
              <li key={e.externalId} className="flex justify-between gap-2">
                <span>{e.name}</span>
                <span className="shrink-0 text-emerald-400">
                  {e.salesCount > 0 ? (
                    <Link
                      href={`/super-admin/sales?employee=${encodeURIComponent(e.externalId)}&from=${from}&to=${to}`}
                    >
                      {e.salesCount} прод.
                    </Link>
                  ) : (
                    <span className="text-slate-500">{e.salesCount} прод.</span>
                  )}
                  {' · '}
                  {e.sessionsCount > 0 ? (
                    <Link
                      href={`/super-admin/review-queue?performerId=${encodeURIComponent(e.externalId)}&from=${from}&to=${to}`}
                    >
                      {e.sessionsCount} зан.
                    </Link>
                  ) : (
                    <span className="text-slate-500">
                      {e.sessionsCount} зан.
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.itemKey} className="card space-y-2 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className={`text-xs ${statusClass(p.status)}`}>
                  {statusRu(p.status)}
                  {p.suggestedSegment
                    ? ` → ${DISCREPANCY_SEGMENT_TITLES[p.suggestedSegment]}`
                    : ''}
                </p>
                <p className="text-xs text-slate-500">
                  сейчас: {p.currentBucket}
                  {p.oneCSaleType ? ` · 1С: ${p.oneCSaleType}` : ''}
                </p>
              </div>
              <Link
                className="text-lg font-semibold text-emerald-400"
                href={productSalesHref(p, from, to)}
                title="Продажи по этой номенклатуре"
              >
                {p.salesCount}
              </Link>
            </div>
            <p className="text-sm text-slate-300">{money(p.amount)} BYN</p>
            <p className="text-xs text-slate-500">
              Номенклатура не в сегменте · {p.salesCount} продаж · клик по числу —
              Продажи с фильтром
            </p>
            <details className="text-xs text-slate-500">
              <summary>UUID / группа</summary>
              <p className="mt-1 break-all">
                {p.uuid || '—'}{' '}
                {p.uuid ? (
                  <button
                    type="button"
                    className="text-emerald-400"
                    onClick={() => void navigator.clipboard.writeText(p.uuid!)}
                  >
                    Копировать
                  </button>
                ) : null}
              </p>
              <p>
                код: {p.code || '—'} · группа: {p.groupName || '—'}
              </p>
            </details>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => onAck(p.itemKey, p.fingerprint)}
              >
                Разобрано
              </button>
            </div>
          </li>
        ))}
        {products.length === 0 ? (
          <p className="text-sm text-emerald-400">Проблемных позиций нет.</p>
        ) : null}
      </ul>
    </div>
  );
}

function SalesTab({
  data,
  from,
  to,
  tenderFilter,
  onTender,
  expandedDay,
  setExpandedDay,
  onSync,
  onUpload,
  onAck,
  busy,
}: {
  data: DiscrepancySalesResponse;
  from: string;
  to: string;
  tenderFilter: 'all' | 'cash' | 'card';
  onTender: (t: 'all' | 'cash' | 'card') => void;
  expandedDay: string | null;
  setExpandedDay: (d: string | null) => void;
  onSync: () => void;
  onUpload: (file: File) => void;
  onAck: (itemKey: string, fingerprint: string) => void;
  busy: string;
}) {
  const eps = 0.02;
  const days = data.days.filter((d) => {
    if (tenderFilter === 'cash') return Math.abs(d.diffCash) > eps;
    if (tenderFilter === 'card') return Math.abs(d.diffCard) > eps;
    return true;
  });
  const unmatchedKassa = data.unmatchedKassa.filter((r) => {
    if (tenderFilter === 'cash') return Math.abs(r.cash) > eps;
    if (tenderFilter === 'card') return Math.abs(r.cashless) > eps;
    return true;
  });
  const unmatchedOneC = data.unmatchedOneC.filter((r) => {
    if (tenderFilter === 'cash') return Math.abs(r.cash) > eps;
    if (tenderFilter === 'card') return Math.abs(r.card) > eps;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-3 text-sm">
        <p>
          Касса:{' '}
          {data.webkassa.lastSuccessAt
            ? new Date(data.webkassa.lastSuccessAt).toLocaleString('ru-RU')
            : 'ещё не выгружали'}
          {data.webkassa.lastStatus === 'error' && data.webkassa.lastError ? (
            <span className="text-red-400"> · {data.webkassa.lastError}</span>
          ) : null}
        </p>
        <p className="text-xs text-slate-500">
          Безнал 1С (не через кассу): {money(data.oneCCashless)} · ЛС:{' '}
          {money(data.oneCPersonalAccount)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={!!busy}
            onClick={onSync}
          >
            {busy === 'sync' ? 'Выгрузка…' : 'Выгрузить из Webkassa'}
          </button>
          <label className="btn-secondary cursor-pointer text-sm">
            {busy === 'upload' ? 'Загрузка…' : 'Загрузить xlsx'}
            <input
              type="file"
              accept=".xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          {(
            [
              ['all', 'Все'],
              ['cash', 'Нал'],
              ['card', 'Карта'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={
                tenderFilter === id
                  ? 'rounded bg-slate-700 px-2 py-1 text-slate-100'
                  : 'rounded px-2 py-1 text-slate-400 hover:text-slate-200'
              }
              onClick={() => onTender(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-2">
        {days.map((d) => {
          const problemCash = Math.abs(d.diffCash) > eps;
          const problemCard = Math.abs(d.diffCard) > eps;
          const problem =
            tenderFilter === 'cash'
              ? problemCash
              : tenderFilter === 'card'
                ? problemCard
                : problemCash || problemCard;
          const diffLabel =
            tenderFilter === 'cash'
              ? `нал ${money(d.diffCash)}`
              : tenderFilter === 'card'
                ? `карта ${money(d.diffCard)}`
                : `нал ${money(d.diffCash)} · карта ${money(d.diffCard)}`;
          return (
            <li key={d.date} className="card p-3">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                onClick={() =>
                  setExpandedDay(expandedDay === d.date ? null : d.date)
                }
              >
                <span className="font-medium">{d.date}</span>
                <span
                  className={`text-sm ${problem ? 'text-red-400' : 'text-emerald-400'}`}
                >
                  {diffLabel}
                </span>
              </button>
              {expandedDay === d.date ? (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400 md:grid-cols-4">
                  {tenderFilter !== 'card' ? (
                    <>
                      <div>
                        Касса нал:{' '}
                        <span className="text-slate-200">
                          {money(d.kassaCash)}
                        </span>
                      </div>
                      <div>
                        1С нал:{' '}
                        <Link
                          className="text-emerald-400"
                          href={`/super-admin/sales?from=${d.date}&to=${d.date}&payment=cash`}
                        >
                          {money(d.oneCCash)}
                        </Link>
                      </div>
                    </>
                  ) : null}
                  {tenderFilter !== 'cash' ? (
                    <>
                      <div>
                        Касса карта:{' '}
                        <span className="text-slate-200">
                          {money(d.kassaCard)}
                        </span>
                      </div>
                      <div>
                        1С карта:{' '}
                        <Link
                          className="text-emerald-400"
                          href={`/super-admin/sales?from=${d.date}&to=${d.date}&payment=card`}
                        >
                          {money(d.oneCCard)}
                        </Link>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {days.length === 0 ? (
        <p className="text-sm text-slate-500">
          Нет расхождений
          {tenderFilter === 'cash'
            ? ' по наличным'
            : tenderFilter === 'card'
              ? ' по карте'
              : ''}{' '}
          за период
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Сопоставлено чеков: {data.matchedCount}
        {data.mixedMatched ? ` · смешанных продаж: ${data.mixedMatched}` : ''}
        {data.combinedMatched ? ` · составных: ${data.combinedMatched}` : ''}
      </p>

      {unmatchedKassa.length > 0 ? (
        <div className="card space-y-2 p-3">
          <p className="text-sm font-medium">Чеки без пары в 1С</p>
          <ul className="space-y-2 text-sm">
            {unmatchedKassa.slice(0, 40).map((r) => (
              <li
                key={r.itemKey}
                className="space-y-1 border-t border-slate-800 pt-2 first:border-0 first:pt-0"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">
                    {new Date(r.occurredAt).toLocaleString('ru-RU')} · {r.receiptId}
                    {r.cashier ? ` · ${r.cashier}` : ''}
                  </span>
                  <span className="shrink-0">
                    {tenderFilter === 'cash'
                      ? money(r.cash)
                      : tenderFilter === 'card'
                        ? money(r.cashless)
                        : money(r.amount)}
                  </span>
                </div>
                {tenderFilter === 'all' ? (
                  <p className="text-xs text-slate-500">
                    нал {money(r.cash)} · карта {money(r.cashless)}
                  </p>
                ) : null}
                {r.nearestOneC ? (
                  <div className="text-xs text-slate-500">
                    <p>
                      Ближайшая оплата 1С{' '}
                      {new Date(r.nearestOneC.occurredAt).toLocaleTimeString('ru-RU')} ·{' '}
                      {money(r.nearestOneC.amount)} (разница{' '}
                      <span className="text-amber-300">{money(r.nearestOneC.diff)}</span>)
                    </p>
                    <SaleLines lines={r.nearestOneC.lines} />
                  </div>
                ) : null}
                <AckButton
                  acked={r.acked}
                  onClick={() => onAck(r.itemKey, r.fingerprint)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unmatchedOneC.length > 0 ? (
        <div className="card space-y-2 p-3">
          <p className="text-sm font-medium">Оплаты 1С без чека</p>
          <ul className="space-y-2 text-sm">
            {unmatchedOneC.slice(0, 40).map((r) => (
              <li
                key={r.itemKey}
                className="space-y-1 border-t border-slate-800 pt-2 first:border-0 first:pt-0"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">
                    {new Date(r.occurredAt).toLocaleString('ru-RU')}
                    {r.clientName ? ` · ${r.clientName}` : ''}
                  </span>
                  <Link
                    className="shrink-0 text-emerald-400"
                    href={`/super-admin/sales?from=${from}&to=${to}&q=${encodeURIComponent(r.clientName || r.lines[0]?.productName || '')}`}
                  >
                    {tenderFilter === 'cash'
                      ? money(r.cash)
                      : tenderFilter === 'card'
                        ? money(r.card)
                        : money(r.amount)}
                  </Link>
                </div>
                <SaleLines lines={r.lines} />
                <p className="text-xs text-slate-500">
                  {tenderFilter === 'cash'
                    ? `нал ${money(r.cash)}`
                    : tenderFilter === 'card'
                      ? `карта ${money(r.card)}`
                      : `нал ${money(r.cash)} · карта ${money(r.card)}`}
                  {r.employeeName ? ` · ${r.employeeName}` : ''}
                </p>
                <AckButton
                  acked={r.acked}
                  onClick={() => onAck(r.itemKey, r.fingerprint)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SaleLines({ lines }: { lines: DiscrepancySaleLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-0.5 text-xs">
      {lines.map((l, i) => (
        <li key={`${l.productName}-${i}`} className="flex justify-between gap-2">
          <span className="truncate text-slate-300">{l.productName}</span>
          <span className="shrink-0 text-slate-500">
            <span className={l.segment ? 'text-slate-400' : 'text-red-400'}>
              {l.segment ? DISCREPANCY_SEGMENT_TITLES[l.segment] : 'вне сегментов'}
            </span>{' '}
            · {money(l.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AckButton({
  acked,
  onClick,
}: {
  acked?: boolean;
  onClick: () => void;
}) {
  if (acked) return <p className="text-xs text-slate-500">Разобрано</p>;
  return (
    <button type="button" className="btn-secondary text-xs" onClick={onClick}>
      Разобрано
    </button>
  );
}

function performerHref(
  kind: 'SPA' | 'PT' | 'GROUP',
  flag: 'EXPIRING_PACKAGE' | 'LATE_ADD',
  performerUserId: string | null | undefined,
  from: string,
  to: string,
) {
  const performer = performerUserId
    ? `&performerId=${encodeURIComponent(performerUserId)}`
    : '';
  return `/super-admin/review-queue?kind=${kind}${performer}&flag=${flag}&from=${from}&to=${to}`;
}

function PerformerTab({
  kind,
  data,
  from,
  to,
}: {
  kind: 'SPA' | 'PT';
  data: DiscrepancySpaPtResponse;
  from: string;
  to: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Списания с пакета, до конца которого на дату занятия осталось меньше 7
        дней. Всего: {data.total}
        {data.redTotal ? ` · красных: ${data.redTotal}` : ''}.
      </p>
      <ul className="space-y-2">
        {data.performers.map((p) => (
          <li key={p.performerId} className="card flex items-center justify-between gap-3 p-3">
            <div>
              <p className="font-medium">{p.performerName}</p>
              {p.approximate ? (
                <p className="text-xs text-amber-300">приблизительно</p>
              ) : null}
            </div>
            <Link
              className="text-xl font-semibold text-emerald-400"
              href={performerHref(kind, 'EXPIRING_PACKAGE', p.performerUserId, from, to)}
            >
              {p.count}
              {p.redCount ? (
                <span className="ml-1 text-sm text-red-400">/{p.redCount}</span>
              ) : null}
            </Link>
          </li>
        ))}
        {data.performers.length === 0 ? (
          <p className="text-sm text-emerald-400">Очередь пуста.</p>
        ) : null}
      </ul>
    </div>
  );
}

function GroupTab({
  data,
  from,
  to,
}: {
  data: DiscrepancyGroupResponse;
  from: string;
  to: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Записи, добавленные после окончания занятия. Всего поздних: {data.lateAddTotal}.
      </p>
      <ul className="space-y-2">
        {data.performers.map((p) => (
          <li key={p.performerId} className="card space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{p.performerName}</p>
              <Link
                className="text-xl font-semibold text-emerald-400"
                href={performerHref('GROUP', 'LATE_ADD', p.performerUserId, from, to)}
              >
                {p.lateAddCount}
              </Link>
            </div>
            <ul className="space-y-1 text-xs text-slate-400">
              {p.sessions.map((s) => (
                <li key={s.sessionKey} className="flex justify-between gap-2">
                  <Link
                    className="text-slate-300 hover:text-emerald-400"
                    href={`/super-admin/review-queue?sessionKey=${encodeURIComponent(s.sessionKey)}`}
                  >
                    {new Date(s.startAt).toLocaleString('ru-RU')} · {s.title}
                  </Link>
                  <span>
                    старт {s.bookedAtStart} → факт {s.confirmed} · +{s.lateAdds}
                    {s.duringAdds ? ` · во время ${s.duringAdds}` : ''}
                    {s.approximate ? ' ≈' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {data.performers.length === 0 ? (
          <p className="text-sm text-emerald-400">Поздних добавлений нет.</p>
        ) : null}
      </ul>

      {data.trustExceptions.length > 0 ? (
        <div className="card space-y-2 p-3">
          <p className="text-sm font-medium">Журналы на проверку</p>
          <ul className="space-y-2 text-sm">
            {data.trustExceptions.map((t) => (
              <li key={t.id} className="border-t border-slate-800 pt-2 first:border-0 first:pt-0">
                <p className="font-medium">{t.title}</p>
                <p className="text-xs text-slate-400">
                  {t.performerName} · {new Date(t.startAt).toLocaleString('ru-RU')} ·{' '}
                  <span className="text-amber-300">{t.trustBand}</span>
                </p>
                <p className="text-xs text-slate-500">
                  эталон {t.baselineCount} / факт {t.attendedCount}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
