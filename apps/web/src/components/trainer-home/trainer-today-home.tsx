'use client';

import type {
  FloorStaffHome,
  FloorStaffHomeSession,
  TrainerInsight,
  TrainerInsightsResponse,
  TrainerMonthAnalytics,
} from '@fitgo/shared-types';
import { TRAINER_CONTROL_SCOPES } from '@fitgo/shared-types';
import {
  BentoCard,
  Countdown,
  InsightCard,
  KpiRing,
  SeatsMeter,
  Skeleton,
  Timeline,
  TimelineItem,
} from '@fitgo/forma-ui';
import {
  ClipboardCheck,
  ListTodo,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MotivationCard } from '@/components/trainer-motivation/motivation-card';
import {
  PersonalGoalsCard,
  PersonalGoalsEditor,
  usePersonalGoals,
} from '@/components/trainer-motivation/personal-goals-card';
import { useLadderConfetti } from '@/components/trainer-motivation/use-ladder-confetti';
import { StaffTasksInbox } from '@/components/staff-tasks-inbox';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  trainerCacheGet,
  trainerCacheSet,
  trainerGpHomeCacheKey,
  trainerInsightsCacheKey,
} from '@/lib/trainer-fetch-cache';
import { prefetchTrainerJournalLists } from '@/lib/trainer-booking-control-api';
import {
  buildMotivationRecords,
  loadJournalWeekStreak,
} from '@/lib/trainer-motivation';
import { trainerCabinetMode } from '@/lib/trainer-cabinet';
import { cn, formatDateTime } from '@/lib/utils';

const CONTROL_PENDING_LOOKBACK_DAYS = 45;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function timeHm(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDelta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    if (current === 0) return { text: '—', tone: 'flat' as const };
    return { text: 'новый', tone: 'up' as const };
  }
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  if (pct === 0) return { text: '0%', tone: 'flat' as const };
  if (pct > 0) return { text: `+${pct}%`, tone: 'up' as const };
  return { text: `${pct}%`, tone: 'down' as const };
}

function DeltaBadge({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  const delta = formatDelta(current, previous);
  if (!delta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-medium',
        delta.tone === 'up' && 'text-emerald-400/90',
        delta.tone === 'down' && 'text-zinc-500',
        delta.tone === 'flat' && 'text-zinc-500',
      )}
    >
      {delta.tone === 'up' ? (
        <TrendingUp className="h-3 w-3" />
      ) : delta.tone === 'down' ? (
        <TrendingDown className="h-3 w-3" />
      ) : null}
      {delta.text}
    </span>
  );
}

function sessionTone(
  s: FloorStaffHomeSession,
): 'pt' | 'gp' | 'muted' | 'accent' {
  if (s.status === 'DONE' || s.status === 'CANCELLED') return 'muted';
  if (s.status === 'IN_PROGRESS') return 'accent';
  if (s.kind === 'PT') return 'pt';
  if (s.kind === 'GROUP') return 'gp';
  return 'muted';
}

function planHref(s: FloorStaffHomeSession): string | null {
  if (s.kind !== 'PT') return null;
  if (s.sessionKey?.startsWith('fitgo:PT:') && s.clientId) {
    return `/trainer/sessions/${s.id}?clientId=${s.clientId}`;
  }
  return null;
}

