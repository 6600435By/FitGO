'use client';

import type {
  AdminDebtLine,
  AdminInboxItem,
  AdminInboxKind,
  AdminInboxView,
  AdminTaskEventItem,
  AdminTaskOutcomeDef,
  AdminTasksInboxResponse,
} from '@fitgo/shared-types';
import {
  ADMIN_INBOX_KIND_SHORT_LABEL,
  ADMIN_INBOX_VIEW_LABEL,
  filterAdminInboxItems,
  isAdminInboxDebtKind,
  parseLegacyAdminTasksQuery,
} from '@fitgo/shared-types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RenewalTaskSheet } from '@/components/admin/renewal-task-sheet';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { createBookingControlApi } from '@/lib/booking-control-api';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { TaskCard } from './task-card';
import { TaskDetail } from './task-detail';
import type { TaskMenuAction } from './task-actions-menu';
import { TaskOutcomeSheet } from './task-outcome-sheet';

type Mem = {
  view: AdminInboxView;
  kind: AdminInboxKind | '' ;
};

const VIEWS: AdminInboxView[] = ['now', 'mine', 'pool', 'waiting', 'done'];
const KINDS: AdminInboxKind[] = [
  'calls',
  'birthday',
  'money',
  'control',
  'manager',
  'staff',
];

function viewCount(
  counts: AdminTasksInboxResponse['counts'] | null,
  view: AdminInboxView,
): number {
  if (!counts) return 0;
  switch (view) {
    case 'now':
      return counts.total;
    case 'mine':
      return counts.mine;
    case 'pool':
      return counts.pool;
    case 'waiting':
      return counts.waiting;
    case 'done':
      return counts.doneToday;
    default:
      return 0;
  }
}

