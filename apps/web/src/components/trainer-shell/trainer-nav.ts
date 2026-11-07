import type { LucideIcon } from 'lucide-react';
import {
  CalendarDays,
  ClipboardCheck,
  Home,
  LayoutGrid,
  MessageSquare,
  Plus,
  Users,
  Wallet,
  UserRound,
  NotebookPen,
  Clock3,
  BookOpen,
} from 'lucide-react';
import {
  trainerCabinetMode,
  trainerCrmOrControlHref,
  trainerScheduleHref,
  type TrainerCabinetFlags,
  type TrainerCabinetMode,
} from '@/lib/trainer-cabinet';

export type TrainerNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  module?: 'trainer_calendar' | 'trainer_crm' | 'messaging';
  /** Dock center raised button */
  center?: boolean;
  /** Shown in desktop sidebar «Ещё» expanded, not in phone dock */
  moreOnly?: boolean;
  badgeKey?: 'messages' | 'timesheet';
};

export function buildTrainerV2Nav(
  flags: TrainerCabinetFlags | null | undefined,
  isEnabled: (key: string) => boolean,
): {
  mode: TrainerCabinetMode;
  dock: TrainerNavItem[];
  more: TrainerNavItem[];
  all: TrainerNavItem[];
} {
  const mode = trainerCabinetMode(flags);
  const scheduleHref = trainerScheduleHref(mode);
  const crm = trainerCrmOrControlHref(mode);

  const dock: TrainerNavItem[] = [
    { href: '/trainer', label: 'Сегодня', icon: Home, exact: true },
    {
      href: scheduleHref,
      label: 'Расписание',
      icon: CalendarDays,
      module: mode.showPt ? 'trainer_calendar' : undefined,
    },
    {
      href: '#quick',
      label: 'Действия',
      icon: Plus,
      center: true,
    },
    {
      href: crm.href,
      label: crm.label,
      icon: crm.href.includes('clients') ? Users : ClipboardCheck,
      module: crm.href.includes('clients') ? 'trainer_crm' : undefined,
    },
    {
      href: '/trainer/more',
      label: 'Ещё',
      icon: LayoutGrid,
    },
  ];

  const more: TrainerNavItem[] = [];

  if (mode.showTimesheet) {
    more.push({
      href: '/trainer/pt-timesheet',
      label: 'Табель ПТ',
      icon: NotebookPen,
      badgeKey: 'timesheet',
    });
  }
  if (mode.showGp) {
    more.push({
      href: '/trainer/group-journal',
      label: 'Журнал групп',
      icon: BookOpen,
    });
    more.push({
      href: '/trainer/shifts',
      label: 'Смены',
      icon: Clock3,
    });
  }
  if (mode.showPtControl) {
    more.push({
      href: '/trainer/my-sessions',
      label: 'Контроль',
      icon: ClipboardCheck,
    });
  }
  if (mode.showPayroll) {
    more.push({
      href: '/trainer/payroll',
      label: 'ЗП',
      icon: Wallet,
    });
  }
  if (mode.showOwnLedger) {
    more.push({
      href: '/trainer/my-payments',
      label: 'Мои оплаты',
      icon: Wallet,
    });
  }
  more.push({
    href: '/trainer/messages',
    label: 'Сообщения',
    icon: MessageSquare,
    module: 'messaging',
    badgeKey: 'messages',
  });
  more.push({
    href: '/trainer/profile',
    label: 'Профиль',
    icon: UserRound,
  });

  const filterMod = (items: TrainerNavItem[]) =>
    items.filter((item) => !item.module || isEnabled(item.module));

  const dockFiltered = filterMod(dock);
  const moreFiltered = filterMod(more);

  return {
    mode,
    dock: dockFiltered,
    more: moreFiltered,
    all: [...dockFiltered.filter((d) => !d.center), ...moreFiltered],
  };
}

export function navItemActive(pathname: string, item: TrainerNavItem): boolean {
  if (item.center) return false;
  if (item.exact) return pathname === item.href;
  if (pathname === item.href) return true;
  if (item.href !== '/trainer' && pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  if (item.href === '/trainer/clients') {
    return pathname.startsWith('/trainer/clients');
  }
  if (item.href === '/trainer/schedule' || item.href === '/trainer/gp-schedule') {
    return (
      pathname.startsWith('/trainer/schedule') ||
      pathname.startsWith('/trainer/gp-schedule')
    );
  }
  return false;
}
