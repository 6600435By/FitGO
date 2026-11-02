'use client';

import type {
  SpecialistCalendarResponse,
  SpecialistWorkSlotInput,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  normalizeHm,
  SpaHoursEditor,
} from '@/components/spa-board/spa-hours-editor';
import { SpaSpecialistShiftMonth } from '@/components/spa-board/spa-specialist-shift-month';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function normalizeSlots(slots: SpecialistWorkSlotInput[]) {
  return slots.map((s) => ({
    ...s,
    startTime: normalizeHm(s.startTime),
    endTime: normalizeHm(s.endTime),
  }));
}

function dayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShort(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

export default function SpecialistWorkSchedulePage() {
  const [calendar, setCalendar] = useState<SpecialistCalendarResponse | null>(
    null,
  );
  const [workSlots, setWorkSlots] = useState<SpecialistWorkSlotInput[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishAck, setPublishAck] = useState(false);
  const [draftWeeks, setDraftWeeks] = useState(4);

  const horizon = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 56);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [cal, slots] = await Promise.all([
      api.specialistCalendar(token, horizon.start, horizon.end),
      api.specialistWorkSchedule(token),
    ]);
    setCalendar(cal);
    setWorkSlots(slots);
  }, [horizon.end, horizon.start]);

  useEffect(() => {
    reload().catch((err) =>
      setMessage(err instanceof Error ? err.message : 'Ошибка загрузки'),
    );
  }, [reload]);

  const publishedBlocks = useMemo(
    () =>
      (calendar?.availabilityBlocks ?? []).filter(
        (b) => b.status === 'PUBLISHED',
      ),
    [calendar],
  );
  const draftBlocks = useMemo(
    () =>
      (calendar?.availabilityBlocks ?? []).filter((b) => b.status === 'DRAFT'),
    [calendar],
  );

  const publishedUntil = useMemo(() => {
    if (publishedBlocks.length === 0) return null;
    let max = 0;
    for (const b of publishedBlocks) {
      max = Math.max(max, new Date(b.endAt).getTime());
    }
    return new Date(max);
  }, [publishedBlocks]);

  const draftRange = useMemo(() => {
    if (draftBlocks.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    const days = new Set<string>();
    for (const b of draftBlocks) {
      const s = new Date(b.startAt).getTime();
      const e = new Date(b.endAt).getTime();
      min = Math.min(min, s);
      max = Math.max(max, e);
      days.add(dayKey(new Date(b.startAt)));
    }
    return {
      start: new Date(min),
      end: new Date(max),
      dayCount: days.size,
      firstDayKey: dayKey(new Date(min)),
    };
  }, [draftBlocks]);

  const draftBookingCount = useMemo(() => {
    if (!calendar || !draftRange) return 0;
    const startMs = draftRange.start.getTime();
    const endMs = draftRange.end.getTime();
    return calendar.events.filter((ev) => {
      if (ev.kind !== 'SPA') return false;
      const t = new Date(ev.startAt).getTime();
      return t >= startMs && t <= endMs;
    }).length;
  }, [calendar, draftRange]);

  const draftPeriod = useMemo(() => {
    const start = publishedUntil
      ? (() => {
          const d = new Date(publishedUntil);
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + 1);
          return d;
        })()
      : (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return d;
        })();
    const end = new Date(start);
    end.setDate(end.getDate() + draftWeeks * 7 - 1);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString(), startDate: start, endDate: end };
  }, [draftWeeks, publishedUntil]);

  const saveTemplate = async () => {
    const token = getToken();
    if (!token) return;
    if (workSlots.length === 0) {
      setMessage('Отметьте хотя бы один рабочий день');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api.specialistSetWorkSchedule(
        token,
        normalizeSlots(workSlots),
      );
      setWorkSlots(saved);
      setMessage('Шаблон сохранён');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async () => {
    const token = getToken();
    if (!token) return;
    if (workSlots.length === 0) {
      setMessage('Отметьте хотя бы один рабочий день');
      return;
    }
    setBusy(true);
    setMessage('');
    setPublishAck(false);
    try {
      const saved = await api.specialistSetWorkSchedule(
        token,
        normalizeSlots(workSlots),
      );
      setWorkSlots(saved);
      const filled = await api.specialistFillFromTemplate(
        token,
        draftPeriod.start,
        draftPeriod.end,
      );
      const outside =
        filled.bookingsOutsideHours && filled.bookingsOutsideHours > 0
          ? ` · ${filled.bookingsOutsideHours} записей вне новых часов`
          : '';
      setMessage(
        `Черновик: ${filled.createdBlocks} блоков (${formatShort(draftPeriod.start)} – ${formatShort(draftPeriod.end)})${outside}`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка черновика');
    } finally {
      setBusy(false);
    }
  };

  const publishDraft = async () => {
    const token = getToken();
    if (!token || !draftRange) return;
    if (!publishAck) {
      setMessage('Подтвердите, что график проверен');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const check = await api.specialistAvailabilityCheck(token, {
        startAt: draftRange.start.toISOString(),
        endAt: draftRange.end.toISOString(),
      });
      if (check.overlaps?.length) {
        const names = check.overlaps
          .map((o) => o.specialistName)
          .filter(Boolean)
          .slice(0, 5)
          .join(', ');
        const ok = window.confirm(
          `Пересекается с другими специалистами (${names || 'коллеги'}). Всё равно опубликовать?`,
        );
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      const result = await api.specialistPublishSchedule(
        token,
        draftRange.start.toISOString(),
        draftRange.end.toISOString(),
      );
      setPublishAck(false);
      setMessage(
        `Опубликовано: ${result.publishedDays ?? result.publishedBlocks} дн.` +
          (result.bookingsInPublishedDays != null
            ? ` · записей в них: ${result.bookingsInPublishedDays}`
            : ''),
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold sm:text-xl">График работы</h2>
        <Link
          href="/specialist/schedule"
          className="btn-secondary !px-3 !py-1.5 text-sm"
        >
          В журнал
        </Link>
      </div>

      {message ? (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-300">
          {message}
        </p>
      ) : null}

      <section className="card space-y-2 !p-3 text-sm">
        <p className="font-medium">Статус</p>
        <p className="text-slate-300">
          {publishedUntil
            ? `Опубликовано до ${publishedUntil.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
              })}`
            : 'Пока ничего не опубликовано — клиенты не видят свободное время'}
        </p>
        {draftRange ? (
          <p className="text-amber-200/90">
            Черновик {formatShort(draftRange.start.toISOString())} –{' '}
            {formatShort(draftRange.end.toISOString())} · {draftRange.dayCount}{' '}
            раб. дн. · {draftBookingCount} записей внесено · клиенты не видят
          </p>
        ) : (
          <p className="text-slate-500">Черновика нет</p>
        )}
        {calendar?.lastPublication?.publishedAt ? (
          <p className="text-xs text-slate-500">
            Последняя публикация{' '}
            {formatDateTime(calendar.lastPublication.publishedAt)}
          </p>
        ) : null}
      </section>

      <SpaHoursEditor
        workSlots={workSlots}
        onChange={setWorkSlots}
        busy={busy}
        draftBlockCount={calendar?.draftBlockCount}
        lastPublicationAt={calendar?.lastPublication?.publishedAt}
        onSaveTemplate={saveTemplate}
        onCreateDraft={createDraft}
        createDraftLabel={`Создать черновик (${draftWeeks} нед.)`}
        defaultOpen
      />

      <section className="card !p-3 space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="text-slate-400">Недель в новом черновике</span>
          <input
            type="number"
            className="input max-w-[8rem]"
            min={1}
            max={12}
            value={draftWeeks}
            disabled={busy}
            onChange={(e) =>
              setDraftWeeks(
                Math.max(1, Math.min(12, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
        <p className="text-xs text-slate-500">
          Период:{' '}
          {draftPeriod.startDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
          })}{' '}
          –{' '}
          {draftPeriod.endDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
          })}
          {publishedUntil
            ? ' (после уже опубликованного горизонта)'
            : ' (с сегодня)'}
          . Опубликованные дни не перезаписываются.
        </p>
      </section>

      {draftRange ? (
        <section className="card space-y-3 !p-3">
          <p className="font-medium">Перед публикацией</p>
          <Link
            href={`/specialist/schedule?day=${draftRange.firstDayKey}`}
            className="btn-secondary inline-flex text-sm"
          >
            Внести постоянных клиентов
          </Link>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={publishAck}
              onChange={(e) => setPublishAck(e.target.checked)}
            />
            <span>
              Я проверил график и внёс постоянных клиентов. После публикации
              свободное время увидят все клиенты.
            </span>
          </label>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || !publishAck}
            onClick={() => void publishDraft()}
          >
            Опубликовать график
          </button>
        </section>
      ) : null}

      <SpaSpecialistShiftMonth
        defaultOpen
        onChanged={async () => {
          await reload();
        }}
      />
    </div>
  );
}