function liveHref(s: FloorStaffHomeSession): string | null {
  if (s.kind === 'PT') {
    const q = new URLSearchParams();
    if (s.title) q.set('title', s.title);
    if (s.clientId) q.set('clientId', s.clientId);
    const qs = q.toString();
    return `/trainer/live/pt/${encodeURIComponent(s.id)}${qs ? `?${qs}` : ''}`;
  }
  if (s.kind === 'GROUP') {
    const key = s.sessionKey || s.id;
    const q = new URLSearchParams();
    if (s.title) q.set('title', s.title);
    const qs = q.toString();
    return `/trainer/live/gp/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;
  }
  return null;
}

function HeroNext({
  next,
  scheduleHref,
  journalHref,
}: {
  next: FloorStaffHomeSession | null | undefined;
  scheduleHref: string;
  journalHref?: string | null;
}) {
  if (!next) {
    return (
      <BentoCard className="bg-gradient-to-br from-forma-500/10 via-ink-elevated to-ink-elevated">
        <p className="text-xs uppercase tracking-wide text-forma-400/80">
          Сегодня
        </p>
        <p className="mt-2 font-display text-xl font-semibold text-white">
          Свободное утро
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {journalHref
            ? 'Записей рядом нет — можно закрыть контроль или открыть расписание.'
            : 'Записей рядом нет — откройте расписание или клиентов.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={scheduleHref}
            className="rounded-2xl bg-forma-500 px-4 py-2 text-sm font-semibold text-ink"
          >
            Расписание
          </Link>
          {journalHref ? (
            <Link
              href={journalHref}
              className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-300"
            >
              Журнал
            </Link>
          ) : null}
        </div>
      </BentoCard>
    );
  }

  const plan = planHref(next);
  const live = liveHref(next);
  const kind =
    next.kind === 'PT' ? 'ПТ' : next.kind === 'GROUP' ? 'ГП' : 'Запись';

  return (
    <BentoCard className="bg-gradient-to-br from-forma-500/15 via-ink-elevated to-ink-elevated">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-forma-400/80">
            Ближайшая · {kind}
          </p>
          <p className="mt-1 font-display text-xl font-semibold text-white sm:text-2xl">
            {next.title}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {timeHm(next.startAt)}
            {next.subtitle ? ` · ${next.subtitle}` : ''}
          </p>
        </div>
        {next.status === 'UPCOMING' ? (
          <Countdown to={next.startAt} whenElapsed={null} />
        ) : next.stateLabel ? (
          <span className="max-w-[14rem] text-right font-display text-sm font-semibold text-forma-400">
            {next.stateLabel}
          </span>
        ) : null}
      </div>
      {next.booked != null && next.capacity != null && next.capacity > 0 ? (
        <div className="mt-4 max-w-xs">
          <SeatsMeter booked={next.booked} capacity={next.capacity} />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {live ? (
          <Link
            href={live}
            className="rounded-2xl bg-forma-500 px-4 py-2 text-sm font-semibold text-ink"
          >
            Начать
          </Link>
        ) : null}
        {plan ? (
          <Link
            href={plan}
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-300"
          >
            Открыть план
          </Link>
        ) : !live ? (
          <Link
            href={scheduleHref}
            className="rounded-2xl bg-forma-500 px-4 py-2 text-sm font-semibold text-ink"
          >
            Расписание
          </Link>
        ) : (
          <Link
            href={scheduleHref}
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-300"
          >
            Расписание
          </Link>
        )}
        {journalHref ? (
          <Link
            href={
              next.sessionKey
                ? `${journalHref}?session=${encodeURIComponent(next.sessionKey)}`
                : journalHref
            }
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-300"
          >
            Журнал
          </Link>
        ) : null}
      </div>
    </BentoCard>
  );
}

function AssistantBlock({
  insights,
  loading,
  showAll,
  onToggleAll,
  onDismiss,
}: {
  insights: TrainerInsight[];
  loading: boolean;
  showAll: boolean;
  onToggleAll: () => void;
  onDismiss: (key: string) => void;
}) {
  const visible = showAll ? insights : insights.slice(0, 3);

  return (
    <BentoCard
      title="Помощник"
      action={
        !loading && insights.length > 3 ? (
          <button
            type="button"
            onClick={onToggleAll}
            className="text-xs font-medium text-forma-400 hover:text-forma-300"
          >
            {showAll ? 'Свернуть' : `Все · ${insights.length}`}
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-ink-raised/50 px-3 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 text-forma-400" />
          <p className="text-sm text-zinc-400">
            На сегодня подсказок нет — можно спокойно вести день.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((insight) => (
            <li key={insight.key}>
              <InsightCard
                title={insight.title}
                body={insight.body}
                actionLabel={insight.action?.label}
                onAction={
                  insight.action?.href || insight.action?.messageTemplate
                    ? () => {
                        const tpl = insight.action?.messageTemplate;
                        if (tpl && typeof navigator !== 'undefined') {
                          void navigator.clipboard?.writeText(tpl).catch(
                            () => undefined,
                          );
                        }
                        if (insight.action?.href) {
                          window.location.href = insight.action.href;
                        }
                      }
                    : undefined
                }
                onDismiss={() => onDismiss(insight.key)}
              />
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}

function DayTimeline({
  sessions,
  scheduleHref,
  controlHref,
}: {
  sessions: FloorStaffHomeSession[];
  scheduleHref: string;
  controlHref?: ((s: FloorStaffHomeSession) => string) | null;
}) {
  return (
    <BentoCard
      title="Лента дня"
      action={
        <Link
          href={scheduleHref}
          className="text-xs font-medium text-forma-400 hover:text-forma-300"
        >
          Расписание →
        </Link>
      }
    >
      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-500">На сегодня записей нет</p>
      ) : (
        <Timeline>
          {sessions.map((s) => {
            const plan = planHref(s);
            const href =
              s.status === 'DONE' && s.sessionKey && controlHref
                ? controlHref(s)
                : plan ?? scheduleHref;
            return (
              <TimelineItem
                key={s.id}
                time={timeHm(s.startAt)}
                title={
                  <Link href={href} className="hover:text-forma-300">
                    {s.kind === 'PT' || s.kind === 'GROUP' ? (
                      <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        {s.kind === 'PT' ? 'ПТ' : 'ГП'}
                      </span>
                    ) : null}
                    {s.title}
                  </Link>
                }
                meta={
                  <>
                    {s.subtitle}
                    {s.booked != null && s.capacity != null
                      ? ` · ${s.booked}/${s.capacity}`
                      : ''}
                    {s.stateLabel ? ` · ${s.stateLabel}` : ''}
                  </>
                }
                tone={sessionTone(s)}
              />
            );
          })}
        </Timeline>
      )}
    </BentoCard>
  );
}

function PtKpi({
  a,
  hideLadder = false,
}: {
  a: TrainerMonthAnalytics;
  /** Pure «Тренер клуб» — no club ladder / payroll steps. */
  hideLadder?: boolean;
}) {
  const ladderMax = a.ladder?.nextMinSessions ?? a.ladder?.volumeCount ?? 1;
  const ladderValue = a.ladder?.volumeCount ?? 0;
  return (
    <BentoCard title="ПТ за месяц">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-display text-3xl font-bold tabular-nums text-white">
            {a.pt.count}
          </p>
          <p className="text-xs text-zinc-500">тренировок</p>
          <DeltaBadge current={a.pt.count} previous={a.pt.previous} />
        </div>
        <div>
          <p className="font-display text-3xl font-bold tabular-nums text-white">
            {a.uniqueClients.pt || a.uniqueClients.total}
          </p>
          <p className="text-xs text-zinc-500">уникальных клиентов</p>
          <DeltaBadge
            current={a.uniqueClients.total}
            previous={a.uniqueClients.previous}
          />
        </div>
      </div>
      {!hideLadder && a.ladder ? (
        <div className="mt-4 space-y-2">
          <KpiRing
            value={ladderValue}
            max={ladderMax}
            label={`${a.ladder.percent}%`}
            sublabel={
              a.ladder.isTop
                ? 'верхняя ступень'
                : `до следующей ступени ${a.ladder.remaining} тренировок`
            }
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            Календарный месяц · в объёме {a.ladder.volumeCount} доверенных ПТ
            (ЗП)
            {a.ladder.isTop
              ? ` · ступень ${a.ladder.percent}% · верхняя`
              : ` · ступень ${a.ladder.percent}% · цель ${a.ladder.nextMinSessions} · ещё ${a.ladder.remaining}`}
            . Первая ступень с порога 0 занятий (часто 50%); «0 · 50% · ещё
            101» — по формуле тиров, не ошибка счётчика.
          </p>
          {a.syncedAt ? (
            <p className="text-[11px] text-zinc-600">
              Синхронизация контроля / 1С: {formatDateTime(a.syncedAt)} — не
              путать с локальным учётом пакетов.
            </p>
          ) : null}
        </div>
      ) : null}
      {a.giftConversion && a.giftConversion.giftedClients > 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          Подарок → оплата: {a.giftConversion.convertedClients} из{' '}
          {a.giftConversion.giftedClients}
          {a.giftConversion.pct != null ? ` · ${a.giftConversion.pct}%` : ''}
        </p>
      ) : null}
    </BentoCard>
  );
}

function GpKpi({ a }: { a: TrainerMonthAnalytics }) {
  return (
    <BentoCard title="ГП за месяц">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-display text-3xl font-bold tabular-nums text-white">
            {a.group.avgFillPct != null ? `${a.group.avgFillPct}%` : '—'}
          </p>
          <p className="text-xs text-zinc-500">средняя заполняемость</p>
          <DeltaBadge
            current={a.group.avgFillPct}
            previous={a.group.previousAvgFillPct}
          />
        </div>
        <div>
          <p className="font-display text-3xl font-bold tabular-nums text-white">
            {a.group.avgAttendees ?? '—'}
          </p>
          <p className="text-xs text-zinc-500">средняя посещаемость</p>
          <DeltaBadge
            current={a.group.avgAttendees}
            previous={a.group.previousAvgAttendees}
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Занятий: {a.group.count}
        <span className="ml-2 inline-flex">
          <DeltaBadge current={a.group.count} previous={a.group.previous} />
        </span>
      </p>
    </BentoCard>
  );
}

function TasksBlock({
  data,
  controlBase,
}: {
  data: FloorStaffHome;
  controlBase?: string | null;
}) {
  const controlFrom = daysAgoIso(CONTROL_PENDING_LOOKBACK_DAYS);
  const controlTo = todayIso();
  const controlPendingQs = `from=${encodeURIComponent(controlFrom)}&to=${encodeURIComponent(controlTo)}&needsReview=1`;
  const pending = data.control.pendingMe;
  const scopeLabel =
    data.control.scopeLabel ?? TRAINER_CONTROL_SCOPES.pendingMe.scopeRu;
  const todayNeedsConfirm = data.today.sessions.some((s) => s.needsConfirm);
  const emptyCopy =
    pending > 0
      ? 'Ждут вашей отметки'
      : todayNeedsConfirm
        ? 'Есть слот без подтверждённого результата — откройте журнал'
        : TRAINER_CONTROL_SCOPES.pendingMe.emptyRu;

  return (
    <div className="space-y-3">
      <StaffTasksInbox />
      {controlBase ? (
        <>
          <Link
            href={`${controlBase}?${controlPendingQs}`}
            className={cn(
              'block rounded-3xl border p-4 transition',
              pending > 0 || todayNeedsConfirm
                ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60'
                : 'border-white/[0.08] bg-ink-elevated/90 hover:border-forma-500/30',
            )}
          >
            <div className="flex items-start gap-3">
              <ClipboardCheck
                className={cn(
                  'mt-0.5 h-5 w-5 shrink-0',
                  pending > 0 || todayNeedsConfirm
                    ? 'text-amber-400'
                    : 'text-forma-400',
                )}
              />
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {TRAINER_CONTROL_SCOPES.pendingMe.titleRu}
                </p>
                <p className="font-display text-2xl font-bold tabular-nums text-white">
                  {pending}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">{emptyCopy}</p>
                <p className="mt-1 text-[11px] leading-snug text-zinc-600">
                  {scopeLabel}
                </p>
              </div>
            </div>
          </Link>
          {data.control.queue.length > 0 ? (
            <BentoCard title="Очередь">
              <ul className="space-y-2">
                {data.control.queue.map((item) => (
                  <li key={item.sessionKey}>
                    <Link
                      href={`${controlBase}?session=${encodeURIComponent(item.sessionKey)}&${controlPendingQs}`}
                      className="flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-ink-raised/50 px-3 py-2 text-sm transition hover:border-forma-500/30"
                    >
                      <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <span className="min-w-0">
                        <span className="block font-medium text-white">
                          {item.title}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {formatDateTime(item.startAt)}
                          {item.subtitle ? ` · ${item.subtitle}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </BentoCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 w-full rounded-3xl" />
      <Skeleton className="h-32 w-full rounded-3xl" />
      <Skeleton className="h-48 w-full rounded-3xl" />
    </div>
  );
}

