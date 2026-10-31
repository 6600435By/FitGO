'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastApi {
  push: (toast: Omit<ToastItem, 'id'>) => void;
  success: (title: string, opts?: Partial<Omit<ToastItem, 'id' | 'kind' | 'title'>>) => void;
  error: (title: string, opts?: Partial<Omit<ToastItem, 'id' | 'kind' | 'title'>>) => void;
  info: (title: string, opts?: Partial<Omit<ToastItem, 'id' | 'kind' | 'title'>>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, opts) => push({ kind: 'success', title, ...opts }),
      error: (title, opts) => push({ kind: 'error', title, ...opts }),
      info: (title, opts) => push({ kind: 'info', title, ...opts }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] mx-auto flex w-full max-w-lg flex-col gap-2 px-4">
        <AnimatePresence>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-2xl border px-3.5 py-3 shadow-forma-card backdrop-blur-xl',
                item.kind === 'success' &&
                  'border-emerald-500/30 bg-emerald-950/90 text-emerald-100',
                item.kind === 'error' &&
                  'border-rose-500/30 bg-rose-950/90 text-rose-100',
                item.kind === 'info' &&
                  'border-forma-500/30 bg-ink-elevated/95 text-zinc-100',
              )}
            >
              {item.kind === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              ) : item.kind === 'error' ? (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              ) : (
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-forma-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs opacity-80">{item.description}</p>
                ) : null}
                {item.actionLabel && item.onAction ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-forma-400 touch-manipulation"
                    onClick={() => {
                      item.onAction?.();
                      dismiss(item.id);
                    }}
                  >
                    {item.actionLabel}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="shrink-0 rounded-lg p-1 opacity-60 touch-manipulation hover:opacity-100"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
