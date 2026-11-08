'use client';

import { useRouter } from 'next/navigation';
import {
  CalendarPlus,
  Lock,
  MessageSquare,
  NotebookPen,
  Play,
  UserPlus,
  Users,
} from 'lucide-react';
import { ResponsiveSheet, ListRow, ListGroup } from '@fitgo/forma-ui';
import type { TrainerCabinetMode } from '@/lib/trainer-cabinet';

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

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Быстрые действия"
      description="Частые задачи зала и кабинета"
      desktop="dialog"
    >
      <ListGroup>
        <ListRow
          title="Начать тренировку"
          subtitle="Ближайшая ПТ или группа · таймер"
          leading={<Play className="h-5 w-5 text-forma-400" />}
          chevron
          onClick={() => go('/trainer/live')}
        />
        {mode.showPt ? (
          <ListRow
            title="Записать на ПТ"
            subtitle="Клиент из базы или новый"
            leading={<CalendarPlus className="h-5 w-5 text-forma-400" />}
            chevron
            onClick={() => go('/trainer/schedule')}
          />
        ) : null}
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
  );
}