export function TrainerTodayHome({
  scheduleHref,
}: {
  scheduleHref?: string;
}) {
  const user = getUser();
  const { showPt, showGp, showPtControl } = trainerCabinetMode(user);
  /** Staff PT / GP see booking control; pure «Тренер клуб» does not. */
  const showControlLinks = showPtControl || showGp;
  const isPureClub = Boolean(user?.trainerClub) && !user?.trainerStaff && !showGp;
  /** Goals / KPI / assistant are secondary — don't block first paint. */
  const [deferSecondary, setDeferSecondary] = useState(false);
  const personalGoals = usePersonalGoals(isPureClub && deferSecondary);
  const [home, setHome] = useState<FloorStaffHome | null>(() => {
    const uid = getUser()?.id;
    if (!uid) return null;
    return (
      trainerCacheGet<FloorStaffHome>(trainerGpHomeCacheKey(uid, 'full')) ??
      trainerCacheGet<FloorStaffHome>(trainerGpHomeCacheKey(uid, 'lite'))
    );
  });
  const [insights, setInsights] = useState<TrainerInsightsResponse | null>(
    () => {
      const uid = getUser()?.id;
      if (!uid) return null;
      return trainerCacheGet<TrainerInsightsResponse>(
        trainerInsightsCacheKey(uid),
      );
    },
  );
  const [insightsLoading, setInsightsLoading] = useState(() => {
    const uid = getUser()?.id;
    if (!uid) return true;
    return !trainerCacheGet(trainerInsightsCacheKey(uid));
  });
  const [showAllInsights, setShowAllInsights] = useState(false);
  const [error, setError] = useState('');

  const loadLiteHome = useCallback(() => {
    const token = getToken();
    const uid = getUser()?.id;
    if (!token || !uid) return Promise.resolve();
    const liteKey = trainerGpHomeCacheKey(uid, 'lite');
    return api
      .trainerGpHome(token, { lite: true })
      .then((h) => {
        setHome((prev) => {
          // Don't clobber a fuller payload already on screen.
          if (prev?.monthAnalytics) return prev;
          return h;
        });
        setError('');
        trainerCacheSet(liteKey, h);
      })
      .catch((err: Error) => {
        if (
          !trainerCacheGet(liteKey) &&
          !trainerCacheGet(trainerGpHomeCacheKey(uid, 'full'))
        ) {
          setError(err.message || 'Ошибка загрузки');
        }
      });
  }, []);

  const loadFullHome = useCallback(() => {
    const token = getToken();
    const uid = getUser()?.id;
    if (!token || !uid) return;
    const fullKey = trainerGpHomeCacheKey(uid, 'full');
    api
      .trainerGpHome(token)
      .then((h) => {
        setHome(h);
        setError('');
        trainerCacheSet(fullKey, h);
        trainerCacheSet(trainerGpHomeCacheKey(uid, 'lite'), {
          ...h,
          monthAnalytics: undefined,
          month: { ...h.month, metrics: [], footnote: undefined },
        });
      })
      .catch(() => {
        /* lite already painted; KPI stays empty */
      });
  }, []);

  const loadInsights = useCallback(() => {
    const token = getToken();
    const uid = getUser()?.id;
    if (!token || !uid) return;
    const cacheKey = trainerInsightsCacheKey(uid);
    const soft = trainerCacheGet<TrainerInsightsResponse>(cacheKey);
    if (!soft) setInsightsLoading(true);
    api
      .trainerInsights(token)
      .catch(() => ({
        insights: [] as TrainerInsight[],
        generatedAt: new Date().toISOString(),
      }))
      .then((i) => {
        setInsights(i);
        trainerCacheSet(cacheKey, i);
      })
      .finally(() => setInsightsLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadLiteHome();
      if (cancelled) return;
      setDeferSecondary(true);
      // Secondary wave: analytics + assistant (+ journal prefetch) in parallel.
      loadFullHome();
      loadInsights();
      if (showControlLinks) {
        prefetchTrainerJournalLists({
          lookbackDays: CONTROL_PENDING_LOOKBACK_DAYS,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLiteHome, loadFullHome, loadInsights, showControlLinks]);

  const dismissInsight = useCallback(
    async (key: string) => {
      const token = getToken();
      if (!token) return;
      setInsights((prev) =>
        prev
          ? {
              ...prev,
              insights: prev.insights.filter((x) => x.key !== key),
            }
          : prev,
      );
      try {
        await api.trainerDismissInsight(token, { key, days: 3 });
      } catch {
        loadInsights();
      }
    },
    [loadInsights],
  );

  const scheduleBase = useMemo(
    () =>
      scheduleHref ??
      (showGp ? '/trainer/gp-schedule' : '/trainer/schedule'),
    [scheduleHref, showGp],
  );
  const controlBase = showControlLinks ? '/trainer/my-sessions' : null;

  const a = home?.monthAnalytics;
  useLadderConfetti(
    user?.id,
    !isPureClub && a?.ladder
      ? { percent: a.ladder.percent, volumeCount: a.ladder.volumeCount }
      : null,
  );
  const motivation = useMemo(
    () => buildMotivationRecords(a, loadJournalWeekStreak()),
    [a],
  );

  if (error) return <p className="text-red-400">{error}</p>;
  if (!home) return <TodaySkeleton />;

  const showPtKpi = showPt && a && (a.pt.count > 0 || a.ladder != null);
  const showGpKpi =
    showGp &&
    a &&
    (a.group.count > 0 ||
      a.group.avgFillPct != null ||
      home.today.sessions.some((s) => s.kind === 'GROUP'));

  const controlSessionHref = controlBase
    ? (s: FloorStaffHomeSession) =>
        s.sessionKey
          ? `${controlBase}?session=${encodeURIComponent(s.sessionKey)}`
          : controlBase
    : null;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-zinc-500">Сегодня</p>
          <p className="font-display text-xl font-semibold text-white sm:text-2xl">
            {home.staffName || '—'}
          </p>
        </div>
        <p className="text-xs capitalize text-zinc-500">
          {new Date(home.today.date + 'T12:00:00').toLocaleDateString('ru-RU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>

      {/* Mobile: stacked. Desktop: bento 12-col — hero+timeline left, assistant right */}
      <div className="grid gap-4 desktop:grid-cols-12">
        <div className="space-y-4 desktop:col-span-7">
          <HeroNext
            next={home.today.next}
            scheduleHref={scheduleBase}
            journalHref={controlBase}
          />
          <DayTimeline
            sessions={home.today.sessions}
            scheduleHref={scheduleBase}
            controlHref={controlSessionHref}
          />
        </div>
        <div className="space-y-4 desktop:col-span-5">
          <AssistantBlock
            insights={insights?.insights ?? []}
            loading={insightsLoading}
            showAll={showAllInsights}
            onToggleAll={() => setShowAllInsights((v) => !v)}
            onDismiss={dismissInsight}
          />
          <TasksBlock data={home} controlBase={controlBase} />
        </div>
      </div>

      {(showPtKpi || showGpKpi) && a ? (
        <div
          className={cn(
            'grid gap-4',
            showPtKpi && showGpKpi ? 'desktop:grid-cols-2' : 'grid-cols-1',
          )}
        >
          {showPtKpi ? <PtKpi a={a} hideLadder={isPureClub} /> : null}
          {showGpKpi ? <GpKpi a={a} /> : null}
        </div>
      ) : null}

      {isPureClub ? (
        <>
          <PersonalGoalsCard
            data={personalGoals.data}
            onEdit={() => personalGoals.setEditorOpen(true)}
          />
          <PersonalGoalsEditor
            open={personalGoals.editorOpen}
            onOpenChange={personalGoals.setEditorOpen}
            initial={personalGoals.initialInputs}
            onSaved={(d) => personalGoals.setData(d)}
          />
        </>
      ) : motivation ? (
        <MotivationCard records={motivation} />
      ) : null}
    </div>
  );
}
