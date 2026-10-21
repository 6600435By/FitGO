import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { minskDay } from '../discrepancies/discrepancies-period';
import { PrismaService } from '../prisma/prisma.service';

const TOUCH_THROTTLE_MS = 15 * 60 * 1000;
const MAX_CHUNK_MINUTES = 15;
/** Gap longer than this starts a new burst (no minutes credited). */
const SESSION_GAP_MS = 20 * 60 * 1000;
const ONLINE_MS = 20 * 60 * 1000;

const APP_STAFF_ROLES: Role[] = [
  Role.ADMIN,
  Role.MANAGER,
  Role.TRAINER,
  Role.SPECIALIST,
  Role.SUPER_ADMIN,
];

const CLIENT_ONLY = Role.CLIENT;

type TouchMem = { lastWriteAt: number; lastSeenAt: number };

@Injectable()
export class AppPresenceService {
  private readonly logger = new Logger(AppPresenceService.name);
  /** Per-process throttle: avoids DB writes more often than TOUCH_THROTTLE_MS. */
  private readonly touchMem = new Map<string, TouchMem>();

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget safe: never throws to caller paths that ignore result. */
  async recordLogin(userId: string, roles: Role[]): Promise<void> {
    if (!this.isStaffAppRole(roles)) return;
    const now = new Date();
    try {
      await this.prisma.appPresence.upsert({
        where: { userId },
        create: { userId, lastLoginAt: now, lastSeenAt: now },
        update: { lastLoginAt: now, lastSeenAt: now },
      });
      this.touchMem.set(userId, {
        lastWriteAt: now.getTime(),
        lastSeenAt: now.getTime(),
      });
    } catch (err) {
      this.logger.warn(
        `recordLogin failed user=${userId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Staff presence ping. Throttled in-process to once / 15 min.
   * Clients and TECH-only are ignored. JWT is never invalidated here.
   */
  async touch(userId: string, roles: string[]): Promise<{ ok: true }> {
    const prismaRoles = roles
      .map((r) => this.toPrismaRole(r))
      .filter((r): r is Role => r != null);
    if (!this.isStaffAppRole(prismaRoles)) {
      return { ok: true };
    }

    const now = Date.now();
    const mem = this.touchMem.get(userId);
    if (mem && now - mem.lastWriteAt < TOUCH_THROTTLE_MS) {
      return { ok: true };
    }

    // Reserve throttle slot immediately so concurrent pings do not stampede DB.
    // lastSeenAt 0 = unknown until writeTouch reads DB (e.g. after process restart).
    this.touchMem.set(userId, {
      lastWriteAt: now,
      lastSeenAt: mem?.lastSeenAt ?? 0,
    });

    void this.writeTouch(userId, now).catch((err) => {
      this.logger.warn(
        `touch write failed user=${userId}: ${err instanceof Error ? err.message : err}`,
      );
    });

    return { ok: true };
  }

  async getAppUsage(user: JwtPayload, daysRaw?: string) {
    const clubId = requireClubId(user);
    const days = daysRaw === '30' ? 30 : 7;
    const now = new Date();
    const today = minskDay(now);
    const fromDay = this.addMinskDays(today, -(days - 1));
    const onlineCutoff = new Date(now.getTime() - ONLINE_MS);
    const todayStart = this.minskDayStartUtc(today);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const staff = await this.prisma.user.findMany({
      where: {
        clubId,
        archivedAt: null,
        roles: { some: { role: { in: APP_STAFF_ROLES } } },
      },
      include: {
        roles: true,
        appPresence: true,
        appPresenceDays: {
          where: { day: { gte: fromDay, lte: today } },
          select: { day: true, activeMinutes: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const staffRows = staff
      .filter((m) => m.roles.some((r) => APP_STAFF_ROLES.includes(r.role)))
      .map((m) => {
        const minutes = m.appPresenceDays.reduce(
          (sum, d) => sum + d.activeMinutes,
          0,
        );
        const lastSeenAt = m.appPresence?.lastSeenAt?.toISOString() ?? null;
        const lastLoginAt = m.appPresence?.lastLoginAt?.toISOString() ?? null;
        const primaryRole =
          m.roles.find((r) => APP_STAFF_ROLES.includes(r.role))?.role ??
          m.roles[0]?.role ??
          'TRAINER';
        return {
          userId: m.id,
          name: `${m.lastName} ${m.firstName}`.trim(),
          role: primaryRole,
          loginEnabled: m.loginEnabled,
          lastLoginAt,
          lastSeenAt,
          activeMinutes: minutes,
          online: Boolean(
            m.appPresence?.lastSeenAt &&
              m.appPresence.lastSeenAt >= onlineCutoff,
          ),
        };
      })
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        const aT = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
        const bT = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
        return bT - aT;
      });

    const onlineNow = staffRows.filter((r) => r.online).length;
    const activeToday = staff.filter((m) => {
      const seen = m.appPresence?.lastSeenAt;
      return seen && seen >= todayStart;
    }).length;
    const silent7d = staffRows.filter((r) => {
      if (!r.lastSeenAt) return true;
      return Date.parse(r.lastSeenAt) < weekAgo.getTime();
    }).length;

    const [clientsActive, clientsShadow, clientsWithPush] = await Promise.all([
      this.prisma.user.count({
        where: {
          clubId,
          accountStatus: AccountStatus.ACTIVE,
          roles: { some: { role: CLIENT_ONLY } },
        },
      }),
      this.prisma.user.count({
        where: {
          clubId,
          accountStatus: AccountStatus.SHADOW,
          roles: { some: { role: CLIENT_ONLY } },
        },
      }),
      this.prisma.user.count({
        where: {
          clubId,
          roles: { some: { role: CLIENT_ONLY } },
          pushSubscriptions: { some: {} },
        },
      }),
    ]);

    return {
      days,
      asOf: now.toISOString(),
      staffSummary: {
        onlineNow,
        activeToday,
        silent7d,
        total: staffRows.length,
      },
      clients: {
        activeAccounts: clientsActive,
        shadowAccounts: clientsShadow,
        withPush: clientsWithPush,
      },
      staff: staffRows,
    };
  }

  private async writeTouch(userId: string, nowMs: number): Promise<void> {
    const now = new Date(nowMs);
    const day = minskDay(now);

    const existing = await this.prisma.appPresence.findUnique({
      where: { userId },
    });
    const memSeen = this.touchMem.get(userId)?.lastSeenAt ?? 0;
    const prevSeenMs =
      (memSeen > 0 ? memSeen : null) ??
      existing?.lastSeenAt?.getTime() ??
      null;

    let addMinutes = 0;
    if (prevSeenMs != null) {
      const gap = nowMs - prevSeenMs;
      if (gap > 0 && gap <= SESSION_GAP_MS) {
        addMinutes = Math.min(
          Math.max(1, Math.ceil(gap / 60_000)),
          MAX_CHUNK_MINUTES,
        );
      }
    }

    if (addMinutes > 0) {
      await this.prisma.$transaction([
        this.prisma.appPresence.upsert({
          where: { userId },
          create: { userId, lastSeenAt: now },
          update: { lastSeenAt: now },
        }),
        this.prisma.appPresenceDay.upsert({
          where: { userId_day: { userId, day } },
          create: { userId, day, activeMinutes: addMinutes },
          update: { activeMinutes: { increment: addMinutes } },
        }),
      ]);
    } else {
      await this.prisma.appPresence.upsert({
        where: { userId },
        create: { userId, lastSeenAt: now },
        update: { lastSeenAt: now },
      });
    }

    this.touchMem.set(userId, { lastWriteAt: nowMs, lastSeenAt: nowMs });
  }

  private isStaffAppRole(roles: Role[]): boolean {
    return roles.some((r) => APP_STAFF_ROLES.includes(r));
  }

  private toPrismaRole(role: string): Role | null {
    const map: Record<string, Role> = {
      CLIENT: Role.CLIENT,
      TRAINER: Role.TRAINER,
      SPECIALIST: Role.SPECIALIST,
      TECH: Role.TECH,
      ADMIN: Role.ADMIN,
      MANAGER: Role.MANAGER,
      SUPER_ADMIN: Role.SUPER_ADMIN,
    };
    return map[role] ?? null;
  }

  private addMinskDays(day: string, delta: number): string {
    const [y, m, d] = day.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + delta));
    return utc.toISOString().slice(0, 10);
  }

  /** Start of Minsk calendar day as UTC Date (Minsk = UTC+3). */
  private minskDayStartUtc(day: string): Date {
    return new Date(`${day}T00:00:00+03:00`);
  }
}
