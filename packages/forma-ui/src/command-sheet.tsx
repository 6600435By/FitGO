'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from './cn';
import { ResponsiveSheet } from './responsive-sheet';

export type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  keywords?: string;
  onSelect: () => void;
};

/**
 * Cmd/Ctrl+K command palette. Uses ResponsiveSheet (dialog on desktop).
 */
export function CommandSheet({
  open,
  onOpenChange,
  items,
  placeholder = 'Найти действие или клиента…',
  title = 'Команды',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
  title?: string;
}) {
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const hay = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''} ${item.group ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      desktop="dialog"
      className="max-w-xl"
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          autoFocus
          className="input pl-10"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>
      <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-zinc-500">
            Ничего не найдено
          </li>
        ) : (
          filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left touch-manipulation transition hover:bg-white/[0.06]',
                )}
                onClick={() => {
                  item.onSelect();
                  onOpenChange(false);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">
                    {item.label}
                  </span>
                  {item.hint ? (
                    <span className="block truncate text-xs text-zinc-500">
                      {item.hint}
                    </span>
                  ) : null}
                </span>
                {item.group ? (
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-zinc-600">
                    {item.group}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </ResponsiveSheet>
  );
}

export function useCommandPaletteHotkey(
  onOpen: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen, enabled]);
}

export function CommandPaletteTrigger({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'hidden items-center gap-1 rounded-lg border border-white/10 bg-ink-raised px-2 py-1 text-[11px] text-zinc-500 desktop:inline-flex',
        className,
      )}
    >
      {children ?? (
        <>
          <span className="text-zinc-400">⌘</span>K
        </>
      )}
    </kbd>
  );
}
