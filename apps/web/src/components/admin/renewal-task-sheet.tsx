'use client';

import {
  RENEWAL_LOST_REASON_LABELS,
  RENEWAL_LOST_REASONS,
  type AdminRenewalTaskDetail,
  type RenewalLostReason,
  type RenewalStage,
} from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'Новый',
  NO_ANSWER: 'Не дозвонились',
  THINKING: 'Думает',
  WILL_RENEW: 'Продлит',
  RENEWED: 'Продлил',
  LOST: 'Не продлевает',
};

function phoneHref(phone?: string) {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:+${digits}` : undefined;
}

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export function RenewalTaskSheet({
  taskId,
  onClose,
  onUpdated,
}: {
  taskId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<AdminRenewalTaskDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [lostReason, setLostReason] = useState<RenewalLostReason | ''>('');
  const [showLost, setShowLost] = useState(false);
  const [showThinkingDate, setShowThinkingDate] = useState(false);
  const [nextActionAt, setNextActionAt] = useState(daysFromNow(3).slice(0, 10));

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .adminTaskDetail(token, taskId)
      .then(setDetail)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, [taskId]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onUpdated();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const apply = (stage: RenewalStage, extra?: { nextActionAt?: string }) =>
    run(async () => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      await api.adminTaskAction(token, taskId, {
        stage,
        comment: comment.trim() || undefined,
        nextActionAt: extra?.nextActionAt,
        lostReason: stage === 'LOST' ? lostReason || undefined : undefined,
      });
      setComment('');
      setShowLost(false);
      setShowThinkingDate(false);
    });

  if (!detail && !error) {
    return (
      <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-black/50">
        <div className="card w-full md:w-[420px] md:h-full rounded-b-none md:rounded-none p-6">
          <p className="text-slate-400">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-black/50">
        <div className="card w-full md:w-[420px] md:h-full rounded-b-none md:rounded-none p-6 space-y-3">
          <p className="text-red-400">{error}</p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  const closed = detail.stage === 'RENEWED' || detail.stage === 'LOST';
  const tel = phoneHref(detail.phone);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-black/50">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div className="relative card w-full max-h-[92vh] overflow-y-auto md:w-[420px] md:max-h-none md:h-full rounded-b-none md:rounded-none space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">Продление абонемента</p>
            <h2 className="text-lg font-semibold">{detail.title.replace(/^Абонемент истекает:\s*/i, '')}</h2>
            <p className="text-sm text-slate-400">
              {detail.membershipName ?? 'Абонемент'}
              {detail.validUntil
                ? ` · до ${formatDate(detail.validUntil)}`
                : ''}
              {detail.daysLeft != null ? ` · ${detail.daysLeft} дн.` : ''}
            </p>
            {detail.termDays != null ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {detail.termDays <= 31
                  ? 'Месячный · окно 7 дн.'
                  : 'Длинный · окно 14 дн.'}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-amber-300/90">
              {STAGE_LABEL[detail.stage ?? 'NEW'] ?? detail.stage}
              {detail.assignee
                ? ` · ${detail.assignee.firstName} ${detail.assignee.lastName}`
                : ' · общая очередь'}
            </p>
          </div>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            ✕
          </button>
        </div>

        {detail.phone ? (
          <a
            href={tel}
            className="btn-primary flex w-full items-center justify-center text-center"
          >
            Позвонить {detail.phone}
          </a>
        ) : (
          <p className="text-sm text-slate-500">Телефон не указан в 1С</p>
        )}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        {!closed ? (
          <>
            {!detail.assignee ? (
              <button
                type="button"
                disabled={busy}
                className="btn-secondary w-full"
                onClick={() =>
                  run(async () => {
                    const token = getToken();
                    if (!token) throw new Error('Нет сессии');
                    await api.adminClaimTask(token, taskId);
                  })
                }
              >
                Взять в работу
              </button>
            ) : null}

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                className="btn-primary text-xs"
                onClick={() => apply('WILL_RENEW')}
              >
                Продлит
              </button>
              <button
                type="button"
                disabled={busy}
                className="btn-secondary text-xs"
                onClick={() => setShowThinkingDate(true)}
              >
                Думает
              </button>
              <button
                type="button"
                disabled={busy}
                className="btn-secondary text-xs"
                onClick={() => setShowLost(true)}
              >
                Не продлевает
              </button>
            </div>
            <p className="text-xs text-slate-500">
              «Продлит» — звонить не нужно, кейс закроется после покупки в 1С.
            </p>

            <button
              type="button"
              disabled={busy}
              className="btn-secondary w-full text-xs"
              onClick={() => apply('NO_ANSWER')}
            >
              Не дозвонился
              {detail.attempts ? ` (${detail.attempts}/2)` : ' (0/2)'}
            </button>

            {showThinkingDate ? (
              <div className="space-y-2 rounded-xl bg-slate-800/50 p-3">
                <p className="text-sm font-medium">Когда перезвонить?</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => apply('THINKING', { nextActionAt: daysFromNow(1) })}
                  >
                    Завтра
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => apply('THINKING', { nextActionAt: daysFromNow(3) })}
                  >
                    Через 3 дня
                  </button>
                  {detail.validUntil ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() =>
                        apply('THINKING', {
                          nextActionAt: new Date(detail.validUntil!).toISOString(),
                        })
                      }
                    >
                      К окончанию
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    className="input date-field flex-1 text-sm"
                    value={nextActionAt}
                    onChange={(e) => setNextActionAt(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={busy}
                    onClick={() =>
                      apply('THINKING', {
                        nextActionAt: new Date(`${nextActionAt}T10:00:00`).toISOString(),
                      })
                    }
                  >
                    ОК
                  </button>
                </div>
              </div>
            ) : null}

            {showLost ? (
              <div className="space-y-2 rounded-xl bg-slate-800/50 p-3">
                <p className="text-sm font-medium">Причина отказа</p>
                <div className="flex flex-wrap gap-2">
                  {RENEWAL_LOST_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      className={
                        lostReason === reason
                          ? 'btn-primary text-xs'
                          : 'btn-secondary text-xs'
                      }
                      onClick={() => setLostReason(reason)}
                    >
                      {RENEWAL_LOST_REASON_LABELS[reason]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy || !lostReason}
                  className="btn-primary w-full text-xs"
                  onClick={() => apply('LOST')}
                >
                  Сохранить отказ
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary w-full text-xs"
                  onClick={() =>
                    run(async () => {
                      const token = getToken();
                      if (!token) throw new Error('Нет сессии');
                      await api.adminTaskAction(token, taskId, {
                        stage: 'LOST',
                        doNotCall: true,
                        comment: comment.trim() || 'Не звонить',
                      });
                    })
                  }
                >
                  Не звонить
                </button>
              </div>
            ) : null}

            <textarea
              className="input min-h-[72px] text-sm"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </>
        ) : (
          <p className="text-sm text-slate-400">
            Кейс закрыт
            {detail.lostReason
              ? `: ${
                  RENEWAL_LOST_REASON_LABELS[
                    detail.lostReason as RenewalLostReason
                  ] ?? detail.lostReason
                }`
              : ''}
          </p>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-slate-300">История</p>
          {detail.events.length === 0 ? (
            <p className="text-xs text-slate-500">Пока пусто</p>
          ) : (
            <ul className="space-y-2">
              {detail.events.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-lg bg-slate-800/40 px-3 py-2 text-xs text-slate-400"
                >
                  <p>
                    <span className="text-slate-200">
                      {STAGE_LABEL[ev.stage ?? ''] ?? ev.stage ?? '—'}
                    </span>
                    {ev.actorName ? ` · ${ev.actorName}` : ''}
                  </p>
                  {ev.comment ? <p className="mt-0.5">{ev.comment}</p> : null}
                  <p className="mt-0.5 text-slate-600">
                    {formatDateTime(ev.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
