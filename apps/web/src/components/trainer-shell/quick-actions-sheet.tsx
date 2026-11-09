'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CalendarPlus,
  Lock,
  MessageSquare,
  NotebookPen,
  Play,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button, ResponsiveSheet, ListRow, ListGroup } from '@fitgo/forma-ui';
import type { FloorStaffHomeSession } from '@fitgo/shared-types';
import { liveHrefForSession } from '@/components/training-live/live-href';
import type { TrainerCabinetMode } from '@/lib/trainer-cabinet';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/** Upcoming within 45 min, or already in progress / up to 15 min late. */
const NEARBY_AHEAD_MS = 45 * 60 * 1000;
const NEARBY_LATE_MS = 15 * 60 * 1000;

function isNearbySession(
  s: FloorStaffHomeSession,
  nowMs = Date.now(),
): boolean {
  if (s.status === 'IN_PROGRESS') return true;
  if (s.status !== 'UPCOMING') return false;
  const start = Date.parse(s.startAt);
  if (!Number.isFinite(start)) return false;
  const delta = start - nowMs;
  return delta <= NEARBY_AHEAD_MS && delta >= -NEARBY_LATE_MS;
}

function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function sessionClientLabel(s: FloorStaffHomeSession): string {
  if (s.kind === 'GROUP') {
    return s.title || 'Групповое занятие';
  }
  return (s.subtitle || s.title || 'Клиент').trim();
}

export function QuickActionsSheet({
  open,
  onOpenChange,
  mode,
  onNoteMeasurement,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TrainerCabinetMode;
  onNoteMeasurement?: () => void;
}) {
  const router = useRouter();
  const [startBusy, setStartBusy] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [startCandidate, setStartCandidate] =
    useState<FloorStaffHomeSession | null>(null);
  const [startMessage, setStartMessage] = useState<string | null>(null);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const openStartConfirm = async () => {
    const token = getToken();
    if (!token) {
      go('/login');
      return;
    }
    setStartBusy(true);
    setStartMessage(null);
    setStartCandidate(null);
    try {
      const home = await api.trainerGpHome(token, { lite: true });
      const next = home.today.next ?? null;
      if (!next) {
        setStartMessage(
          'Подходящей тренировки рядом по времени нет — на сегодня ближайших записей нет.',
        );
        setStartConfirmOpen(true);
        return;
      }
      if (!isNearbySession(next)) {
        const when = formatSessionTime(next.startAt);
        const who = sessionClientLabel(next);
        setStartMessage(
          `Подходящей тренировки рядом по времени нет. Следующая — в ${when}: ${who}.`,
        );
        setStartConfirmOpen(true);
        return;
      }
      setStartCandidate(next);
      setStartConfirmOpen(true);
    } catch {
      setStartMessage('Не удалось загрузить расписание');
      setStartConfirmOpen(true);
    } finally {
      setStartBusy(false);
    }
  };

  const confirmStart = () => {
    if (!startCandidate) return;
    const href = liveHrefForSession(startCandidate);
    if (!href) {
      setStartMessage('Не удалось открыть режим тренировки');
      return;
    }
    const params = new URLSearchParams();
    if (startCandidate.title) params.set('title', startCandidate.title);
    if (startCandidate.clientId) {
      params.set('clientId', startCandidate.clientId);
    }
    const qs = params.toString();
    setStartConfirmOpen(false);
    onOpenChange(false);
    router.push(`${href}${qs ? `?${qs}` : ''}`);
  };

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Быстрые действия"
        description="Частые задачи зала и кабинета"
        desktop="dialog"
      >
        <ListGroup>
          {mode.showPt ? (
            <ListRow
              title="Записать на ПТ"
              subtitle="Клиент из базы или новый"
              leading={<CalendarPlus className="h-5 w-5 text-forma-400" />}
              chevron
              onClick={() => go('/trainer/schedule')}
            />
          ) : null}
          <ListRow
            title="Начать тренировку"
            subtitle="Ближайшая ПТ или группа · таймер"
            leading={<Play className="h-5 w-5 text-forma-400" />}
            chevron
            onClick={() => {
              if (startBusy) return;
              void openStartConfirm();
            }}
          />
          {mode.showPt ? (
            <ListRow
              title="Резерв или блок"
              subtitle="Закрепить время"
              leading={<Lock className="h-5 w-5 text-zinc-400" />}
              chevron
              onClick={() => go('/trainer/schedule')}
            />
          ) : null}
          {mode.showPt ? (
            <ListRow
              title="Добавить клиента"
              subtitle="В свою базу"
              leading={<UserPlus className="h-5 w-5 text-zinc-400" />}
              chevron
              onClick={() => go('/trainer/clients?add=1')}
            />
          ) : null}
          <ListRow
            title="Заметка или замер"
            subtitle="К клиенту · опционально к тренировке"
            leading={<NotebookPen className="h-5 w-5 text-zinc-400" />}
            chevron
            onClick={() => {
              onOpenChange(false);
              onNoteMeasurement?.();
            }}
          />
          <ListRow
            title="Сообщение клиенту"
            leading={<MessageSquare className="h-5 w-5 text-zinc-400" />}
            chevron
            onClick={() => go('/trainer/messages')}
          />
          {mode.showGp ? (
            <ListRow
              title="Отметить присутствие"
              subtitle="Групповое занятие"
              leading={<Users className="h-5 w-5 text-cyan-400" />}
              chevron
              onClick={() => go('/trainer/group-journal')}
            />
          ) : null}
        </ListGroup>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={startConfirmOpen}
        onOpenChange={(next) => {
          setStartConfirmOpen(next);
          if (!next) {
            setStartCandidate(null);
            setStartMessage(null);
          }
        }}
        title="Начать тренировку"
        description={
          startCandidate
            ? 'Проверьте, что запускаете нужную сессию'
            : 'Старт таймера'
        }
        desktop="dialog"
      >
        <div className="space-y-4 pb-2">
          {startCandidate ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                <p className="text-zinc-500">
                  {startCandidate.kind === 'GROUP' ? 'Группа' : 'ПТ'} ·{' '}
                  {formatSessionTime(startCandidate.startAt)}
                </p>
                <p className="mt-1 font-medium text-white">
                  {sessionClientLabel(startCandidate)}
                </p>
                {startCandidate.kind === 'GROUP' && startCandidate.subtitle ? (
                  <p className="mt-0.5 text-zinc-400">
                    {startCandidate.subtitle}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" className="w-full" onClick={confirmStart}>
                  Начать
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStartConfirmOpen(false)}
                >
                  Отмена
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-300">
                {startMessage ?? 'Нет подходящей тренировки'}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => setStartConfirmOpen(false)}
              >
                Понятно
              </Button>
            </>
          )}
        </div>
      </ResponsiveSheet>
    </>
  );
}
