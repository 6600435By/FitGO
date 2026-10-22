'use client';

import type {
  PricingAnalyticsReport,
  PricingSegmentBlock,
  PricingSegmentKey,
} from '@fitgo/shared-types';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const STALE_COMPETITOR_DAYS = 90;

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  })}\u00a0${currency}`;
}

function moneyShort(minor: number | null | undefined) {
  if (minor == null) return '—';
  return (minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function isStaleObserved(observedAt: string | null): boolean {
  if (!observedAt) return true;
  const t = new Date(`${observedAt}T12:00:00+03:00`).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_COMPETITOR_DAYS * 86400_000;
}

function periodIsPast(to: string): boolean {
  const end = new Date(`${to}T23:59:59+03:00`).getTime();
  return Number.isFinite(end) && end < Date.now() - 86400_000;
}

export function MarketPricingPanel({
  report,
  onReload,
}: {
  report: PricingAnalyticsReport;
  onReload: () => void;
}) {
  const { currency } = report;
  const [openSeg, setOpenSeg] = useState<PricingSegmentKey | null>(
    'membership',
  );
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [clubName, setClubName] = useState('');
  const [promoName, setPromoName] = useState('');
  const [promoFrom, setPromoFrom] = useState('');
  const [promoTo, setPromoTo] = useState('');
  const [showPromos, setShowPromos] = useState(false);
  const [showStaffDisc, setShowStaffDisc] = useState(false);
  const [showDiscTypes, setShowDiscTypes] = useState(false);

  const openBlock = useMemo(
    () => report.segments.find((s) => s.key === openSeg) ?? null,
    [report.segments, openSeg],
  );

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
      const token = getToken();
      if (!token) return false;
      setBusy(label);
      setErr('');
      setInfo('');
      try {
        await fn();
        onReload();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка');
        return false;
      } finally {
        setBusy('');
      }
    },
    [onReload],
  );

  const addClub = (segmentKey: Exclude<PricingSegmentKey, 'corporate'>) => {
    const name = clubName.trim();
    if (!name) return;
    void run('add-club', async () => {
      const token = getToken()!;
      await api.analyticsMarketAddCompetitor(token, { segmentKey, name });
      setClubName('');
    });
  };

  const refreshDiscounts = () => {
    void (async () => {
      const token = getToken();
      if (!token) return;
      setBusy('disc');
      setErr('');
      setInfo('');
      try {
        const res = await api.analyticsMarketRefreshDiscounts(token, {
          from: report.from,
          to: report.to,
        });
        if (res.status === 'ok' || res.status === 'partial') {
          setInfo(
            res.message ??
              `Скидки обновлены${res.imported != null ? `: ${res.imported} строк` : ''}`,
          );
        } else {
          setErr(res.message ?? `Статус: ${res.status}`);
        }
        onReload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        setBusy('');
      }
    })();
  };

  const disc = report.discounts;
  const syncedLabel = disc.syncedAt
    ? new Date(disc.syncedAt).toLocaleString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      })
    : null;

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-red-400">{err}</p>}
      {info && <p className="text-sm text-fitgo-300">{info}</p>}

      <div className="card space-y-2">
        <p className="text-sm font-medium text-fitgo-300">{report.mode.label}</p>
        {report.mode.detail && (
          <p className="text-xs text-slate-400">{report.mode.detail}</p>
        )}
        {report.mixedPeriod && report.mixedPeriodNote && (
          <p className="text-xs text-amber-300/90">{report.mixedPeriodNote}</p>
        )}
        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
          <span>
            Выручка:{' '}
            <strong className="text-white">
              {money(report.revenueMinor, currency)}
            </strong>
          </span>
          <span className="inline-flex flex-wrap items-center gap-2">
            Скидки:{' '}
            {disc.available
              ? money(disc.totalDiscountMinor ?? 0, currency)
              : 'н/д'}
            {disc.available && disc.deltaPct != null && (
              <span className="text-xs text-slate-500">
                {disc.deltaPct > 0 ? '+' : ''}
                {disc.deltaPct}% к базе
              </span>
            )}
            {disc.available && disc.shareOfRevenuePct != null && (
              <span className="text-xs text-slate-500">
                {disc.shareOfRevenuePct}% от суммы до скидки
              </span>
            )}
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!!busy}
              onClick={refreshDiscounts}
            >
              {busy === 'disc' ? '…' : 'Обновить скидки из 1С'}
            </button>
            {syncedLabel && (
              <span className="text-xs text-slate-600">
                синхр. {syncedLabel}
              </span>
            )}
          </span>
          <span className="text-slate-500">
            Сравнение: {report.baselineLabel}
          </span>
        </div>
        {!disc.available && disc.message && (
          <p className="text-xs text-amber-300/90">{disc.message}</p>
        )}
        {disc.available && disc.status === 'partial' && disc.message && (
          <p className="text-xs text-amber-300/90">{disc.message}</p>
        )}
        {disc.available &&
          disc.clientsMinor != null &&
          disc.staffRelatedMinor != null && (
            <p className="text-xs text-slate-500">
              Клиентам {money(disc.clientsMinor, currency)} · сотрудникам и
              родственникам {money(disc.staffRelatedMinor, currency)}
            </p>
          )}
        {report.priceListAsOf && (
          <p className="text-xs text-slate-600">
            Прайс 1С сейчас (
            {new Date(report.priceListAsOf).toLocaleString('ru-RU')})
            {periodIsPast(report.to)
              ? ' — цены на дату периода в 1С недоступны, сравниваем с текущим прайсом'
              : ''}
          </p>
        )}
      </div>

      {report.hints.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold">Куда смотреть</h3>
          {report.hints.map((h, i) => (
            <div
              key={`${h.action}-${i}`}
              className="rounded-xl bg-slate-800/50 p-3 text-sm"
            >
              <p className="font-medium text-fitgo-300">{h.title}</p>
              <p className="mt-1 text-slate-300">{h.body}</p>
              {h.ignoredNote && (
                <p className="mt-1 text-xs text-slate-500">{h.ignoredNote}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {report.segments.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setOpenSeg(s.key)}
            className={`card text-left transition ${
              openSeg === s.key ? 'ring-1 ring-fitgo-500' : ''
            }`}
          >
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className="mt-1 text-lg font-semibold">
              {money(s.revenueMinor, currency)}
            </p>
            <p className="text-xs text-slate-500">
              {s.sharePct}% · {s.summaryLine}
              {s.deltaPct != null ? ` · ${s.deltaPct > 0 ? '+' : ''}${s.deltaPct}%` : ''}
            </p>
          </button>
        ))}
        <div className="card text-left opacity-90">
          <p className="text-xs text-slate-400">Корпо</p>
          <p className="mt-1 text-lg font-semibold">
            {money(report.corporate.revenueMinor, currency)}
          </p>
          <p className="text-xs text-slate-500">
            {report.corporate.sharePct}% · {report.corporate.note}
          </p>
        </div>
      </div>

      {openBlock && (
        <SegmentTable
          key={openBlock.key}
          block={openBlock}
          currency={currency}
          clubName={clubName}
          setClubName={setClubName}
          busy={busy}
          onAddClub={() =>
            addClub(openBlock.key as Exclude<PricingSegmentKey, 'corporate'>)
          }
          onDeleteClub={(id) =>
            void run('del-club', async () => {
              await api.analyticsMarketDeleteCompetitor(getToken()!, id);
            })
          }
          onSaveClubEdit={(competitorId, payload) =>
            run('save-club-edit', async () => {
              const token = getToken()!;
              if (payload.priceListUrl !== undefined) {
                await api.analyticsMarketPatchCompetitor(token, competitorId, {
                  priceListUrl: payload.priceListUrl,
                });
              }
              if (payload.prices.length > 0) {
                await api.analyticsMarketBatchUpsertPrices(token, {
                  competitorId,
                  prices: payload.prices,
                });
              }
            })
          }
          onDeletePrice={(competitorId, productExternalId) =>
            void run('del-price', async () => {
              await api.analyticsMarketDeletePrice(getToken()!, {
                competitorId,
                productExternalId,
              });
            })
          }
          onError={setErr}
        />
      )}

      {disc.available && (
        <div className="card space-y-2">
          <button
            type="button"
            className="text-sm font-medium text-slate-300"
            onClick={() => setShowDiscTypes((v) => !v)}
          >
            Виды скидок {showDiscTypes ? '▾' : '▸'}
          </button>
          {showDiscTypes &&
            (disc.byType.length > 0 ? (
              <ul className="space-y-1 text-sm text-slate-400">
                {disc.byType.map((t) => (
                  <li key={t.discountName}>
                    {t.discountName}: {money(t.discountMinor, currency)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                За период денежных скидок нет.
              </p>
            ))}
        </div>
      )}

      {disc.available && (
        <div className="card">
          <button
            type="button"
            className="text-sm font-medium text-slate-300"
            onClick={() => setShowStaffDisc((v) => !v)}
          >
            Кто дал скидки {showStaffDisc ? '▾' : '▸'}
          </button>
          {showStaffDisc &&
            (disc.byStaff.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-slate-400">
                {disc.byStaff.map((s) => (
                  <li key={s.employeeExternalId ?? s.employeeName}>
                    {s.employeeName}: {money(s.discountMinor, currency)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Нет строк с сотрудником-продавцом за период.
              </p>
            ))}
        </div>
      )}

      <div className="card space-y-2">
        <button
          type="button"
          className="text-sm font-medium text-slate-300"
          onClick={() => setShowPromos((v) => !v)}
        >
          Другие распродажи {showPromos ? '▾' : '▸'}
        </button>
        <p className="text-xs text-slate-500">
          Август уже учтён как ежегодная распродажа абонементов.
        </p>
        {showPromos && (
          <div className="space-y-2">
            <ul className="text-sm text-slate-400">
              {report.saleWindows.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-2 py-1"
                >
                  <span>
                    {w.name}: {w.from} — {w.to}
                    {w.builtin ? ' (встроено)' : ''}
                  </span>
                  {!w.builtin && (
                    <button
                      type="button"
                      className="text-xs text-rose-400"
                      onClick={() =>
                        void run('del-promo', async () => {
                          await api.analyticsMarketDeleteSaleWindow(
                            getToken()!,
                            w.id,
                          );
                        })
                      }
                    >
                      удалить
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                Название
                <input
                  className="input mt-1"
                  value={promoName}
                  onChange={(e) => setPromoName(e.target.value)}
                />
              </label>
              <label className="text-xs">
                С
                <input
                  type="date"
                  className="input mt-1"
                  value={promoFrom}
                  onChange={(e) => setPromoFrom(e.target.value)}
                />
              </label>
              <label className="text-xs">
                По
                <input
                  type="date"
                  className="input mt-1"
                  value={promoTo}
                  onChange={(e) => setPromoTo(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={!!busy}
                onClick={() => {
                  if (!promoName || !promoFrom || !promoTo) return;
                  void run('add-promo', async () => {
                    await api.analyticsMarketAddSaleWindow(getToken()!, {
                      name: promoName,
                      from: promoFrom,
                      to: promoTo,
                      segmentKey: 'membership',
                    });
                    setPromoName('');
                    setPromoFrom('');
                    setPromoTo('');
                  });
                }}
              >
                Добавить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentTable({
  block,
  currency,
  clubName,
  setClubName,
  busy,
  onAddClub,
  onDeleteClub,
  onSaveClubEdit,
  onDeletePrice,
  onError,
}: {
  block: PricingSegmentBlock;
  currency: string;
  clubName: string;
  setClubName: (v: string) => void;
  busy: string;
  onAddClub: () => void;
  onDeleteClub: (id: string) => void;
  onSaveClubEdit: (
    competitorId: string,
    payload: {
      priceListUrl?: string | null;
      prices: Array<{ productExternalId: string; priceMinor: number }>;
    },
  ) => Promise<boolean>;
  onDeletePrice: (competitorId: string, productExternalId: string) => void;
  onError: (msg: string) => void;
}) {
  const [clubFilter, setClubFilter] = useState<'all' | string>('all');
  const [editingClubId, setEditingClubId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [urlDraft, setUrlDraft] = useState<Record<string, string>>({});

  const visibleCompetitors = useMemo(() => {
    if (clubFilter === 'all') return block.competitors;
    return block.competitors.filter((c) => c.id === clubFilter);
  }, [block.competitors, clubFilter]);

  const colCount = 6 + visibleCompetitors.length + 1;

  const startEdit = (competitorId: string) => {
    const drafts: Record<string, string> = {};
    for (const p of block.products) {
      if (!p.productExternalId) continue;
      const cell = p.competitorCells.find((x) => x.competitorId === competitorId);
      drafts[p.productExternalId] =
        cell?.priceMinor != null ? String(cell.priceMinor / 100) : '';
    }
    const club = block.competitors.find((c) => c.id === competitorId);
    setPriceDraft(drafts);
    setUrlDraft({ [competitorId]: club?.priceListUrl ?? '' });
    setEditingClubId(competitorId);
    if (clubFilter === 'all') setClubFilter(competitorId);
  };

  const cancelEdit = () => {
    setEditingClubId(null);
    setPriceDraft({});
  };

  const saveEdit = (competitorId: string) => {
    const prices: Array<{ productExternalId: string; priceMinor: number }> =
      [];
    for (const [productExternalId, raw] of Object.entries(priceDraft)) {
      const t = raw.trim();
      if (!t) continue;
      const major = Number(t.replace(',', '.'));
      if (!Number.isFinite(major) || major < 0) {
        onError('Некорректная цена');
        return;
      }
      prices.push({
        productExternalId,
        priceMinor: Math.round(major * 100),
      });
    }
    const url = (urlDraft[competitorId] ?? '').trim();
    const club = block.competitors.find((c) => c.id === competitorId);
    const urlChanged = (club?.priceListUrl ?? '') !== url;
    if (!urlChanged && prices.length === 0) {
      onError('Нет изменений для сохранения');
      return;
    }
    void onSaveClubEdit(competitorId, {
      priceListUrl: urlChanged ? url || null : undefined,
      prices,
    }).then((ok) => {
      if (!ok) return;
      setEditingClubId(null);
      setPriceDraft({});
    });
  };

  const setFilter = (next: 'all' | string) => {
    setClubFilter(next);
    if (editingClubId && next !== editingClubId) {
      cancelEdit();
    }
  };

  const productRows: ReactNode[] = [];
  let lastFamily: string | null = null;
  for (const p of block.products) {
    const familyKey = p.familyKey ?? null;
    const showFamily =
      block.key === 'membership' &&
      familyKey &&
      familyKey !== lastFamily;
    if (showFamily) lastFamily = familyKey;
    const rowKey = `${p.productExternalId ?? p.productName}`;
    if (showFamily) {
      productRows.push(
        <tr key={`fam-${familyKey}`} className="border-t border-slate-700">
          <td
            colSpan={colCount}
            className="bg-slate-800/60 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-fitgo-300"
          >
            {p.familyLabel ?? familyKey}
          </td>
        </tr>,
      );
    }
    productRows.push(
      <tr key={rowKey} className="border-t border-slate-800 align-top">
        <td className="px-2 py-2">
          <span className="text-slate-200">{p.productName}</span>
          {p.isCore && p.salesCount > 0 && (
            <span className="ml-1 rounded bg-fitgo-500/20 px-1 text-[10px] text-fitgo-300">
              основа
            </span>
          )}
          {p.discountSharePct != null && (
            <p className="text-xs text-slate-500">скидка {p.discountSharePct}%</p>
          )}
          {p.bridge && (
            <p className="text-xs text-slate-600">{p.bridge.summary}</p>
          )}
        </td>
        <td className="px-2 py-2 tabular-nums">
          {moneyShort(p.listPriceMinor)}
        </td>
        <td className="px-2 py-2 tabular-nums text-slate-400">
          {p.avgToListRatio != null
            ? `${Math.round(p.avgToListRatio * 100)}%`
            : '—'}
        </td>
        <td className="px-2 py-2 tabular-nums">{p.salesCount}</td>
        <td className="px-2 py-2 tabular-nums">
          {p.salesCount > 0 ? money(p.revenueMinor, currency) : '—'}
        </td>
        <td className="px-2 py-2 tabular-nums text-slate-400">
          {p.deltaPct != null
            ? `${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}%`
            : '—'}
        </td>
        {visibleCompetitors.map((c) => {
          const cell = p.competitorCells.find((x) => x.competitorId === c.id);
          const stale = isStaleObserved(cell?.observedAt ?? null);
          const editing = editingClubId === c.id;
          const draftKey = p.productExternalId ?? '';
          return (
            <td key={c.id} className="px-2 py-2">
              {editing && p.productExternalId ? (
                <div className="flex gap-1">
                  <input
                    className="input w-20 py-0.5 text-xs"
                    placeholder="цена"
                    value={priceDraft[draftKey] ?? ''}
                    onChange={(e) =>
                      setPriceDraft((d) => ({
                        ...d,
                        [draftKey]: e.target.value,
                      }))
                    }
                  />
                  {cell?.priceMinor != null && (
                    <button
                      type="button"
                      className="px-1 text-[10px] text-rose-400"
                      disabled={!!busy}
                      title="Удалить цену"
                      onClick={() => {
                        onDeletePrice(c.id, p.productExternalId!);
                        setPriceDraft((d) => ({
                          ...d,
                          [draftKey]: '',
                        }));
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : cell?.priceMinor != null ? (
                <span
                  className={`tabular-nums ${stale ? 'text-slate-500' : ''}`}
                  title={
                    cell.observedAt
                      ? `на ${cell.observedAt}${stale ? ' (старше 90 дн.)' : ''}`
                      : undefined
                  }
                >
                  {moneyShort(cell.priceMinor)}
                  {cell.observedAt && (
                    <span className="ml-1 text-[10px] text-slate-600">
                      {cell.observedAt.slice(5)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </td>
          );
        })}
        <td className="px-2 py-2 text-xs text-slate-400">
          {p.hintText ?? (p.marketLabel ? p.marketLabel : '—')}
        </td>
      </tr>,
    );
  }

  return (
    <div className="card space-y-3 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {block.label}
          {block.key === 'membership'
            ? ' — каталог'
            : block.topN
              ? ` — ${block.topN} главных продаж за период`
              : ''}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input text-sm"
            placeholder="Название клуба"
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!!busy || !clubName.trim()}
            onClick={onAddClub}
          >
            Добавить клуб
          </button>
        </div>
      </div>

      {block.competitors.length === 0 && (
        <p className="text-sm text-slate-500">
          Добавьте клуб, чтобы сравнивать цены.
        </p>
      )}

      {block.competitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 ${
              clubFilter === 'all'
                ? 'bg-fitgo-500/30 text-fitgo-200'
                : 'bg-slate-800 text-slate-400'
            }`}
            onClick={() => setFilter('all')}
          >
            Все
          </button>
          {block.competitors.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              <button
                type="button"
                className={`rounded-full px-2.5 py-1 ${
                  clubFilter === c.id
                    ? 'bg-fitgo-500/30 text-fitgo-200'
                    : 'bg-slate-800 text-slate-400'
                }`}
                onClick={() => setFilter(c.id)}
              >
                {c.name}
              </button>
              <button
                type="button"
                className="text-rose-400"
                title="Удалить клуб"
                disabled={!!busy}
                onClick={() => onDeleteClub(c.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="px-2 py-2">Услуга</th>
            <th className="px-2 py-2">Наша цена</th>
            <th className="px-2 py-2">Чек / прайс</th>
            <th className="px-2 py-2">Продали</th>
            <th className="px-2 py-2">Выручка</th>
            <th className="px-2 py-2">К базе</th>
            {visibleCompetitors.map((c) => (
              <th key={c.id} className="px-2 py-2">
                <div className="space-y-1">
                  <div>{c.name}</div>
                  {editingClubId === c.id ? (
                    <>
                      <input
                        className="input w-full py-0.5 text-[10px] font-normal normal-case"
                        placeholder="ссылка на прайс"
                        value={urlDraft[c.id] ?? ''}
                        onChange={(e) =>
                          setUrlDraft((d) => ({
                            ...d,
                            [c.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn-primary px-1.5 py-0.5 text-[10px]"
                          disabled={!!busy}
                          onClick={() => saveEdit(c.id)}
                        >
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className="btn-secondary px-1.5 py-0.5 text-[10px]"
                          disabled={!!busy}
                          onClick={cancelEdit}
                        >
                          Отмена
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {c.priceListUrl ? (
                        <a
                          href={c.priceListUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[10px] font-normal normal-case text-fitgo-400"
                        >
                          прайс
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="btn-secondary px-1.5 py-0.5 text-[10px]"
                        disabled={!!busy || editingClubId != null}
                        onClick={() => startEdit(c.id)}
                      >
                        Изменить
                      </button>
                    </>
                  )}
                </div>
              </th>
            ))}
            <th className="px-2 py-2">Что сделать</th>
          </tr>
        </thead>
        <tbody>
          {productRows}
          {block.products.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-2 py-4 text-slate-500">
                {block.key === 'membership'
                  ? 'Каталог абонементов пуст — проверьте сегмент в 1С'
                  : 'Нет продаж в этом сегменте за период'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {(block.orphanPricedCount ?? 0) > 0 && (
        <p className="text-xs text-slate-500">
          Ещё {block.orphanPricedCount} позиций с сохранёнными ценами (вне
          топ-{block.topN})
        </p>
      )}
    </div>
  );
}
