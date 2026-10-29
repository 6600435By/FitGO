'use client';

import type { AdminInboxItem } from '@fitgo/shared-types';
import {
  ADMIN_INBOX_KIND_SHORT_LABEL,
  resolveAdminInboxPhone,
} from '@fitgo/shared-types';
import { Phone } from 'lucide-react';
import { phoneTelHref } from '@/lib/phone';
import { TaskActionsMenu, type TaskMenuAction } from './task-actions-menu';

function bucketBadge(bucket: AdminInboxItem['bucket']) {
  if (bucket === 'overdue') {
    return (
      <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">
        Просрочено
      </span>
    );
  }
  if (bucket === 'today') {
    return (
      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
        Сегодня
      </span>
    );
  }
  if (bucket === 'waiting') {
    return (
      <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300">
        Ждёт
      </span>
    );
  }
  return null;
}

function ownerLabel(item: AdminInboxItem) {
  if (item.owner === 'mine') return 'Моя';
  if (item.owner === 'pool') return 'Общая';
  if (item.assignee) {
    return `${item.assignee.firstName}`;
  }
  return 'Чужая';
}

function primaryLabel(item: AdminInboxItem) {
  switch (item.primaryAction) {
    case 'call':
      return 'Исход после звонка';
    case 'open_renewal':
      return 'Открыть воронку';
    case 'open_session':
      return 'Открыть карточку';
    case 'confirm':
      return 'Подтвердить';
    case 'complete':
      return item.kind === 'money' || item.visitToday ? 'Открыть' : 'Исход';
    default:
      return 'Исход';
  }
}

export function TaskCard({
  item,
  selected,
  onSelect,
  onPrimary,
  onMenu,
}: {
  item: AdminInboxItem;
  selected?: boolean;
  onSelect: () => void;
  onPrimary: () => void;
  onMenu: (action: TaskMenuAction) => void;
}) {
  const phone = resolveAdminInboxPhone(item);
  const multiClient = (item.task?.confirmClients?.length ?? 0) > 1;
  const tel = multiClient ? null : phoneTelHref(phone);

  return (
    <li
      data-task-id={item.id}
      className={`card space-y-2 !p-3 transition ${
        selected ? 'border-fitgo-500/50' : 'hover:border-fitgo-500/30'
      }`}
    >
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {ADMIN_INBOX_KIND_SHORT_LABEL[item.kind]}
          </span>
          {item.kind === 'money' || item.kind === 'staff' ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
              Долг
            </span>
          ) : (
            bucketBadge(item.bucket)
          )}
          {(item.reworkCount ?? 0) > 0 && item.bucket !== 'done' ? (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
              Доработка
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-medium text-slate-100">{item.title}</p>
        {item.subtitle ? (
          <p className="mt-0.5 text-sm text-slate-400">{item.subtitle}</p>
        ) : null}
        {phone && !multiClient ? (
          <p className="mt-0.5 text-xs tabular-nums text-slate-500">{phone}</p>
        ) : null}
        <p className="mt-1 text-xs text-slate-500">
          {ownerLabel(item)}
          {item.reworkComment ? ` · ${item.reworkComment}` : ''}
        </p>
      </button>

      <div className="flex items-stretch gap-2">
        {tel ? (
          <a
            href={tel}
            aria-label={`Позвонить ${phone}`}
            title="Позвонить"
            className="btn-primary inline-flex h-9 w-9 shrink-0 items-center justify-center !rounded-xl !p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Phone className="h-4 w-4" />
          </a>
        ) : null}
        {item.primaryAction === 'call' && tel ? (
          <button
            type="button"
            className="btn-secondary flex flex-1 items-center justify-center text-center text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onPrimary();
            }}
          >
            {primaryLabel(item)}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary flex-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onPrimary();
            }}
          >
            {primaryLabel(item)}
          </button>
        )}
        <TaskActionsMenu
          canClaim={item.owner === 'pool' && !item.virtual}
          onAction={onMenu}
        />
      </div>
    </li>
  );
}
