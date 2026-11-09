'use client';

import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { cn } from './cn';

export type ResponsiveSheetVariant = 'auto' | 'sheet' | 'dialog' | 'side';

function useIsDesktop(minWidth = 768) {
  const [desktop, setDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
  });
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [minWidth]);
  return desktop;
}

/** Visible viewport height (shrinks with mobile keyboard). */
function useVisualViewportHeight(active: boolean) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const sync = () => {
      const next = vv?.height ?? window.innerHeight;
      setHeight(Math.round(next));
    };
    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [active]);
  return height;
}

/** Keep focused inputs visible inside the sheet scroll area (no page jump). */
function useKeepFocusedFieldVisible(
  scrollRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const root = scrollRef.current;
    if (!root) return;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.tagName !== 'INPUT' &&
        target.tagName !== 'TEXTAREA' &&
        target.tagName !== 'SELECT' &&
        !target.isContentEditable
      ) {
        return;
      }
      requestAnimationFrame(() => {
        target.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'smooth',
        });
      });
    };

    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, [active, scrollRef]);
}

/**
 * Phone: bottom sheet (vaul). Desktop: centered dialog (short forms)
 * or right side panel (detail cards). Esc / overlay closes.
 *
 * Mobile keyboard: repositionInputs=false + visualViewport max-height so
 * fields stay in the sheet instead of jumping off-screen.
 *
 * Desktop/secondary display: dialog is constrained to the visible padded
 * viewport so the sticky close control never sits above the window.
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const vvHeight = useVisualViewportHeight(open && mode === 'sheet');
  useKeepFocusedFieldVisible(scrollRef, open);

  useEffect(() => {
    if (!open || mode === 'sheet') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, onOpenChange]);

  if (mode === 'sheet') {
    const maxH =
      vvHeight != null
        ? Math.max(240, Math.min(vvHeight - 8, vvHeight * 0.96))
        : undefined;

    return (
      <Drawer.Root
        open={open}
        onOpenChange={onOpenChange}
        shouldScaleBackground={false}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
          <Drawer.Content
            className={cn(
              'forma-theme fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-w-lg flex-col rounded-t-[1.75rem] border border-white/10 bg-ink-elevated text-zinc-100 outline-none',
              'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
              className,
            )}
            style={
              maxH != null
                ? { maxHeight: maxH, height: 'auto' }
                : { maxHeight: 'min(92dvh, 100dvh)' }
            }
          >
            <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-white/20" />
            <SheetHeader
              title={title}
              description={description}
              onClose={() => onOpenChange(false)}
              drawer
            />
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {children}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  if (!open) return null;

  const side = mode === 'side';

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        side
          ? 'justify-end'
          : 'items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]',
      )}
      role="presentation"
    >
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
          'forma-theme relative z-10 flex flex-col overflow-hidden border border-white/10 bg-ink-elevated text-zinc-100 shadow-forma-card outline-none',
          side
            ? 'ml-auto h-full max-h-none w-full max-w-md rounded-none border-y-0 border-r-0 sm:rounded-l-[1.5rem]'
            : 'max-h-full w-full max-w-lg rounded-[1.5rem]',
          className,
        )}
      >
        <div className="sticky top-0 z-20 shrink-0 bg-ink-elevated">
          <SheetHeader
            title={title}
            description={description}
            onClose={() => onOpenChange(false)}
          />
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2"
        >
          {children}
        </div>
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
    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-4">
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
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      className="relative z-30 shrink-0 rounded-xl border border-white/10 p-2.5 text-zinc-400 touch-manipulation hover:bg-white/[0.06] hover:text-white"
      aria-label="Закрыть"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
