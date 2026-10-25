/** Home dashboard for SPA specialists and group-program trainers. */

export type FloorStaffRole = 'SPECIALIST' | 'GROUP_TRAINER';

export interface FloorStaffHomeSession {
  id: string;
  /** Opaque key for booking-control deep links when available. */
  sessionKey?: string;
  title: string;
  startAt: string;
  endAt?: string;
  /** Client name (SPA) or room (GP). */
  subtitle?: string;
  booked?: number;
  capacity?: number;
  /** GROUP / PT when both appear on the trainer home list. */
  kind?: 'GROUP' | 'PT' | 'SPA';
  status: 'UPCOMING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
}

/** Conducted session counts for the current month (through today). */
export interface FloorStaffConductedCounts {
  from: string;
  to: string;
  group: number;
  pt: number;
}

export interface FloorStaffControlItem {
  sessionKey: string;
  title: string;
  startAt: string;
  subtitle?: string;
}

export interface FloorStaffControlQueue {
  /** Waiting for this staff member to confirm. */
  pendingMe: number;
  /** Already sent to admin, waiting for admin. */
  pendingAdmin: number;
  /** Oldest items waiting for me (max 3). */
  queue: FloorStaffControlItem[];
}

export interface FloorStaffMonthMetric {
  label: string;
  value: number | null;
  previous: number | null;
  /** Unit hint for display, e.g. «чел.», «%», «услуг». */
  unit?: string;
}

export interface FloorStaffMonthStats {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  metrics: FloorStaffMonthMetric[];
  /** Extra line under metrics, e.g. top direction. */
  footnote?: string;
}

export interface FloorStaffFreeWindow {
  startAt: string;
  endAt: string;
  minutes: number;
}

export interface FloorStaffSpaExtras {
  freeWindowsToday: FloorStaffFreeWindow[];
  waitlistCount: number;
}

export interface FloorStaffHome {
  role: FloorStaffRole;
  staffName: string;
  today: {
    date: string;
    count: number;
    next?: FloorStaffHomeSession | null;
    sessions: FloorStaffHomeSession[];
  };
  control: FloorStaffControlQueue;
  month: FloorStaffMonthStats;
  /** Trainer: completed GP / PT counts for deep-links into booking control. */
  conducted?: FloorStaffConductedCounts;
  spa?: FloorStaffSpaExtras;
}
