'use client';

import {
  paymentLabelRu,
  type BookingControlDetail,
  type BookingControlKind,
  type BookingControlListItem,
  type BookingControlStatus,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  return 'SPA';
}

export function BookingControlPanel({
  api,
  canResolve = false,
  fixedKind,
  title = 'Контроль записей',
  subtitle = 'Занятия из 1С. Запись FitGO без документа 1С — отдельно, в ЗП не идёт.',
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

  const filters = useMemo(
    () => (
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-slate-400">
          С
          <input
            type="date"
            className="input mt-1 block"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-400">
          По
          <input
            type="date"
            className="input mt-1 block"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {!fixedKind && (
          <label className="text-xs text-slate-400">
            Вид
            <select
              className="input mt-1 block"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="ALL">Все</option>
              <option value="GROUP">ГП</option>
              <option value="PT">ПТ</option>
              <option value="SPA">SPA</option>
            </select>
          </label>
        )}
        <label className="text-xs text-slate-400">
          Статус
          <select
            className="input mt-1 block"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Все</option>
            <option value="SCHEDULED">Запланировано</option>
            <option value="COMPLETED">Выполнено</option>
            <option value="CANCELLED">Отменено</option>
          </select>
        </label>
        {(kind === 'PT' || kind === 'SPA' || kind === 'ALL' || fixedKind) && (
          <label className="text-xs text-slate-400">
            Оплата
            <select
              className="input mt-1 block"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              <option value="ALL">Все</option>
              <option value="PAID">Оплачено</option>
              <option value="DEBT">Долг</option>
            </select>
          </label>
        )}
        <label className="flex items-end gap-2 pb-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(e) => setNeedsReview(e.target.checked)}
          />
          Только на проверке
        </label>
        <button type="button" className="btn-secondary self-end" onClick={load}>
          Обновить
        </button>
      </div>
    ),
    [from, to, kind, status, payment, needsReview, fixedKind, load],
  );

  return (
    <div className="space-y-4">
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
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.sessionKey}>
              <button
                type="button"
                className="card w-full space-y-1 text-left transition hover:border-slate-600"
                onClick={() => openDetail(item.sessionKey)}
              >
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-slate-800 px-2 py-0.5">
                    {kindRu(item.kind)}
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5">
                    {statusRu(item.status)}
                  </span>
                  {item.source === 'FITGO' && (
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">
                      ещё нет в 1С
                    </span>
                  )}
                  {item.needsReview && (
                    <span className="rounded bg-rose-500/20 px-2 py-0.5 text-rose-300">
                      на проверке
                    </span>
                  )}
                  {item.kind !== 'GROUP' && item.payment && (
                    <span className="rounded bg-slate-800 px-2 py-0.5">
                      {paymentLabelRu(item.payment)}
                    </span>
                  )}
                </div>
                <p className="font-medium text-white">{item.title}</p>
                <p className="text-sm text-slate-400">
                  {formatDateTime(item.startAt)}
                  {item.kind === 'GROUP'
                    ? ` · ${item.performerName} · ${item.attendeeCount ?? 0} чел.`
                    : ` · ${item.clientName ?? '—'} · ${item.performerName}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
            {detailLoading || !selected ? (
              <p className="text-slate-400">Загрузка…</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">
                      {kindRu(selected.kind)} · {statusRu(selected.status)}
                      {selected.number ? ` · № ${selected.number}` : ''}
                    </p>
                    <h2 className="text-lg font-semibold">{selected.title}</h2>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => setSelected(null)}
                  >
                    Закрыть
                  </button>
                </div>
                <p className="text-sm text-slate-400">
                  {formatDateTime(selected.startAt)}
                  {selected.endAt
                    ? ` – ${formatDateTime(selected.endAt)}`
                    : ''}
                </p>
                <p className="text-sm text-slate-300">
                  Специалист: {selected.performerName}
                </p>
                {selected.roomTitle && (
                  <p className="text-sm text-slate-400">
                    Зал: {selected.roomTitle}
                  </p>
                )}
                {selected.source === 'FITGO' && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    Ещё нет в 1С — в ЗП не входит.
                    {selected.fitgoBookedAt
                      ? ` Запись создана ${formatDateTime(selected.fitgoBookedAt)}.`
                      : ''}
                  </p>
                )}
                {selected.kind !== 'GROUP' && (
                  <p className="text-sm">
                    Клиент: {selected.clientName ?? '—'} ·{' '}
                    {paymentLabelRu(selected.payment)}
                    {selected.priceMinor != null
                      ? ` · ${(selected.priceMinor / 100).toFixed(2)} BYN`
                      : ''}
                  </p>
                )}
                {selected.kind === 'GROUP' && selected.members.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase text-slate-500">
                      Состав ({selected.attendeeCount ?? 0} пришли)
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                      {selected.members.map((m) => (
                        <li
                          key={m.externalId}
                          className="flex justify-between gap-2 border-b border-slate-900 py-1"
                        >
                          <span>{m.clientName}</span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {m.attendance === 'ATTENDED'
                              ? 'был'
                              : m.attendance === 'NO_SHOW'
                                ? 'не пришёл'
                                : m.attendance === 'CANCELLED'
                                  ? 'отмена'
                                  : 'ожид.'}
                            {m.paymentBasis ? ` · ${m.paymentBasis}` : ''}
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
                {canResolve && selected.remark?.status === 'OPEN' && api.resolveRemark && (
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
