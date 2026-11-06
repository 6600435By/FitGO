'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { cn } from './cn';

export type ResponsiveSheetVariant = 'auto' | 'sheet' | 'dialog' | 'side';

function useIsDesktop(minWidth = 768) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [minWidth]);
  return desktop;
}

/**
 * Phone: bottom sheet (vaul). Desktop: centered dialog (short forms)
 * or right side panel (detail cards). Esc / overlay closes.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  children,
  title,
  description,
  className,
  variant = 'auto',
  desktop = 'dialog',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
  variant?: ResponsiveSheetVariant;
  /** When variant=auto: dialog (centered) or side (right panel) on desktop */
  desktop?: 'dialog' | 'side';
}) {
  const isDesktop = useIsDesktop(768);
  const mode =
    variant === 'auto'
      ? isDesktop
        ? desktop
        : 'sheet'
      : variant === 'sheet'
        ? 'sheet'
        : variant;

  useEffect(() => {
    if (!open || mode === 'sheet') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, onOpenChange]);

  if (mode === 'sheet') {
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
            <SheetHeader
              title={title}
              description={description}
              onClose={() => onOpenChange(false)}
              drawer
            />
            <div className="overflow-y-auto px-5 pb-5 pt-2">{children}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  if (!open) return null;

  const side = mode === 'side';

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        aria-label="Закрыть"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'forma-sheet-title' : undefined}
        className={cn(
          'relative z-10 flex max-h-[min(92dvh,880px)] flex-col border border-white/10 bg-ink-elevated shadow-forma-card outline-none',
          side
            ? 'ml-auto h-full max-h-none w-full max-w-md rounded-none border-y-0 border-r-0 sm:rounded-l-[1.5rem]'
            : 'm-auto w-full max-w-lg rounded-[1.5rem]',
          className,
        )}
      >
        <SheetHeader
          title={title}
          description={description}
          onClose={() => onOpenChange(false)}
        />
        <div className="overflow-y-auto px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>
  );
}

function SheetHeader({
  title,
  description,
  onClose,
  drawer,
}: {
  title?: string;
  description?: string;
  onClose: () => void;
  drawer?: boolean;
}) {
  if (!title && !description) {
    return drawer ? null : (
      <div className="flex justify-end px-4 pt-4">
        <CloseBtn onClose={onClose} />
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
      <div className="min-w-0">
        {title ? (
          drawer ? (
            <Drawer.Title
              id="forma-sheet-title"
              className="font-display text-xl font-semibold text-white"
            >
              {title}
            </Drawer.Title>
          ) : (
            <h2
              id="forma-sheet-title"
              className="font-display text-xl font-semibold text-white"
            >
              {title}
            </h2>
          )
        ) : drawer ? (
          <Drawer.Title className="sr-only">Панель</Drawer.Title>
        ) : null}
        {description ? (
          drawer ? (
            <Drawer.Description className="mt-1 text-sm text-zinc-400">
              {description}
            </Drawer.Description>
          ) : (
            <p className="mt-1 text-sm text-zinc-400">{description}</p>
          )
        ) : null}
      </div>
      <CloseBtn onClose={onClose} />
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="shrink-0 rounded-xl border border-white/10 p-2 text-zinc-400 touch-manipulation hover:bg-white/[0.06] hover:text-white"
      aria-label="Закрыть"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
