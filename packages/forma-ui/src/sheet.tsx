'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { cn } from './cn';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const vvHeight = useVisualViewportHeight(open);
  const maxH =
    vvHeight != null
      ? Math.max(240, Math.min(vvHeight - 8, vvHeight * 0.96))
      : undefined;

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <Drawer.Content
          className={cn(
            'fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-w-lg flex-col rounded-t-[1.75rem] border border-white/10 bg-ink-elevated outline-none',
            'pb-[env(safe-area-inset-bottom)]',
            className,
          )}
          style={
            maxH != null
              ? { maxHeight: maxH, height: 'auto' }
              : { maxHeight: '92dvh' }
          }
        >
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-white/20" />
          {(title || description) && (
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-4">
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
