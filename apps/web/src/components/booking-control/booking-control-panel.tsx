'use client';

import {
  paymentLabelRu,
  payTagLabelRu,
  type BookingControlDetail,
  type BookingControlKind,
  type BookingControlListItem,
  type BookingControlStatus,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/utils';

export type BookingControlApi = {
  list: (params: {
    from: string;
    to: string;
    kind?: string;
    status?: string;
    needsReview?: boolean;
    payment?: string;
    performerId?: string;
  }) => Promise<BookingControlListItem[]>;
  detail: (sessionKey: string) => Promise<BookingControlDetail>;
  openRemark: (
    sessionKey: string,
    comment: string,
  ) => Promise<unknown>;
  resolveRemark?: (
    sessionKey: string,
    adminComment: string,
  ) => Promise<unknown>;
};

type Props = {
  api: BookingControlApi;
  /** Admin can resolve remarks */
  canResolve?: boolean;
  /** Hide kind filter (specialist SPA-only) */
  fixedKind?: BookingControlKind;
  title?: string;
  subtitle?: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function statusRu(s: BookingControlStatus) {
  if (s === 'COMPLETED') return 'Выполнено';
  if (s === 'CANCELLED') return 'Отменено';
  return 'Запланировано';
}

function kindRu(k: BookingControlKind) {
  if (k === 'GROUP') return 'ГП';
  if (k === 'PT') return 'ПТ';
  if (k === 'SOLARIUM') return 'Соляр.';
  return 'SPA';
}

export function BookingControlPanel({
  api,
  canResolve = false,
  fixedKind,
  title = 'Контроль записей',
  subtitle = 'Занятия из 1С. Разовые ПТ из продажи — отдельно. Запись FitGO без 1С — в ЗП не идёт.',
}: Props) {
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(todayIso());
  const [kind, setKind] = useState<string>(fixedKind ?? 'ALL');
  const [status, setStatus] = useState('ALL');
  const [payment, setPayment] = useState('ALL');
  const [needsReview, setNeedsReview] = useState(false);
  const [items, setItems] = useState<BookingControlListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<BookingControlDetail | null>(null);
  const [comment, setComment] = useState('');
  const [adminComment, setAdminComment] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setMessage('');
    api
      .list({
        from,
        to,
        kind: fixedKind ?? kind,
        status,
        payment,
        needsReview,
      })
      .then(setItems)
      .catch((e) =>
        setMessage(e instanceof Error ? e.message : 'Ошибка загрузки'),
      )
      .finally(() => setLoading(false));
  }, [api, from, to, kind, status, payment, needsReview, fixedKind]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (sessionKey: string) => {
    setDetailLoading(true);
    setComment('');
    setAdminComment('');
    try {
      const d = await api.detail(sessionKey);
      setSelected(d);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setDetailLoading(false);
    }
  };

  const submitRemark = async () => {
    if (!selected || !comment.trim()) return;
    try {
      await api.openRemark(selected.sessionKey, comment.trim());
      setMessage('Замечание отправлено — занятие на проверке');
      setComment('');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const resolve = async () => {
    if (!selected || !api.resolveRemark || !adminComment.trim()) return;
    try {
      await api.resolveRemark(selected.sessionKey, adminComment.trim());
      setMessage('Замечание отработано');
      setAdminComment('');
      await openDetail(selected.sessionKey);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const setToday = () => {
    const d = todayIso();
    setFrom(d);
    setTo(d);
  };

  const filters = (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="btn-primary px-3 py-2 text-sm"
          onClick={setToday}
        >
          Сегодня
        </button>
        <label className="text-[11px] text-slate-500">
          С
          <input
            type="date"
            className="input mt-0.5 block h-9 py-1 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-[11px] text-slate-500">
          По
          <input
            type="date"
            className="input mt-0.5 block h-9 py-1 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {!fixedKind && (
          <label className="text-[11px] text-slate-500">
            Вид
            <select
              className="input mt-0.5 block h-9 py-1 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="ALL">Все</option>
              <option value="GROUP">ГП</option>
              <option value="PT">ПТ</option>
              <option value="SPA">SPA</option>
              <option value="SOLARIUM">Солярий</option>
            </select>
          </label>
        )}
        <label className="text-[11px] text-slate-500">
          Статус
          <select
            className="input mt-0.5 block h-9 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Все</option>
            <option value="SCHEDULED">Запланировано</option>
            <option value="COMPLETED">Выполнено</option>
            <option value="CANCELLED">Отменено</option>
          </select>
        </label>
        {(kind === 'PT' ||
          kind === 'SPA' ||
          kind === 'SOLARIUM' ||
          kind === 'ALL' ||
          fixedKind) && (
          <label className="text-[11px] text-slate-500">
            Оплата
            <select
              className="input mt-0.5 block h-9 py-1 text-sm"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              <option value="ALL">Все</option>
              <option value="PAID">Оплачено</option>
              <option value="DEBT">Нет оплаты</option>
            </select>
          </label>
        )}
        <label className="mb-1 flex h-9 items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(e) => setNeedsReview(e.target.checked)}
          />
          На проверке
        </label>
        <button
          type="button"
          className="btn-secondary h-9 px-3 text-sm"
          onClick={load}
        >
          Обновить
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>
      {filters}
      {message && <p className="text-sm text-fitgo-300">{message}</p>}
      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-slate-400">Нет записей за период</p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800">
          {items.map((item) => {
            const tag = payTagLabelRu(item.payTag);
            const meta =
              item.kind === 'GROUP'
                ? `${item.performerName} · ${item.attendeeCount ?? 0} чел.`
                : `${item.clientName ?? '—'} · ${item.performerName}${
                    item.payment ? ` · ${paymentLabelRu(item.payment)}` : ''
                  }${
                    item.priceMinor != null && item.source === 'SALE'
                      ? ` · ${(item.priceMinor / 100).toFixed(2)}`
                      : ''
                  }`;
            return (
              <li key={item.sessionKey}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-900/70"
                  onClick={() => openDetail(item.sessionKey)}
                >
                  <span className="w-[7.5rem] shrink-0 text-xs text-slate-500">
                    {formatDateTime(item.startAt)}
                  </span>
                  <span className="w-8 shrink-0 text-[11px] font-medium uppercase text-slate-400">
                    {kindRu(item.kind)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">
                    {item.title}
                    <span className="text-slate-500"> · {meta}</span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
                    {statusRu(item.status)}
                  </span>
                  {tag ? (
                    <span
                      className={
                        item.payTag === 'SALE'
                          ? 'shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300'
                          : 'shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300'
                      }
                    >
                      {tag}
                    </span>
                  ) : null}
                  {item.payment === 'DEBT' && (
                    <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">
                      нет оплаты
                    </span>
                  )}
                  {item.source === 'FITGO' && (
                    <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                      нет в 1С
                    </span>
                  )}
                  {item.needsReview && (
                    <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">
                      проверка
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
            {detailLoading || !selected ? (
              <p className="text-slate-400">Загрузка…</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">
                      {kindRu(selected.kind)} · {statusRu(selected.status)}
                      {selected.number ? ` · № ${selected.number}` : ''}
                      {selected.payTag
                        ? ` · ${payTagLabelRu(selected.payTag)}`
                        : ''}
                    </p>
                    <h2 className="truncate text-lg font-semibold">
                      {selected.title}
                    </h2>
                    <p className="text-sm text-slate-400">
                      {formatDateTime(selected.startAt)}
                      {selected.endAt
                        ? ` – ${formatDateTime(selected.endAt)}`
                        : ''}
                      {selected.roomTitle ? ` · ${selected.roomTitle}` : ''}
                    </p>
                    <p className="text-sm text-slate-400">
                      {selected.performerName}
                      {selected.kind === 'GROUP'
                        ? ` · ${selected.attendeeCount ?? 0} чел.`
                        : ` · ${selected.clientName ?? '—'}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary shrink-0 text-sm"
                    onClick={() => setSelected(null)}
                  >
                    Закрыть
                  </button>
                </div>
                {selected.source === 'FITGO' && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    Ещё нет в 1С — в ЗП не входит.
                    {selected.fitgoBookedAt
                      ? ` Запись создана ${formatDateTime(selected.fitgoBookedAt)}.`
                      : ''}
                  </p>
                )}
                {selected.source === 'SALE' && selected.payment === 'PAID' && (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    Разовая ПТ из строки продажи 1С (исполнитель + сумма). В ЗП:
                    сумма × % из карточки мотивации ПТ.
                  </p>
                )}
                {selected.source === 'SALE' && selected.payment === 'DEBT' && (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    Нет оплаты — в ЗП не входит, пока продажа не оплачена в 1С.
                  </p>
                )}
                {selected.kind !== 'GROUP' && (
                  <p
                    className={
                      selected.payment === 'DEBT'
                        ? 'text-sm font-medium text-rose-300'
                        : 'text-sm text-slate-300'
                    }
                  >
                    {paymentLabelRu(selected.payment)}
                    {selected.payTag
                      ? ` · ${payTagLabelRu(selected.payTag)}`
                      : ''}
                    {selected.priceMinor != null
                      ? ` · ${(selected.priceMinor / 100).toFixed(2)} BYN`
                      : ''}
                  </p>
                )}
                {selected.kind === 'GROUP' && selected.members.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Состав ({selected.attendeeCount ?? 0} пришли)
                    </p>
                    <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 text-sm">
                      {selected.members.map((m) => (
                        <li
                          key={m.externalId}
                          className="flex items-baseline gap-2 border-b border-slate-900 px-2 py-1 last:border-0"
                        >
                          <span className="w-14 shrink-0 text-[11px] text-slate-500">
                            {m.attendance === 'ATTENDED'
                              ? 'был'
                              : m.attendance === 'NO_SHOW'
                                ? 'не пришёл'
                                : m.attendance === 'CANCELLED'
                                  ? 'отмена'
                                  : 'ожид.'}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {m.clientName}
                            {m.paymentBasis ? (
                              <span className="text-slate-500">
                                {' '}
                                · {m.paymentBasis}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.remark && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                    <p className="font-medium text-rose-200">На проверке</p>
                    <p className="mt-1 text-slate-300">
                      {selected.remark.staffName}: {selected.remark.staffComment}
                    </p>
                  </div>
                )}
                {!selected.remark && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Замечание снимает занятие с ЗП до ответа администратора
                    </p>
                    <textarea
                      className="input min-h-[4rem] w-full text-sm"
                      placeholder="Комментарий к занятию"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-secondary w-full text-sm"
                      onClick={submitRemark}
                      disabled={!comment.trim()}
                    >
                      Отправить на проверку
                    </button>
                  </div>
                )}
                {canResolve &&
                  selected.remark?.status === 'OPEN' &&
                  api.resolveRemark && (
                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      <textarea
                        className="input min-h-[4rem] w-full text-sm"
                        placeholder="Ответ администратора"
                        value={adminComment}
                        onChange={(e) => setAdminComment(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary w-full text-sm"
                        onClick={resolve}
                        disabled={!adminComment.trim()}
                      >
                        Отработано
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
