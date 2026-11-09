'use client';

import type {
  BookingControlDetail,
  PersonalTrainingSessionDetail,
} from '@fitgo/shared-types';
import { fitgoSessionKey } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function approvalNoteActionRu(action: string): string {
  if (action === 'RETURN') return 'возврат';
  return 'подтверждение';
}

export function SessionLifecycleStrip({
  session,
  dirty,
  draftCompleted,
}: {
  session: PersonalTrainingSessionDetail;
  dirty: boolean;
  draftCompleted: boolean;
}) {
  const confirmed = Boolean(session.trainerCompletedAt);
  const personal = session.ptFlow === 'PERSONAL';
  const clubControl = Boolean(session.ptControlApplies);

  let title = 'Подготовка';
  let body = 'Можно править лист.';

  if (!confirmed && dirty) {
    title = 'Не сохранено';
    body = 'Сохраните лист перед подтверждением.';
  } else if (!confirmed && draftCompleted) {
    title = 'Готово к подтверждению';
    body = clubControl
      ? 'Подтверждение отправит запись администратору.'
      : personal
        ? 'Подтверждение спишет пакет или зафиксирует долг.'
        : 'Можно подтвердить проведение.';
  } else if (!confirmed) {
    title = 'Подготовка';
    body = 'Заполните и сохраните лист.';
  } else {
    title = 'Проведение подтверждено';
    if (clubControl) {
      if (session.approvalPhase === 'PENDING_ADMIN') {
        body = 'Ждём администратора.';
      } else if (session.linkedDocExternalId) {
        body = 'Документ привязан.';
      } else if (session.approvalPhase === 'APPROVED') {
        body = 'Администратор подтвердил.';
      } else {
        body = 'Ждём документ.';
      }
    } else if (personal) {
      body = session.ledgerSettledAt
        ? 'Списание зафиксировано.'
        : 'Списание не завершено — можно повторить.';
    } else {
      body = '';
    }
  }

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {title}
      </p>
      {body ? (
        <p className="mt-1 text-sm leading-snug text-slate-300">{body}</p>
      ) : null}
    </div>
  );
}

export function SessionControlFollowUp({
  bookingId,
  session,
  onSessionRefresh,
}: {
  bookingId: string;
  session: PersonalTrainingSessionDetail;
  onSessionRefresh: () => Promise<void>;
}) {
  const sessionKey = fitgoSessionKey('PT', bookingId);
  const [detail, setDetail] = useState<BookingControlDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [remarkText, setRemarkText] = useState('');
  const [reviseComment, setReviseComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadDetail = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const data = await api.bookingControlDetail(token, 'trainer', sessionKey);
      setDetail(data);
      setLoadError('');
    } catch (err) {
      setDetail(null);
      setLoadError(
        err instanceof Error ? err.message : 'Не удалось загрузить журнал',
      );
    }
  }, [sessionKey]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, session.trainerCompletedAt, session.approvalPhase]);

  const phase = detail?.approvalPhase ?? session.approvalPhase;
  const canReviseUpdate = phase === 'PENDING_ADMIN';
  const canReviseRereview = phase === 'APPROVED';
  const openRemark = detail?.remark?.status === 'OPEN' ? detail.remark : null;
  const notes = detail?.approvalNotes ?? [];

  const submitRemark = async () => {
    const token = getToken();
    if (!token || !remarkText.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await api.bookingControlRemark(token, 'trainer', sessionKey, remarkText.trim());
      setRemarkText('');
      setMessage('Замечание отправлено администратору');
      await loadDetail();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Не удалось отправить');
    } finally {
      setBusy(false);
    }
  };

  const revise = async (mode: 'update' | 'rereview') => {
    const token = getToken();
    if (!token) return;
    if (mode === 'rereview' && reviseComment.trim().length < 2) {
      setMessage('Укажите комментарий для повторной проверки');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.bookingControlRevise(
        token,
        'trainer',
        sessionKey,
        mode,
        reviseComment.trim(),
      );
      setReviseComment('');
      setMessage(
        mode === 'rereview'
          ? 'Запись снова ждёт администратора и временно не в ЗП'
          : 'Изменения сохранены для проверки администратора',
      );
      await loadDetail();
      await onSessionRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Не удалось обновить');
    } finally {
      setBusy(false);
    }
  };

  if (!session.trainerCompletedAt && !session.ptControlApplies) {
    return null;
  }

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="font-semibold">Контроль и история</h3>
        <p className="mt-1 text-xs text-slate-500">
          Те же действия, что в журнале занятий. Посещение ГП в 1С здесь не
          ставится.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-amber-300/90">{loadError}</p>
      ) : null}

      {openRemark ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
          <p className="font-medium text-rose-200">На проверке</p>
          <p className="mt-1 text-slate-300">
            {openRemark.staffName}: {openRemark.staffComment}
          </p>
          <p className="mt-1 text-xs text-rose-200/80">
            Замечание снимает занятие с ЗП до ответа администратора
          </p>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs text-slate-400">
          {notes
            .slice()
            .reverse()
            .map((n, i) => (
              <li key={`${n.createdAt}-${i}`}>
                <span className="text-slate-500">
                  {formatDateTime(n.createdAt)} · {n.authorName} ·{' '}
                  {approvalNoteActionRu(n.action)}:{' '}
                </span>
                <span className="text-slate-300">{n.text}</span>
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">История подтверждений пока пуста</p>
      )}

      {(canReviseUpdate || canReviseRereview) && (
        <div className="space-y-2">
          <textarea
            className="input min-h-[3rem] w-full text-sm"
            placeholder={
              canReviseRereview
                ? 'Комментарий для администратора (обязательно)'
                : 'Комментарий (необязательно)'
            }
            value={reviseComment}
            onChange={(e) => setReviseComment(e.target.value)}
          />
          {canReviseUpdate ? (
            <button
              type="button"
              className="btn-secondary w-full text-sm"
              disabled={busy}
              onClick={() => void revise('update')}
            >
              Сохранить изменения для админа
            </button>
          ) : null}
          {canReviseRereview ? (
            <>
              <button
                type="button"
                className="btn-primary w-full text-sm"
                disabled={busy || reviseComment.trim().length < 2}
                onClick={() => void revise('rereview')}
              >
                Запросить повторную проверку
              </button>
              <p className="text-[11px] text-amber-200/80">
                Запись снова ждёт администратора и временно не в ЗП
              </p>
            </>
          ) : null}
        </div>
      )}

      {!openRemark ? (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-500">
            Замечание снимает занятие с ЗП до ответа администратора
          </p>
          <textarea
            className="input min-h-[4rem] w-full text-sm"
            placeholder="Комментарий к занятию для администратора"
            value={remarkText}
            onChange={(e) => setRemarkText(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary w-full text-sm"
            disabled={busy || !remarkText.trim()}
            onClick={() => void submitRemark()}
          >
            Отправить на проверку
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="text-sm text-fitgo-400 text-forma-400">{message}</p>
      ) : null}
    </div>
  );
}
