'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type HeaderCell = {
  width: number;
  text: string;
  className: string;
};

/**
 * Table whose thead pins under `.admin-chrome-bar` while its body is in view.
 * Clones the header as a fixed overlay (native sticky fails inside overflow-x-auto).
 */
export function AdminStickyTable({
  children,
  className,
  tableClassName,
}: {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [pinned, setPinned] = useState(false);
  const [headers, setHeaders] = useState<HeaderCell[]>([]);
  const [headerH, setHeaderH] = useState(0);
  const [box, setBox] = useState({ left: 0, width: 0 });
  const [scrollLeft, setScrollLeft] = useState(0);
  const [top, setTop] = useState(0);

  const chromeTop = useCallback(() => {
    const chrome = document.querySelector(
      '.admin-chrome-bar',
    ) as HTMLElement | null;
    return chrome?.getBoundingClientRect().bottom ?? 0;
  }, []);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;
    const thead = table.querySelector('thead');
    if (!thead) return;
    const ths = Array.from(thead.querySelectorAll('th'));
    setHeaders(
      ths.map((th) => ({
        width: th.getBoundingClientRect().width,
        text: th.textContent ?? '',
        className: th.className,
      })),
    );
    setHeaderH(thead.getBoundingClientRect().height);
    const rect = wrap.getBoundingClientRect();
    setBox({ left: rect.left, width: rect.width });
    setScrollLeft(wrap.scrollLeft);
    setTop(chromeTop());
  }, [chromeTop]);

  const updatePin = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const chromeY = chromeTop();
    setTop(chromeY);
    const wrapRect = wrap.getBoundingClientRect();
    const theadH = headerH || 36;
    const should =
      wrapRect.top < chromeY && wrapRect.bottom - theadH > chromeY + 8;
    setPinned(should);
    if (should) {
      setBox({ left: wrapRect.left, width: wrapRect.width });
      setScrollLeft(wrap.scrollLeft);
    }
  }, [chromeTop, headerH]);

  useEffect(() => {
    measure();
    updatePin();
    const onScroll = () => {
      updatePin();
      const wrap = wrapRef.current;
      if (wrap) setScrollLeft(wrap.scrollLeft);
    };
    const onResize = () => {
      measure();
      updatePin();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const wrap = wrapRef.current;
    wrap?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      wrap?.removeEventListener('scroll', onScroll);
    };
  }, [measure, updatePin]);

  useEffect(() => {
    const table = tableRef.current;
    if (!table || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      measure();
      updatePin();
    });
    ro.observe(table);
    return () => ro.disconnect();
  }, [measure, updatePin]);

  const totalW = headers.reduce((s, c) => s + c.width, 0);
  const cloneStyle: CSSProperties = {
    position: 'fixed',
    top,
    left: box.left,
    width: box.width,
    zIndex: 20,
    overflow: 'hidden',
    pointerEvents: 'none',
  };

  return (
    <div
      ref={wrapRef}
      className={cn(
        'overflow-x-auto rounded-xl border border-slate-800',
        className,
      )}
    >
      <table
        ref={tableRef}
        className={cn('min-w-full text-left text-sm', tableClassName)}
      >
        {children}
      </table>
      {pinned && headers.length > 0 ? (
        <div
          style={cloneStyle}
          aria-hidden
          className="admin-chrome border-b border-slate-800 bg-slate-900/80 shadow-sm backdrop-blur"
        >
          <div
            style={{
              transform: `translateX(-${scrollLeft}px)`,
              width: totalW,
            }}
          >
            <table className="text-left text-sm">
              <thead className="bg-slate-900/80 text-xs font-medium text-slate-400">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className={h.className}
                      style={{
                        width: h.width,
                        minWidth: h.width,
                        maxWidth: h.width,
                        height: headerH || undefined,
                        boxSizing: 'border-box',
                      }}
                    >
                      {h.text}
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
