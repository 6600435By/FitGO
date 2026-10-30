'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  clientNote?: string;
  visitNote?: string;
};

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5.2L2.5 13.5v-9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Quiet comment indicator for SPA journal cells.
 * Desktop: hover shows a floating card. Mobile: tap opens the same card
 * without opening the booking edit dialog (stopPropagation).
 */
export function SpaBookingNoteHint({ clientNote, visitNote }: Props) {
  const client = clientNote?.trim();
  const visit = visitNote?.trim();
  const hasAny = Boolean(client || visit);
  const both = Boolean(client && visit);
  const tipId = useId();
  const btnRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const hoverTimer = useRef<number | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const width = 240;
    let left = r.right - width;
    if (left < pad) left = pad;
    if (left + width > window.innerWidth - pad) {
      left = window.innerWidth - pad - width;
    }
    let top = r.bottom + 6;
    if (top + 120 > window.innerHeight - pad) {
      top = Math.max(pad, r.top - 6 - 100);
    }
    setCoords({ top, left });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);

  if (!hasAny) return null;

  const panel =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={tipId}
            role="tooltip"
            className="pointer-events-auto fixed z-[80] w-60 rounded-lg border border-slate-700/80 bg-slate-950/95 px-2.5 py-2 text-[11px] leading-snug text-slate-200 shadow-xl backdrop-blur-sm"
            style={{ top: coords.top, left: coords.left }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => {
              if (hoverTimer.current != null) {
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = null;
              }
            }}
            onMouseLeave={hide}
          >
            {client ? (
              <div className={visit ? 'mb-1.5' : ''}>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Клиент
                </p>
                <p className="whitespace-pre-wrap text-amber-100/90">{client}</p>
              </div>
            ) : null}
            {visit ? (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Запись
                </p>
                <p className="whitespace-pre-wrap text-slate-200">{visit}</p>
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={btnRef}
        role="button"
        tabIndex={0}
        className="spa-booking-note-chip absolute right-0.5 top-0.5 z-10 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full shadow-sm"
        aria-label="Комментарий"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onPointerDown={(e) => {
          e.stopPropagation();
          // Touch: open tip without starting cell drag.
          if (e.pointerType === 'touch') {
            e.preventDefault();
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (open) hide();
          else show();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            if (open) hide();
            else show();
          }
        }}
        onMouseEnter={() => {
          hoverTimer.current = window.setTimeout(show, 150);
        }}
        onMouseLeave={() => {
          hoverTimer.current = window.setTimeout(hide, 120);
        }}
      >
        <MessageIcon className="h-3 w-3" />
        {both ? (
          <span
            className="spa-booking-note-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
            aria-hidden
          />
        ) : null}
      </span>
      {panel}
    </>
  );
}
