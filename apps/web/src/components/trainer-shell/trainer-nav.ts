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
  Scale,
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
  /** Dock center quick-actions (+) button */
  center?: boolean;
  /** Shown in desktop sidebar «Ещё» expanded, not in phone dock */
  moreOnly?: boolean;
  badgeKey?: 'messages' | 'timesheet';
};

/** Dynamic «Ещё» subtitle from items actually shown. */
export function trainerMoreSubtitle(items: TrainerNavItem[]): string {
  if (items.length === 0) return 'Дополнительные разделы';
  const labels = items.map((i) => i.label);
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} и ещё`;
}

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

  const quickAction: TrainerNavItem = {
    href: '#quick',
    label: 'Действия',
    icon: Plus,
    center: true,
  };

  const dock: TrainerNavItem[] = mode.clubPtDock
    ? [
        { href: '/trainer', label: 'Сегодня', icon: Home, exact: true },
        {
          href: scheduleHref,
          label: 'Расписание',
          icon: CalendarDays,
          module: 'trainer_calendar',
        },
        quickAction,
        {
          href: '/trainer/clients',
          label: 'Клиенты',
          icon: Users,
          // Always visible for «Тренер клуб» dock — CRM flag must not hide the tab.
        },
        {
          href: '/trainer/my-payments',
          label: 'Расчёты',
          icon: Scale,
        },
        {
          href: '/trainer/more',
          label: 'Ещё',
          icon: LayoutGrid,
        },
      ]
    : [
        { href: '/trainer', label: 'Сегодня', icon: Home, exact: true },
        {
          href: scheduleHref,
          label: 'Расписание',
          icon: CalendarDays,
          module: mode.showPt ? 'trainer_calendar' : undefined,
        },
        quickAction,
        {
          href: crm.href,
          label: crm.label,
          icon: crm.href.includes('clients') ? Users : ClipboardCheck,
          // Clients tab stays for PT cabinets even if trainer_crm module is off.
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
      label: 'Журнал',
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
  // Club dock already has «Расчёты»; other cabinets keep it in More.
  if (mode.showOwnLedger && !mode.clubPtDock) {
    more.push({
      href: '/trainer/my-payments',
      label: 'Расчёты',
      icon: Scale,
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
  if (item.href === '/trainer/my-payments') {
    return pathname.startsWith('/trainer/my-payments');
  }
  if (item.href === '/trainer/my-sessions') {
    return pathname.startsWith('/trainer/my-sessions');
  }
  return false;
}
