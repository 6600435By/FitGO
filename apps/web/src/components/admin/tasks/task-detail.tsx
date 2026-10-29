'use client';

import type {
  AdminDebtLine,
  AdminInboxItem,
  AdminTaskEventItem,
} from '@fitgo/shared-types';
import {
  AdminTaskStatus,
  resolveAdminInboxPhone,
} from '@fitgo/shared-types';
import { Phone } from 'lucide-react';
import { BirthdayCallScript } from '@/components/admin/birthday-call-script';
import { phoneTelHref } from '@/lib/phone';
import { formatDate, formatDateTime } from '@/lib/utils';

function resolveSessionKey(item: AdminInboxItem): string | undefined {
  const fromPending = item.pending?.sessionKey?.trim();
  if (fromPending) return fromPending;
  const fromTask = item.task?.sessionKey?.trim();
  return fromTask || undefined;
}

export function TaskDetail({
  item,
  debtLines,
  debtLoading,
  events,
  eventsLoading,
  commentDraft,
  onCommentDraft,
  onComment,
  onConfirmClient,
  onExcludeClient,
  onOpenSession,
  onLoadDebt,
  onClose,
  onPrimary,
  onOutcome,
}: {
  item: AdminInboxItem;
  debtLines?: AdminDebtLine[];
  debtLoading?: boolean;
  events?: AdminTaskEventItem[];
  eventsLoading?: boolean;
  commentDraft: string;
  onCommentDraft: (v: string) => void;
  onComment: () => void;
  onConfirmClient?: (
    clientExternalId: string,
    confirmed: boolean,
  ) => void;
  onExcludeClient?: (clientExternalId: string, clientName: string) => void;
  onOpenSession?: (sessionKey: string) => void;
  onLoadDebt?: () => void;
  onClose?: () => void;
  onPrimary: () => void;
  onOutcome: () => void;
}) {
  const task = item.task;
  const phone = resolveAdminInboxPhone(item);
  const tel = phoneTelHref(phone);
  const isDebt =
    item.source === 'CLIENT_DEBT' ||
    item.source === 'STAFF_DEBT' ||
    item.source === 'DEBT_OVERDUE' ||
    item.source === 'INSTALLMENT_PAYMENT';
  const isBirthday = item.source === 'BIRTHDAY';
  const isConfirm = item.source === 'BOOKING_CONFIRM';
  const clients =
    task && 'confirmClients' in task
      ? (
          task as {
            confirmClients?: Array<{
              externalId: string;
              clientName: string;
              phone?: string;
              confirmed: boolean;
              clientNote?: string;
              visitNote?: string;
            }>;
          }
        ).confirmClients
      : undefined;
  const multiClient = (clients?.length ?? 0) > 1;
  const showSharedCall = Boolean(tel) && !multiClient;
  const sessionKey = resolveSessionKey(item);
  const description = task?.description?.trim() || '';
  const performerName =
    item.performerName ??
    (task && 'performerName' in task
      ? (task as { performerName?: string }).performerName
      : undefined);

  const openSession = () => {
    if (sessionKey) onOpenSession?.(sessionKey);
  };

  return (
    <div className="card space-y-3 !p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{item.title}</p>
          {!isConfirm && item.subtitle ? (
            <p className="text-sm text-slate-400">{item.subtitle}</p>
          ) : null}
          {performerName &&
          !(item.subtitle ?? '').includes(performerName) &&
          !(description.includes(performerName)) ? (
            <p className="mt-0.5 text-xs text-slate-500">
              Специалист: {performerName}
            </p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className="btn-secondary text-xs lg:hidden"
            onClick={onClose}
          >
            Закрыть
          </button>
        ) : null}
      </div>

      {(item.reworkCount ?? 0) > 0 && item.bucket !== 'done' ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-xs font-medium text-amber-300">Доработка</p>
          {item.reworkComment ? (
            <p className="mt-1 text-sm text-amber-100/90">{item.reworkComment}</p>
          ) : null}
        </div>
      ) : null}

      {description ? (
        sessionKey && onOpenSession ? (
          <button
            type="button"
            className="block w-full whitespace-pre-line text-left text-sm text-fitgo-300 underline decoration-fitgo-500/40 underline-offset-2 hover:text-fitgo-200"
            onClick={openSession}
          >
            {description}
          </button>
        ) : (
          <p className="whitespace-pre-line text-sm text-slate-300">
            {description}
          </p>
        )
      ) : sessionKey && onOpenSession && !isConfirm ? (
        <button
          type="button"
          className="text-sm text-fitgo-300 underline decoration-fitgo-500/40 underline-offset-2 hover:text-fitgo-200"
          onClick={openSession}
        >
          Контроль записей
        </button>
      ) : null}

      {isBirthday ? (
        <BirthdayCallScript
          firstName={
            task && 'firstName' in task
              ? (task as { firstName?: string }).firstName
              : undefined
          }
          middleName={
            task && 'middleName' in task
              ? (task as { middleName?: string }).middleName
              : undefined
          }
          title={task?.title}
        />
      ) : null}

      {showSharedCall ? (
        <a
          href={tel}
          className="btn-primary flex w-full items-center justify-center gap-2 text-xs"
        >
          <Phone className="h-3.5 w-3.5" />
          Позвонить {phone}
        </a>
      ) : null}

      {isDebt ? (
        <div className="space-y-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onLoadDebt}
          >
            {debtLines ? 'Обновить строки' : 'Показать продажи'}
          </button>
          {debtLoading ? (
            <p className="text-xs text-slate-500">Загрузка…</p>
          ) : debtLines && debtLines.length === 0 ? (
            <p className="text-xs text-slate-500">Нет неоплаченных продаж</p>
          ) : debtLines ? (
            <ul className="space-y-1 text-sm">
              {debtLines.map((line) => (
                <li
                  key={line.id}
                  className="flex justify-between gap-2 text-slate-300"
                >
                  <span>
                    {formatDate(line.soldAt)} · {line.productName}
                    {line.employeeName ? (
                      <span className="text-slate-500">
                        {' '}
                        · {line.employeeName}
                      </span>
                    ) : null}
                  </span>
                  <span>{line.amount.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {isConfirm && clients && clients.length > 0 ? (
        <ul className="space-y-2">
          {clients.map((client) => {
            const clientTel = phoneTelHref(
              client.phone || (multiClient ? undefined : phone),
            );
            return (
              <li
                key={client.externalId}
                className={`rounded-lg border px-3 py-2 ${
                  client.confirmed
                    ? 'border-emerald-800/60 bg-emerald-950/30'
                    : 'border-slate-800 bg-slate-950/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{client.clientName}</p>
                    {(client.phone ||
                      (!multiClient && !client.confirmed && phone)) ? (
                      <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                        {client.phone || phone}
                      </p>
                    ) : null}
                    {client.clientNote ? (
                      <p className="text-[11px] text-amber-200/85">
                        Клиент: {client.clientNote}
                      </p>
                    ) : null}
                    {client.visitNote ? (
                      <p className="text-[11px] text-slate-300/90">
                        Запись: {client.visitNote}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {!client.confirmed && clientTel ? (
                      <a
                        href={clientTel}
                        aria-label="Позвонить"
                        title="Позвонить"
                        className="btn-primary inline-flex h-8 w-8 items-center justify-center !rounded-full !p-0"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className={
                        client.confirmed
                          ? 'btn-secondary text-[11px]'
                          : 'btn-primary text-[11px]'
                      }
                      onClick={() =>
                        onConfirmClient?.(
                          client.externalId,
                          !client.confirmed,
                        )
                      }
                    >
                      {client.confirmed ? 'Снять' : 'Проверил'}
                    </button>
                    {!client.confirmed && onExcludeClient ? (
                      <button
                        type="button"
                        className="btn-secondary text-[11px] text-rose-200"
                        onClick={() =>
                          onExcludeClient(
                            client.externalId,
                            client.clientName,
                          )
                        }
                      >
                        Исключить
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {item.bucket !== 'done' &&
      item.status !== AdminTaskStatus.DONE &&
      item.status !== AdminTaskStatus.CANCELLED ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={onPrimary}
          >
            Главное действие
          </button>
          {!item.virtual ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={onOutcome}
            >
              Исход…
            </button>
          ) : null}
        </div>
      ) : null}

      {!item.virtual ? (
        <div className="flex gap-2">
          <input
            className="input flex-1 text-sm"
            placeholder="Комментарий…"
            value={commentDraft}
            onChange={(e) => onCommentDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onComment}
          >
            Записать
          </button>
        </div>
      ) : null}

      <div className="space-y-1 border-t border-slate-800 pt-3">
        <p className="text-xs font-medium text-slate-400">История</p>
        {eventsLoading ? (
          <p className="text-xs text-slate-500">Загрузка…</p>
        ) : !events?.length ? (
          <p className="text-xs text-slate-500">Пока пусто</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-slate-400">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-slate-500">
                  {formatDateTime(e.createdAt)}
                </span>
                {e.actorName ? ` · ${e.actorName}` : ''}
                {e.comment ? ` — ${e.comment}` : ''}
                {e.stage ? ` [${e.stage}]` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
