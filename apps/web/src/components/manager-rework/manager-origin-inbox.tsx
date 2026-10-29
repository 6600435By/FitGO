'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';

export type ManagerOriginTaskItem = {
  id: string;
  title: string;
  description?: string;
  dueAt?: string;
  sessionKey?: string;
  clientName?: string;
  productName?: string;
  createdBy?: { firstName: string; lastName: string };
};

type Props = {
  /** Load open MANAGER tasks for the current user. */
  list: (token: string) => Promise<ManagerOriginTaskItem[]>;
  /** Mark task done with optional comment. */
  complete: (token: string, id: string, comment?: string) => Promise<unknown>;
  /** Open booking-control card when sessionKey is present. */
  onOpenSession?: (sessionKey: string) => void;
};

const CLUB_TZ = 'Europe/Minsk';

function fmtDue(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: CLUB_TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Narrow «От руководителя» inbox for trainer / specialist. */
export function ManagerOriginInbox({ list, complete, onOpenSession }: Props) {
  const [items, setItems] = useState<ManagerOriginTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setItems(await list(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading && items.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
        Загрузка задач от руководителя…
      </div>
    );
  }

  if (!loading && items.length === 0 && !error) {
    return null;
  }

  return (
    <section className="mb-4 space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-100">От руководителя</h2>
        <button
          type="button"
          className="text-xs text-slate-400 underline-offset-2 hover:underline"
          onClick={() => void reload()}
        >
          Обновить
        </button>
      </div>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      <ul className="space-y-3">
        {items.map((t) => {
          const from = t.createdBy
            ? `${t.createdBy.firstName} ${t.createdBy.lastName}`.trim()
            : '';
          return (
            <li
              key={t.id}
              className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"
            >
              <div className="text-sm font-medium text-slate-100">{t.title}</div>
              {(t.clientName || t.productName) && (
                <p className="mt-0.5 text-xs text-slate-400">
                  {[t.clientName, t.productName].filter(Boolean).join(' · ')}
                </p>
              )}
              {t.description ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">
                  {t.description}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {from ? <span>От: {from}</span> : null}
                {t.dueAt ? <span>До {fmtDue(t.dueAt)}</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-xs text-slate-400">
                  Комментарий
                  <textarea
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                    rows={2}
                    value={drafts[t.id] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                    }
                    placeholder="Что сделали"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {t.sessionKey && onOpenSession ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => onOpenSession(t.sessionKey!)}
                    >
                      Открыть занятие
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={busyId === t.id}
                    onClick={async () => {
                      const token = getToken();
                      if (!token) return;
                      setBusyId(t.id);
                      setError('');
                      try {
                        await complete(token, t.id, drafts[t.id]);
                        setItems((prev) => prev.filter((x) => x.id !== t.id));
                        setDrafts((prev) => {
                          const next = { ...prev };
                          delete next[t.id];
                          return next;
                        });
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : 'Не удалось закрыть задачу',
                        );
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    Готово
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
