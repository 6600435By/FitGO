import {
  DISCREPANCY_EXPIRING_PACKAGE_DAYS,
  type BookingControlFlag,
} from '@fitgo/shared-types';
import { daysBetween, parseDateLoose } from './discrepancies-period';

export type SessionMemberLike = {
  externalId: string;
  clientName?: string | null;
  attendance?: string;
  cancelled?: boolean;
  paySource?: string | null;
  paymentBasis?: string | null;
  bookedAt?: Date | null;
  packageDocId?: string | null;
  packageValidUntil?: string | null;
  createdAt?: Date;
  quantity?: number;
};

export type SessionLike = {
  externalId: string;
  kind: string;
  status: string;
  startAt: Date;
  endAt?: Date | null;
  employeeExternalId?: string | null;
  employeeName?: string | null;
  title?: string;
  /** When FitGO first saw the session (sync); gates the createdAt fallback. */
  createdAt?: Date;
  members: SessionMemberLike[];
};

/** Members synced within this window of the session row are the initial roster. */
const INITIAL_SYNC_SLACK_MS = 2 * 60 * 1000;

export type MembershipSnapLike = {
  clientExternalId: string;
  packageName?: string | null;
  endDate?: string | null;
};

/** Days left on package at session start. Null when unknown. */
export function packageDaysLeftAtSession(
  sessionStart: Date,
  member: SessionMemberLike,
  membershipByClient?: Map<string, MembershipSnapLike>,
): { daysLeft: number; approximate: boolean; validUntil: Date } | null {
  let validUntil = parseDateLoose(member.packageValidUntil ?? undefined);
  let approximate = false;
  if (!validUntil && membershipByClient) {
    const snap = membershipByClient.get(member.externalId);
    if (snap?.endDate) {
      const basis = (member.paymentBasis ?? '').toLowerCase();
      const pkg = (snap.packageName ?? '').toLowerCase();
      if (!basis || !pkg || basis.includes(pkg) || pkg.includes(basis)) {
        validUntil = parseDateLoose(snap.endDate);
        approximate = true;
      }
    }
  }
  if (!validUntil) return null;
  const daysLeft = daysBetween(sessionStart, validUntil);
  return { daysLeft, approximate, validUntil };
}

export function isExpiringPackageWriteOff(
  session: SessionLike,
  member: SessionMemberLike,
  membershipByClient?: Map<string, MembershipSnapLike>,
): {
  hit: boolean;
  approximate: boolean;
  daysLeft?: number;
  redReasons: string[];
} {
  if (member.cancelled) return { hit: false, approximate: false, redReasons: [] };
  if ((member.paySource ?? '').toUpperCase() !== 'PACKAGE') {
    return { hit: false, approximate: false, redReasons: [] };
  }
  const att = (member.attendance ?? '').toUpperCase();
  const writtenOff =
    att === 'ATTENDED' ||
    (session.status === 'COMPLETED' && att !== 'CANCELLED');
  if (!writtenOff) {
    return { hit: false, approximate: false, redReasons: [] };
  }

  const info = packageDaysLeftAtSession(
    session.startAt,
    member,
    membershipByClient,
  );
  if (!info) {
    return { hit: false, approximate: true, redReasons: [] };
  }
  if (info.daysLeft < 0 || info.daysLeft >= DISCREPANCY_EXPIRING_PACKAGE_DAYS) {
    return { hit: false, approximate: info.approximate, redReasons: [] };
  }

  const redReasons: string[] = [];
  const booked = memberBookedAt(session, member);
  if (booked && booked.at.getTime() > session.startAt.getTime()) {
    redReasons.push('LATE_BOOKING');
  }
  return {
    hit: true,
    approximate:
      info.approximate || !member.packageValidUntil || Boolean(booked?.approximate),
    daysLeft: info.daysLeft,
    redReasons,
  };
}

/**
 * Booking time from 1C; otherwise the member row's createdAt, but only when the
 * session was already in FitGO before it started and the member appeared in a
 * later sync. Otherwise createdAt is just the first-sync time and means nothing.
 */
export function memberBookedAt(
  session: SessionLike,
  member: SessionMemberLike,
): { at: Date; approximate: boolean } | null {
  if (member.bookedAt) return { at: member.bookedAt, approximate: false };
  const sessionSeen = session.createdAt;
  const memberSeen = member.createdAt;
  if (!sessionSeen || !memberSeen) return null;
  if (sessionSeen.getTime() >= session.startAt.getTime()) return null;
  if (memberSeen.getTime() - sessionSeen.getTime() < INITIAL_SYNC_SLACK_MS) {
    return null;
  }
  return { at: memberSeen, approximate: true };
}

export function isLateAddAfterEnd(
  session: SessionLike,
  member: SessionMemberLike,
): { late: boolean; during: boolean; approximate: boolean } {
  if (member.cancelled) return { late: false, during: false, approximate: false };
  const endAt = session.endAt ?? new Date(session.startAt.getTime() + 60 * 60000);
  const bookedInfo = memberBookedAt(session, member);
  if (!bookedInfo) {
    return { late: false, during: false, approximate: !member.bookedAt };
  }
  const booked = bookedInfo.at;
  const approximate = bookedInfo.approximate;
  if (booked.getTime() > endAt.getTime()) {
    return { late: true, during: false, approximate };
  }
  if (
    booked.getTime() >= session.startAt.getTime() &&
    booked.getTime() <= endAt.getTime()
  ) {
    return { late: false, during: true, approximate };
  }
  return { late: false, during: false, approximate };
}

export function sessionMatchesFlag(
  session: SessionLike,
  flag: BookingControlFlag,
  membershipByClient?: Map<string, MembershipSnapLike>,
): boolean {
  if (flag === 'LATE_ADD') {
    if (session.kind !== 'GROUP') return false;
    return session.members.some((m) => isLateAddAfterEnd(session, m).late);
  }
  if (flag === 'EXPIRING_PACKAGE') {
    if (session.kind !== 'SPA' && session.kind !== 'PT') return false;
    return session.members.some(
      (m) => isExpiringPackageWriteOff(session, m, membershipByClient).hit,
    );
  }
  return false;
}