export function TaskInbox() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const ownerId = user?.id ?? '';

  const boot = (() => {
    const defaults: Mem = { view: 'now', kind: '' };
    return resolveViewFilters<Mem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search: searchParams,
      urlKeys: ['view', 'kind', 'topic', 'group', 'task'],
      fromUrl: (s) => {
        const parsed = parseLegacyAdminTasksQuery({
          view: s.get('view'),
          kind: s.get('kind'),
          topic: s.get('topic'),
          group: s.get('group'),
        });
        return {
          view: parsed.view,
          kind: parsed.kind ?? '',
        };
      },
      defaults,
    });
  })();

  const [inbox, setInbox] = useState<AdminTasksInboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<AdminInboxView>(
    (boot.view as AdminInboxView) || 'now',
  );
  const [kind, setKind] = useState<AdminInboxKind | null>(
    boot.kind ? (boot.kind as AdminInboxKind) : null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('task'),
  );
  const [topicFilter, setTopicFilter] = useState<string | null>(
    searchParams.get('topic'),
  );
  const [outcomeItem, setOutcomeItem] = useState<AdminInboxItem | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [blockPrompt, setBlockPrompt] = useState<AdminInboxItem | null>(null);
  const [blockComment, setBlockComment] = useState('');
  const [commentPrompt, setCommentPrompt] = useState<AdminInboxItem | null>(
    null,
  );
  const [debtLines, setDebtLines] = useState<Record<string, AdminDebtLine[]>>(
    {},
  );
  const [debtLoading, setDebtLoading] = useState(false);
  const [events, setEvents] = useState<Record<string, AdminTaskEventItem[]>>(
    {},
  );
  const [eventsLoading, setEventsLoading] = useState(false);
  const [peekSession, setPeekSession] = useState<{
    sessionKey: string;
    from?: string;
    to?: string;
  } | null>(null);
  const [renewalId, setRenewalId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const bookingPeekApi = useMemo(() => createBookingControlApi('admin'), []);

  usePersistViewMemory<Mem>({
    data: { view, kind: kind ?? '' },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.view && d.view !== 'now') q.set('view', d.view);
      if (d.kind) q.set('kind', d.kind);
      if (topicFilter) q.set('topic', topicFilter);
      if (selectedId) q.set('task', selectedId);
      return q;
    },
  });

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setError('');
    try {
      const data = await api.adminTasksInbox(token);
      setInbox(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view === 'now') params.delete('view');
    else params.set('view', view);
    if (kind) params.set('kind', kind);
    else params.delete('kind');
    if (topicFilter) params.set('topic', topicFilter);
    else params.delete('topic');
    if (selectedId) params.set('task', selectedId);
    else params.delete('task');
    const qs = params.toString();
    const live = window.location.search.replace(/^\?/, '');
    if (qs === live) return;
    router.replace(qs ? `/admin/tasks?${qs}` : '/admin/tasks', {
      scroll: false,
    });
  }, [view, kind, topicFilter, selectedId, router]);

  const items = useMemo(() => {
    if (!inbox) return [];
    let list = filterAdminInboxItems(inbox.items, { view, kind });
    if (topicFilter) {
      list = list.filter((i) => i.topic === topicFilter);
    }
    return list;
  }, [inbox, view, kind, topicFilter]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return (
      items.find((i) => i.id === selectedId) ??
      inbox?.items.find((i) => i.id === selectedId) ??
      null
    );
  }, [items, selectedId, inbox?.items]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  const patchLocal = (id: string, patch: Partial<AdminInboxItem>) => {
    setInbox((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.id === id ? { ...i, ...patch } : i,
        ),
      };
    });
  };

  const removeLocal = (id: string) => {
    setInbox((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.filter((i) => i.id !== id),
      };
    });
  };

  const openPrimary = (item: AdminInboxItem) => {
    if (item.primaryAction === 'open_renewal') {
      setRenewalId(item.id);
      return;
    }
    if (item.primaryAction === 'open_session') {
      const sessionKey =
        item.pending?.sessionKey ??
        (item.task && 'sessionKey' in item.task
          ? (item.task as { sessionKey?: string }).sessionKey
          : undefined);
      if (sessionKey) {
        setPeekSession({
          sessionKey,
          from: item.dueAt?.slice(0, 10),
          to: item.dueAt?.slice(0, 10),
        });
      }
      return;
    }
    if (item.primaryAction === 'call') {
      // tel: handled on card; secondary path opens outcomes
      setOutcomeItem(item);
      return;
    }
    if (item.virtual) return;
    setOutcomeItem(item);
  };

  const applyOutcome = async (
    item: AdminInboxItem,
    outcome: AdminTaskOutcomeDef,
    extra?: { comment?: string; date?: string },
  ) => {
    const token = getToken();
    if (!token || item.virtual) return;

    if (outcome.effect === 'open_renewal') {
      setRenewalId(item.id);
      return;
    }
    if (outcome.effect === 'open_session') {
      openPrimary(item);
      return;
    }

    const prev = item;
    if (outcome.effect === 'done' || outcome.effect === 'cancel') {
      removeLocal(item.id);
    } else if (outcome.effect === 'snooze') {
      patchLocal(item.id, { bucket: 'waiting', owner: 'mine' });
    } else if (outcome.effect === 'block') {
      patchLocal(item.id, {
        subtitle: extra?.comment ?? 'Не могу',
      });
    }

    try {
      await api.adminTaskOutcome(token, item.id, {
        outcomeId: outcome.id,
        comment: extra?.comment,
        date: extra?.date,
        snoozeDays: outcome.snoozeDays,
      });
      showToast(outcome.label);
      void load();
    } catch (e) {
      setInbox((cur) => {
        if (!cur) return cur;
        const has = cur.items.some((i) => i.id === prev.id);
        return {
          ...cur,
          items: has
            ? cur.items.map((i) => (i.id === prev.id ? prev : i))
            : [...cur.items, prev],
        };
      });
      throw e;
    }
  };

  const onMenu = async (item: AdminInboxItem, action: TaskMenuAction) => {
    const token = getToken();
    if (!token) return;

    if (action === 'outcome') {
      setOutcomeItem(item);
      return;
    }
    if (action === 'history') {
      setSelectedId(item.id);
      void loadEvents(item.id);
      return;
    }
    if (action === 'comment') {
      setCommentPrompt(item);
      return;
    }
    if (action === 'block') {
      setBlockPrompt(item);
      return;
    }
    if (item.virtual) return;

    if (action === 'claim') {
      patchLocal(item.id, { owner: 'mine' });
      try {
        await api.adminClaimTask(token, item.id);
        showToast('Взяли в работу');
        void load();
      } catch {
        void load();
      }
      return;
    }

    const days =
      action === 'snooze_evening'
        ? 0
        : action === 'snooze_tomorrow'
          ? 1
          : 3;
    const snoozeDays = Math.max(1, days || 1);
    patchLocal(item.id, { bucket: 'waiting', owner: 'mine' });
    try {
      if (action === 'snooze_evening') {
        await api.adminTaskOutcome(token, item.id, {
          outcomeId:
            item.outcomes.find((o) => o.effect === 'snooze')?.id ??
            'no_answer',
          snoozeDays: 1,
          comment: 'Отложено на сегодня вечером',
        });
      } else {
        await api.adminSnoozeTask(token, item.id, snoozeDays);
      }
      showToast('Отложено');
      void load();
    } catch {
      void load();
    }
  };

  const loadDebt = async (id: string) => {
    if (debtLines[id]) return;
    const token = getToken();
    if (!token) return;
    setDebtLoading(true);
    try {
      const lines = await api.adminDebtLines(token, id);
      setDebtLines((prev) => ({ ...prev, [id]: lines }));
    } catch {
      setDebtLines((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setDebtLoading(false);
    }
  };

  const loadEvents = async (id: string) => {
    if (id.startsWith('virtual:')) return;
    const token = getToken();
    if (!token) return;
    setEventsLoading(true);
    try {
      const detail = await api.adminTaskDetail(token, id);
      setEvents((prev) => ({
        ...prev,
        [id]: detail.events ?? [],
      }));
    } catch {
      setEvents((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    if (!selected || selected.virtual) return;
    void loadEvents(selected.id);
    if (
      selected.source === 'CLIENT_DEBT' ||
      selected.source === 'STAFF_DEBT' ||
      selected.source === 'DEBT_OVERDUE'
    ) {
      void loadDebt(selected.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      const idx = items.findIndex((i) => i.id === selectedId);
      if (e.key === 'j' || e.key === 'J') {
        const next = items[Math.min(items.length - 1, Math.max(0, idx + 1))];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'k' || e.key === 'K') {
        const next = items[Math.max(0, idx <= 0 ? 0 : idx - 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'Enter' && selected) {
        openPrimary(selected);
      } else if ((e.key === 'd' || e.key === 'D') && selected && !selected.virtual) {
        setOutcomeItem(selected);
      } else if ((e.key === 's' || e.key === 'S') && selected && !selected.virtual) {
        void onMenu(selected, 'snooze_tomorrow');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Долги не смешиваем с «Просрочено» — отдельная секция.
  const debtItems = items.filter((i) => isAdminInboxDebtKind(i));
  const overdueItems = items.filter(
    (i) => i.bucket === 'overdue' && !isAdminInboxDebtKind(i),
  );
  const todayItems = items.filter(
    (i) => i.bucket === 'today' && !isAdminInboxDebtKind(i),
  );
  const otherItems = items.filter(
    (i) =>
      !isAdminInboxDebtKind(i) &&
      i.bucket !== 'overdue' &&
      i.bucket !== 'today',
  );

  const renderList = (list: AdminInboxItem[], heading?: string) => (
    <div className="space-y-2">
      {heading ? (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {heading} ({list.length})
        </h3>
      ) : null}
      <ul className="space-y-2">
        {list.map((item) => (
          <TaskCard
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            onSelect={() => setSelectedId(item.id)}
            onPrimary={() => openPrimary(item)}
            onMenu={(a) => void onMenu(item, a)}
          />
        ))}
      </ul>
    </div>
  );

  const detailPanel = selected ? (
    <TaskDetail
      item={selected}
      debtLines={debtLines[selected.id]}
      debtLoading={debtLoading}
      events={events[selected.id]}
      eventsLoading={eventsLoading}
      commentDraft={commentDraft}
      onCommentDraft={setCommentDraft}
      onComment={() => {
        const token = getToken();
        const text = commentDraft.trim();
        if (!token || !text || selected.virtual) return;
        void api.adminTaskComment(token, selected.id, text).then(() => {
          setCommentDraft('');
          showToast('Комментарий записан');
          void loadEvents(selected.id);
        });
      }}
      onConfirmClient={(externalId, confirmed) => {
        const token = getToken();
        if (!token || selected.virtual) return;
        void api
          .adminConfirmBookingClient(token, selected.id, {
            clientExternalId: externalId,
            confirmed,
          })
          .then(() => load());
      }}
      onLoadDebt={() => void loadDebt(selected.id)}
      onClose={() => setSelectedId(null)}
      onPrimary={() => openPrimary(selected)}
      onOutcome={() => setOutcomeItem(selected)}
    />
  ) : (
    <div className="card hidden !p-6 text-sm text-slate-500 lg:block">
      Выберите задачу — детали справа. Клавиши: J/K, Enter, D (исход), S
      (отложить).
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Очередь задач</p>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Обновить
        </button>
      </div>

      <div className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-slate-950/90 px-1 py-1 backdrop-blur">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              setSelectedId(null);
            }}
            className={
              view === v
                ? 'btn-primary shrink-0 px-3 py-2 text-xs'
                : 'btn-secondary shrink-0 px-3 py-2 text-xs'
            }
          >
            {ADMIN_INBOX_VIEW_LABEL[v]}
            {inbox ? ` (${viewCount(inbox.counts, v)})` : ''}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => {
            setKind(null);
            setTopicFilter(null);
          }}
          className={
            !kind
              ? 'btn-primary shrink-0 px-3 py-2 text-xs'
              : 'btn-secondary shrink-0 px-3 py-2 text-xs'
          }
        >
          Все виды
        </button>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setTopicFilter(null);
            }}
            className={
              kind === k
                ? 'btn-primary shrink-0 px-3 py-2 text-xs'
                : 'btn-secondary shrink-0 px-3 py-2 text-xs'
            }
          >
            {ADMIN_INBOX_KIND_SHORT_LABEL[k]}
            {inbox ? ` (${inbox.counts.byKind[k]})` : ''}
          </button>
        ))}
      </div>

      {inbox?.birthdayScanError ? (
        <p className="text-xs text-amber-300/90">
          1С не отдала дни рождения: {inbox.birthdayScanError}
        </p>
      ) : null}
      {inbox && (inbox.skippedBirthdays ?? 0) > 0 ? (
        <p className="text-xs text-slate-500">
          Ещё {inbox.skippedBirthdays} ДР сегодня — не были в клубе &gt; 2 лет
        </p>
      ) : null}

      {loading && !inbox ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : null}
      {error ? <p className="text-rose-400">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {items.length === 0 && !loading ? (
            <p className="text-slate-400">Нет задач в этом виде</p>
          ) : null}
          {view === 'now' ? (
            <>
              {overdueItems.length > 0
                ? renderList(overdueItems, 'Просрочено')
                : null}
              {todayItems.length > 0
                ? renderList(todayItems, 'Сегодня')
                : null}
              {debtItems.length > 0
                ? renderList(debtItems, 'Долги')
                : null}
              {otherItems.length > 0
                ? renderList(otherItems, 'Ещё')
                : null}
            </>
          ) : kind === 'money' || kind === 'staff' ? (
            renderList(items, 'Долги')
          ) : (
            renderList(items)
          )}
        </div>

        <div className="hidden lg:block">{detailPanel}</div>
      </div>

      {/* Mobile detail sheet */}
      {selected ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60 p-0 lg:hidden">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-slate-950 p-3">
            {detailPanel}
          </div>
        </div>
      ) : null}

      {outcomeItem ? (
        <TaskOutcomeSheet
          title={outcomeItem.title}
          outcomes={outcomeItem.outcomes}
          onClose={() => setOutcomeItem(null)}
          onSubmit={async ({ outcome, comment, date }) => {
            await applyOutcome(outcomeItem, outcome, { comment, date });
          }}
        />
      ) : null}

      {blockPrompt ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold">Не могу выполнить</h3>
            <textarea
              className="input w-full"
              rows={3}
              value={blockComment}
              onChange={(e) => setBlockComment(e.target.value)}
              placeholder="Причина"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => {
                  const o =
                    blockPrompt.outcomes.find((x) => x.effect === 'block') ?? {
                      id: 'block',
                      label: 'Не могу',
                      effect: 'block' as const,
                      needsComment: true,
                    };
                  void applyOutcome(blockPrompt, o, {
                    comment: blockComment,
                  }).then(() => {
                    setBlockPrompt(null);
                    setBlockComment('');
                  });
                }}
              >
                Отправить
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setBlockPrompt(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {commentPrompt ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold">Комментарий</h3>
            <textarea
              className="input w-full"
              rows={3}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => {
                  const token = getToken();
                  const text = commentDraft.trim();
                  if (!token || !text || commentPrompt.virtual) return;
                  void api
                    .adminTaskComment(token, commentPrompt.id, text)
                    .then(() => {
                      setCommentPrompt(null);
                      setCommentDraft('');
                      showToast('Записано');
                    });
                }}
              >
                Записать
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setCommentPrompt(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renewalId ? (
        <RenewalTaskSheet
          taskId={renewalId}
          onClose={() => {
            setRenewalId(null);
            void load();
          }}
          onUpdated={() => void load()}
        />
      ) : null}

      {peekSession ? (
        <BookingControlPanel
          key={peekSession.sessionKey}
          api={bookingPeekApi}
          canResolve
          canMarkAttendance
          canApproveGroup
          approvalActor="admin"
          canReturnApproval
          canViewHallPhotos
          detailOnly
          initialSessionKey={peekSession.sessionKey}
          initialFrom={peekSession.from}
          initialTo={peekSession.to}
          onDetailClose={() => {
            setPeekSession(null);
            void load();
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg md:bottom-6">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
