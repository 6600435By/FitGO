'use client';

import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sheet({
  open,
  onOpenChange,
  children,
  title,
  description,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <Drawer.Content
          className={cn(
            'fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-h-[92dvh] max-w-lg flex-col rounded-t-[1.75rem] border border-white/10 bg-ink-elevated outline-none',
            'pb-[env(safe-area-inset-bottom)]',
            className,
          )}
        >
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-white/20" />
          {(title || description) && (
            <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
              <div className="min-w-0">
                {title ? (
                  <Drawer.Title className="font-display text-xl font-semibold text-white">
                    {title}
                  </Drawer.Title>
                ) : (
                  <Drawer.Title className="sr-only">Панель</Drawer.Title>
                )}
                {description ? (
                  <Drawer.Description className="mt-1 text-sm text-zinc-400">
                    {description}
                  </Drawer.Description>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="shrink-0 rounded-xl border border-white/10 p-2 text-zinc-400 touch-manipulation hover:bg-white/[0.06] hover:text-white"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="overflow-y-auto px-5 pb-5 pt-2">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
