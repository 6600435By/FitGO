'use client';

import { useEffect, useRef, useState } from 'react';

export type TaskMenuAction =
  | 'claim'
  | 'snooze_evening'
  | 'snooze_tomorrow'
  | 'snooze_3d'
  | 'comment'
  | 'block'
  | 'history'
  | 'outcome';

export function TaskActionsMenu({
  canClaim,
  onAction,
}: {
  canClaim?: boolean;
  onAction: (action: TaskMenuAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const items: { id: TaskMenuAction; label: string; hide?: boolean }[] = [
    { id: 'outcome', label: 'Исход…' },
    { id: 'claim', label: 'Взять себе', hide: !canClaim },
    { id: 'snooze_evening', label: 'Отложить: сегодня вечером' },
    { id: 'snooze_tomorrow', label: 'Отложить: завтра' },
    { id: 'snooze_3d', label: 'Отложить: через 3 дня' },
    { id: 'comment', label: 'Комментарий' },
    { id: 'block', label: 'Не могу выполнить' },
    { id: 'history', label: 'История' },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-secondary !px-2.5 !py-2 text-xs"
        aria-label="Ещё действия"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 min-w-[11rem] rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-lg">
          {items
            .filter((i) => !i.hide)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onAction(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
