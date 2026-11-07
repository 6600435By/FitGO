import { Injectable } from '@nestjs/common';
import {
  AvailabilityBlockKind,
  GroupClassSessionStatus,
  OnexClassKind,
  OnexClassStatus,
  PersonalBookingStatus,
  ServiceUsageStatus,
  SessionApprovalKind,
  TrainerDaySheetStatus,
  TrainerOwnPackageStatus,
} from '@prisma/client';
import {
  sessionApprovalPhase,
  type TrainerInsight,
  type TrainerInsightsResponse,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClubMembershipService } from '../common/club-membership.service';
import { FeaturesService } from '../features/features.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrainerMonthAnalyticsService } from '../analytics/trainer-month-analytics.service';
import { PT_CONTROL_LAUNCH_AT } from '../booking-control/pt-document-match';
import { TrainerRosterService } from './trainer-roster.service';
import {
  MS_DAY,
  daysUntilYmd,
  hasWorkoutPlan,
  isBirthdayThisWeek,
  matchesClientGhosting,
  matchesGoalDeadline,
  matchesHoldSlotFreed,
  matchesPackageExpiring,
  matchesVisitFrequencyDrop,
  parseGoalDeadlineYmd,
} from './trainer-insights.rules';

const MS_HOUR = 60 * 60_000;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayBounds(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  return {
    start: new Date(y, m - 1, d, 0, 0, 0, 0),
    end: new Date(y, m - 1, d, 23, 59, 59, 999),
  };
}

function clientName(c: { firstName: string; lastName: string }) {
  return `${c.firstName} ${c.lastName}`.trim();
}

@Injectable()
export class TrainerInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roster: TrainerRosterService,
    private readonly clubMembership: ClubMembershipService,
    private readonly trainerMonth: TrainerMonthAnalyticsService,
    private readonly features: FeaturesService,
  ) {}

  async listForTrainer(user: JwtPayload): Promise<TrainerInsightsResponse> {
    const membership = await this.clubMembership.getActiveMembership(user.sub);
    const clubId = membership?.clubId ?? user.clubId ?? null;
    const now = new Date();
    const today = localDateKey(now);
    const tomorrow = localDateKey(new Date(now.getTime() + MS_DAY));

    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        firstName: true,
        lastName: true,
        externalId: true,
        employeeCode: true,
        groupPrograms: true,
        trainerStaff: true,
        trainerClub: true,
        trainerReformers: true,
      },
    });

    const clients = await this.roster.listClients(user.sub, clubId);
    const dismissed = await this.prisma.trainerInsightDismissal.findMany({
      where: {
        trainerId: user.sub,
        dismissUntil: { gt: now },
      },
      select: { insightKey: true },
    });
    const dismissedKeys = new Set(dismissed.map((d) => d.insightKey));

    const insights: TrainerInsight[] = [];

    for (const c of clients) {
      if (c.rosterStatus === 'REJECTED') continue;
      const name = `${c.firstName} ${c.lastName}`.trim();

      const daysLeft = daysUntilYmd(c.membershipValidUntil, now);
      const lowSessions =
        c.sessionsRemaining != null && c.sessionsRemaining <= 2;
      if (
        matchesPackageExpiring({
          sessionsRemaining: c.sessionsRemaining,
          membershipValidUntil: c.membershipValidUntil,
          now,
        })
      ) {
        const key = `package_expiring:${c.id}`;
        if (!dismissedKeys.has(key)) {
          insights.push({
            key,
            kind: 'package_expiring',
            title: 'Пакет заканчивается',
            body: lowSessions
              ? `${name}: осталось ${c.sessionsRemaining} тренировок`
              : `${name}: до конца пакета ${daysLeft} дн.`,
            priority: 10,
            clientId: c.id,
            clientName: name,
            action: {
              label: 'Написать',
              href: `/trainer/clients/${c.id}`,
              messageTemplate: `${c.firstName}, пакет скоро закончится — давайте продлим, чтобы не терять ритм тренировок.`,
            },
          });
        }
      }

      const visitRef = c.lastHallVisit ?? c.lastVisit;
      const visitDays = daysUntilYmd(visitRef, now);
      if (matchesClientGhosting({ lastVisitYmd: visitRef, now })) {
        const key = `client_ghosting:${c.id}`;
        if (!dismissedKeys.has(key)) {
          insights.push({
            key,
            kind: 'client_ghosting',
            title: 'Клиент пропадает',
            body: `${name}: нет визита ${Math.abs(visitDays ?? 0)} дн.`,
            priority: 20,
            clientId: c.id,
            clientName: name,
            action: {
              label: 'Написать',
              href: `/trainer/clients/${c.id}`,
              messageTemplate: `${c.firstName}, давно не виделись в зале — как самочувствие? Готов подобрать удобное время.`,
            },
          });
        }
      }

      if (c.dateOfBirth && isBirthdayThisWeek(new Date(c.dateOfBirth + 'T12:00:00Z'), now)) {
        const key = `birthday:${c.id}:${today.slice(0, 7)}`;
        if (!dismissedKeys.has(key)) {
          insights.push({
            key,
            kind: 'birthday',
            title: 'День рождения на этой неделе',
            body: name,
            priority: 30,
            clientId: c.id,
            clientName: name,
            action: {
              label: 'Поздравить',
              href: `/trainer/clients/${c.id}`,
              messageTemplate: `${c.firstName}, с днём рождения! Пусть этот год будет сильным — жду на тренировке.`,
            },
          });
        }
      }

      if ((c.cancelNoShowCount ?? 0) >= 2) {
        const key = `cancel_streak:${c.id}`;
        if (!dismissedKeys.has(key)) {
          insights.push({
            key,
            kind: 'cancel_streak',
            title: 'Отмены и неявки',
            body: `${name}: ${c.cancelNoShowCount} за 90 дней`,
            priority: 25,
            clientId: c.id,
            clientName: name,
            action: {
              label: 'Открыть',
              href: `/trainer/clients/${c.id}`,
            },
          });
        }
      }

      const rosterDays = daysUntilYmd(c.inRosterSince?.slice(0, 10), now);
      if (rosterDays != null && rosterDays >= -14 && rosterDays <= 0) {
        // filled below after profile batch
      }
    }

    const clientIds = clients.map((c) => c.id);
    if (clientIds.length) {
      const [measurements, profiles, consecutive] = await Promise.all([
        this.prisma.clientMeasurement.findMany({
          where: { trainerId: user.sub, clientId: { in: clientIds } },
          orderBy: { recordedAt: 'desc' },
          distinct: ['clientId'],
          select: { clientId: true, recordedAt: true },
        }),
        this.prisma.clientTrainingProfile.findMany({
          where: { userId: { in: clientIds } },
          select: { userId: true },
        }),
        this.prisma.personalTrainingBooking.findMany({
          where: {
            trainerId: user.sub,
            clientId: { in: clientIds },
            startAt: { lt: now },
            OR: [
              { status: PersonalBookingStatus.CANCELLED },
              { usageStatus: { in: ['NO_SHOW', 'CANCELLED'] } },
              { status: { not: PersonalBookingStatus.CANCELLED } },
            ],
          },
          orderBy: { startAt: 'desc' },
          select: {
            clientId: true,
            status: true,
            usageStatus: true,
            startAt: true,
          },
        }),
      ]);

      const lastMeas = new Map(measurements.map((m) => [m.clientId, m.recordedAt]));
      const hasProfile = new Set(profiles.map((p) => p.userId));

      const lastTwoByClient = new Map<string, Array<{ bad: boolean }>>();
      for (const b of consecutive) {
        if (!b.clientId) continue;
        const list = lastTwoByClient.get(b.clientId) ?? [];
        if (list.length >= 2) continue;
        const bad =
          b.status === PersonalBookingStatus.CANCELLED ||
          b.usageStatus === 'NO_SHOW' ||
          b.usageStatus === 'CANCELLED';
        list.push({ bad });
        lastTwoByClient.set(b.clientId, list);
      }

      for (const c of clients) {
        if (c.rosterStatus === 'REJECTED') continue;
        const name = `${c.firstName} ${c.lastName}`.trim();
        const measAt = lastMeas.get(c.id);
        const measDays = measAt
          ? Math.floor((now.getTime() - measAt.getTime()) / MS_DAY)
          : 999;
        if (measDays >= 30) {
          const key = `no_measurement:${c.id}`;
          if (!dismissedKeys.has(key)) {
            insights.push({
              key,
              kind: 'no_measurement',
              title: 'Нет замера',
              body:
                measAt == null
                  ? `${name}: замеров ещё не было`
                  : `${name}: последний замер ${measDays} дн. назад`,
              priority: 40,
              clientId: c.id,
              clientName: name,
              action: {
                label: 'Открыть',
                href: `/trainer/clients/${c.id}`,
              },
            });
          }
        }

        const rosterDays = daysUntilYmd(c.inRosterSince?.slice(0, 10), now);
        if (
          rosterDays != null &&
          rosterDays >= -14 &&
          rosterDays <= 0 &&
          !hasProfile.has(c.id)
        ) {
          const key = `new_without_profile:${c.id}`;
          if (!dismissedKeys.has(key)) {
            insights.push({
              key,
              kind: 'new_without_profile',
              title: 'Новый клиент без анкеты',
              body: name,
              priority: 35,
              clientId: c.id,
              clientName: name,
              action: {
                label: 'Открыть',
                href: `/trainer/clients/${c.id}`,
              },
            });
          }
        }

        const lastTwo = lastTwoByClient.get(c.id);
        if (lastTwo && lastTwo.length === 2 && lastTwo.every((x) => x.bad)) {
          const key = `cancel_streak_pair:${c.id}`;
          if (!dismissedKeys.has(key) && !dismissedKeys.has(`cancel_streak:${c.id}`)) {
            insights.push({
              key,
              kind: 'cancel_streak',
              title: 'Две отмены подряд',
              body: name,
              priority: 22,
              clientId: c.id,
              clientName: name,
              action: {
                label: 'Открыть',
                href: `/trainer/clients/${c.id}`,
              },
            });
          }
        }
      }
    }

    const { start: tomStart, end: tomEnd } = dayBounds(tomorrow);
    const tomorrowPts = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: user.sub,
        status: { not: PersonalBookingStatus.CANCELLED },
        startAt: { gte: tomStart, lte: tomEnd },
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    for (const b of tomorrowPts) {
      if (hasWorkoutPlan(b.workoutSheet)) continue;
      const name = b.client ? clientName(b.client) : 'Клиент';
      const key = `pt_no_plan:${b.id}`;
      if (dismissedKeys.has(key)) continue;
      insights.push({
        key,
        kind: 'pt_no_plan',
        title: 'На завтра нет плана',
        body: `${name} · ${b.startAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
        priority: 15,
        clientId: b.clientId,
        clientName: name,
        action: {
          label: 'Скопировать прошлую',
          href: `/trainer/sessions/${b.id}?clientId=${b.clientId}`,
        },
      });
    }

    if (me?.groupPrograms || me?.trainerReformers) {
      const codes = [
        ...new Set(
          [me.externalId, me.employeeCode]
            .map((c) => c?.trim())
            .filter((c): c is string => !!c),
        ),
      ];
      if (clubId && codes.length) {
        const groups = await this.prisma.onexClassSession.findMany({
          where: {
            clubId,
            isActive: true,
            kind: OnexClassKind.GROUP,
            status: { not: OnexClassStatus.CANCELLED },
            employeeExternalId: { in: codes },
            startAt: { gte: tomStart, lte: tomEnd },
          },
          select: {
            id: true,
            title: true,
            startAt: true,
            bookedCount: true,
            capacity: true,
          },
        });
        for (const g of groups) {
          const cap = g.capacity ?? 0;
          if (cap <= 0) continue;
          const fill = ((g.bookedCount ?? 0) / cap) * 100;
          if (fill >= 50) continue;
          const key = `group_low_fill:${g.id}`;
          if (dismissedKeys.has(key)) continue;
          insights.push({
            key,
            kind: 'group_low_fill',
            title: 'Группа завтра заполнена слабо',
            body: `${g.title}: ${g.bookedCount ?? 0}/${cap} (${Math.round(fill)}%)`,
            priority: 28,
            action: {
              label: 'Расписание',
              href: '/trainer/gp-schedule',
            },
          });
        }
      }
    }

    if (me?.trainerStaff || me?.trainerClub) {
      const openSheets = await this.prisma.trainerDaySheet.findMany({
        where: {
          trainerId: user.sub,
          status: TrainerDaySheetStatus.DRAFT,
          date: {
            gte: new Date(now.getTime() - 14 * MS_DAY),
            lt: dayBounds(today).start,
          },
        },
        take: 3,
        orderBy: { date: 'desc' },
        select: { id: true, date: true },
      });
      if (openSheets.length) {
        const key = 'timesheet_open';
        if (!dismissedKeys.has(key)) {
          insights.push({
            key,
            kind: 'timesheet_open',
            title: 'Незакрытый табель',
            body: `Черновиков: ${openSheets.length}`,
            priority: 18,
            action: {
              label: 'Табель',
              href: '/trainer/pt-timesheet',
            },
          });
        }
      }
    }

    if (clubId && (me?.trainerStaff || me?.trainerClub || me?.trainerReformers)) {
      try {
        const monthStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
        const analytics = await this.trainerMonth.forTrainer(
          clubId,
          user.sub,
          monthStart,
          today,
        );
        if (
          analytics.ladder &&
          !analytics.ladder.isTop &&
          analytics.ladder.remaining != null &&
          analytics.ladder.remaining > 0 &&
          analytics.ladder.remaining <= 3
        ) {
          const key = `ladder_near:${analytics.to.slice(0, 7)}`;
          if (!dismissedKeys.has(key)) {
            insights.push({
              key,
              kind: 'ladder_near',
              title: 'Близко к следующей ступени',
              body: `Ещё ${analytics.ladder.remaining} до ${analytics.ladder.nextMinSessions}`,
              priority: 45,
              action: {
                label: 'Сегодня',
                href: '/trainer',
              },
            });
          }
        }
      } catch {
        // analytics optional
      }
    }

    if (
      clubId &&
      me?.trainerStaff &&
      (await this.features.isEnabled('trainer_pt_control'))
    ) {
      const cutoff = new Date(now.getTime() - 2 * MS_DAY);
      const orphanPts = await this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          status: { not: PersonalBookingStatus.CANCELLED },
          startAt: { lt: cutoff },
          createdAt: { gte: PT_CONTROL_LAUNCH_AT },
          linkedDocExternalId: null,
          docAutoLinkBlocked: false,
          ptFlow: { not: 'PERSONAL' },
        },
        take: 5,
        orderBy: { startAt: 'desc' },
        include: {
          client: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      for (const b of orphanPts) {
        const name = b.client ? clientName(b.client) : 'Клиент';
        const key = `pt_no_doc:${b.id}`;
        if (dismissedKeys.has(key)) continue;
        insights.push({
          key,
          kind: 'pt_no_doc',
          title: 'Нет основания в 1С',
          body: `${name} · больше 2 дней без документа`,
          priority: 12,
          clientId: b.clientId,
          clientName: name,
          action: {
            label: 'Контроль',
            href: '/trainer/my-sessions',
          },
        });
      }
    }

    if (me?.trainerClub) {
      const [debtors, ownPkgs] = await Promise.all([
        this.prisma.trainerClientBalance.findMany({
          where: { trainerId: user.sub, debtMinor: { gt: 0 } },
          take: 5,
          orderBy: { debtMinor: 'desc' },
          include: {
            client: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        this.prisma.trainerClientPackage.findMany({
          where: {
            trainerId: user.sub,
            status: TrainerOwnPackageStatus.ACTIVE,
            OR: [
              { sessionsRemaining: { lte: 2 } },
              {
                validUntil: {
                  lte: new Date(now.getTime() + 7 * MS_DAY),
                  gte: now,
                },
              },
            ],
          },
          take: 5,
          include: {
            client: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      ]);
      for (const d of debtors) {
        const name = clientName(d.client);
        const key = `ledger_debt:${d.clientId}`;
        if (dismissedKeys.has(key)) continue;
        insights.push({
          key,
          kind: 'ledger_debt',
          title: 'Клиент должен',
          body: `${name}: ${(d.debtMinor / 100).toFixed(2)} BYN`,
          priority: 16,
          clientId: d.clientId,
          clientName: name,
          action: {
            label: 'Мои оплаты',
            href: '/trainer/my-payments',
          },
        });
      }
      for (const p of ownPkgs) {
        const name = clientName(p.client);
        const key = `ledger_package_expiring:${p.id}`;
        if (dismissedKeys.has(key)) continue;
        insights.push({
          key,
          kind: 'ledger_package_expiring',
          title: 'Личный пакет заканчивается',
          body: `${name}: ${p.title} · осталось ${p.sessionsRemaining}`,
          priority: 17,
          clientId: p.clientId,
          clientName: name,
          action: {
            label: 'Мои оплаты',
            href: '/trainer/my-payments',
          },
        });
      }
    }

    const holds = await this.prisma.trainerAvailabilityBlock.findMany({
      where: {
        trainerId: user.sub,
        kind: 'HOLD_CLIENT',
        holdExpiresAt: {
          gt: now,
          lte: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        },
      },
      include: {
        holdClient: { select: { id: true, firstName: true, lastName: true } },
      },
      take: 5,
    });
    for (const hold of holds) {
      const name = hold.holdClient
        ? `${hold.holdClient.firstName} ${hold.holdClient.lastName}`.trim()
        : 'клиент';
      const key = `hold_expiring:${hold.id}`;
      if (dismissedKeys.has(key)) continue;
      insights.push({
        key,
        kind: 'hold_expiring',
        title: 'Резерв скоро освободится',
        body: `${name}: успейте подтвердить запись`,
        priority: 12,
        clientId: hold.holdClientId ?? undefined,
        clientName: name,
        action: {
          label: 'Расписание',
          href: '/trainer/schedule',
        },
      });
    }

    // Homework: stalled (no checks) and completed (praise).
    if (clientIds.length) {
      const homeworkRows = await this.prisma.clientHomework.findMany({
        where: {
          trainerId: user.sub,
          clientId: { in: clientIds },
          OR: [
            {
              status: 'ACTIVE',
              createdAt: { lte: new Date(now.getTime() - 2 * MS_DAY) },
            },
            {
              status: 'DONE',
              completedAt: { gte: new Date(now.getTime() - 3 * MS_DAY) },
            },
          ],
        },
        include: {
          client: { select: { id: true, firstName: true, lastName: true } },
          items: { include: { checks: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });

      const seenStalled = new Set<string>();
      const seenPraise = new Set<string>();
      for (const hw of homeworkRows) {
        const name = clientName(hw.client);
        const firstName = hw.client.firstName || name;
        const total = hw.items.length;
        const done = hw.items.filter(
          (item) =>
            item.checks.filter((c) => c.done).length >= item.timesRequired,
        ).length;

        if (hw.status === 'ACTIVE' && total > 0 && done === 0) {
          if (seenStalled.has(hw.clientId)) continue;
          seenStalled.add(hw.clientId);
          const key = `homework_stalled:${hw.id}`;
          if (dismissedKeys.has(key)) continue;
          insights.push({
            key,
            kind: 'homework_stalled',
            title: 'Клиент не выполняет задание',
            body: `${name}: 0 из ${total} · без отметок`,
            priority: 24,
            clientId: hw.clientId,
            clientName: name,
            action: {
              label: 'Написать',
              href: `/trainer/clients/${hw.clientId}`,
              messageTemplate: `${firstName}, как задание между тренировками — нужна помощь или упростим план?`,
            },
          });
        }

        if (hw.status === 'DONE' && total > 0 && done >= total) {
          if (seenPraise.has(hw.clientId)) continue;
          seenPraise.add(hw.clientId);
          const key = `homework_done_praise:${hw.id}`;
          if (dismissedKeys.has(key)) continue;
          insights.push({
            key,
            kind: 'homework_done_praise',
            title: 'Клиент выполнил задание',
            body: `${name}: ${done} из ${total} — похвалите`,
            priority: 26,
            clientId: hw.clientId,
            clientName: name,
            action: {
              label: 'Похвалить',
              href: `/trainer/clients/${hw.clientId}`,
              messageTemplate: `${firstName}, отлично закрыл(а) задание — видно прогресс, так держать!`,
            },
          });
        }
      }
    }

    // control_pending: staff PT «На проверке» (PENDING_ADMIN) > 2 days.
    if (
      clubId &&
      me?.trainerStaff &&
      (await this.features.isEnabled('trainer_pt_control'))
    ) {
      const cutoff = new Date(now.getTime() - 2 * MS_DAY);
      const pendingBookings = await this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          status: { not: PersonalBookingStatus.CANCELLED },
          startAt: {
            lt: cutoff,
            gte: new Date(now.getTime() - 30 * MS_DAY),
          },
          createdAt: { gte: PT_CONTROL_LAUNCH_AT },
          ptFlow: { not: 'PERSONAL' },
        },
        take: 40,
        orderBy: { startAt: 'desc' },
        include: {
          client: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      if (pendingBookings.length) {
        const approvals = await this.prisma.sessionApproval.findMany({
          where: {
            clubId,
            kind: SessionApprovalKind.PT,
            bookingId: { in: pendingBookings.map((b) => b.id) },
          },
        });
        const approvalByBooking = new Map(
          approvals.map((a) => [a.bookingId, a] as const),
        );
        for (const b of pendingBookings) {
          const appr = approvalByBooking.get(b.id);
          if (!appr?.performerConfirmedAt) continue;
          const phase = sessionApprovalPhase({
            performerConfirmedAt:
              appr.performerConfirmedAt?.toISOString() ?? null,
            adminApprovedAt: appr.adminApprovedAt?.toISOString() ?? null,
            overrideApprovedAt: appr.overrideApprovedAt?.toISOString() ?? null,
          });
          if (phase !== 'PENDING_ADMIN') continue;
          const name = b.client ? clientName(b.client) : 'Клиент';
          const key = `control_pending:${b.id}`;
          if (dismissedKeys.has(key)) continue;
          insights.push({
            key,
            kind: 'control_pending',
            title: 'На проверке больше 2 дней',
            body: `${name} · ждёт администратора`,
            priority: 13,
            clientId: b.clientId,
            clientName: name,
            action: {
              label: 'Контроль',
              href: '/trainer/my-sessions',
            },
          });
        }
      }
    }

    // goal_deadline: date in ClientGoal.target, or profile goalHorizonWeeks.
    if (clientIds.length) {
      const [goals, profiles] = await Promise.all([
        this.prisma.clientGoal.findMany({
          where: { trainerId: user.sub, clientId: { in: clientIds } },
          select: {
            id: true,
            clientId: true,
            title: true,
            target: true,
            client: { select: { firstName: true, lastName: true } },
          },
        }),
        this.prisma.clientTrainingProfile.findMany({
          where: {
            userId: { in: clientIds },
            goalHorizonWeeks: { not: null },
          },
          select: {
            userId: true,
            goalHorizonWeeks: true,
            updatedAt: true,
            primaryGoals: true,
            user: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);
      const seenGoalClients = new Set<string>();
      for (const g of goals) {
        if (!matchesGoalDeadline({ target: g.target, now })) continue;
        const ymd = parseGoalDeadlineYmd(g.target);
        const daysLeft = daysUntilYmd(ymd, now);
        if (seenGoalClients.has(g.clientId)) continue;
        seenGoalClients.add(g.clientId);
        const name = clientName(g.client);
        const key = `goal_deadline:${g.id}`;
        if (dismissedKeys.has(key)) continue;
        insights.push({
          key,
          kind: 'goal_deadline',
          title: 'Срок цели близко',
          body:
            daysLeft === 0
              ? `${name}: «${g.title}» — сегодня`
              : `${name}: «${g.title}» · через ${daysLeft} дн.`,
          priority: 27,
          clientId: g.clientId,
          clientName: name,
          action: {
            label: 'Написать',
            href: `/trainer/clients/${g.clientId}`,
            messageTemplate: `${g.client.firstName}, срок цели «${g.title}» уже близко — давайте сверим план на ближайшие тренировки.`,
          },
        });
      }
      for (const p of profiles) {
        if (seenGoalClients.has(p.userId)) continue;
        const weeks = p.goalHorizonWeeks ?? 0;
        if (weeks <= 0) continue;
        const deadline = new Date(
          p.updatedAt.getTime() + weeks * 7 * MS_DAY,
        );
        const daysLeft = Math.ceil(
          (deadline.getTime() - now.getTime()) / MS_DAY,
        );
        if (daysLeft < 0 || daysLeft > 14) continue;
        seenGoalClients.add(p.userId);
        const name = clientName(p.user);
        const goalLabel = p.primaryGoals[0]?.trim() || 'цель из анкеты';
        const key = `goal_deadline:profile:${p.userId}`;
        if (dismissedKeys.has(key)) continue;
        insights.push({
          key,
          kind: 'goal_deadline',
          title: 'Срок цели близко',
          body:
            daysLeft === 0
              ? `${name}: ${goalLabel} — сегодня`
              : `${name}: ${goalLabel} · через ${daysLeft} дн.`,
          priority: 27,
          clientId: p.userId,
          clientName: name,
          action: {
            label: 'Написать',
            href: `/trainer/clients/${p.userId}`,
            messageTemplate: `${p.user.firstName}, горизонт цели уже близко — давайте сверим прогресс и следующие шаги.`,
          },
        });
      }
    }

    // visit_frequency_drop: recent 14d vs prior 28d (not full ghosting).
    if (clientIds.length) {
      const since42 = new Date(now.getTime() - 42 * MS_DAY);
      const since14 = new Date(now.getTime() - 14 * MS_DAY);
      const ptVisits = await this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          clientId: { in: clientIds },
          startAt: { gte: since42, lt: now },
          status: {
            in: [
              PersonalBookingStatus.COMPLETED,
              PersonalBookingStatus.CONFIRMED,
            ],
          },
          usageStatus: {
            notIn: [ServiceUsageStatus.NO_SHOW, ServiceUsageStatus.CANCELLED],
          },
        },
        select: { clientId: true, startAt: true },
      });
      const recentBy = new Map<string, number>();
      const priorBy = new Map<string, number>();
      for (const b of ptVisits) {
        if (!b.clientId) continue;
        if (b.startAt >= since14) {
          recentBy.set(b.clientId, (recentBy.get(b.clientId) ?? 0) + 1);
        } else {
          priorBy.set(b.clientId, (priorBy.get(b.clientId) ?? 0) + 1);
        }
      }
      for (const c of clients) {
        if (c.rosterStatus === 'REJECTED') continue;
        const prior = priorBy.get(c.id) ?? 0;
        const recent = recentBy.get(c.id) ?? 0;
        const visitRef = c.lastHallVisit ?? c.lastVisit;
        if (
          !matchesVisitFrequencyDrop({
            prior28dCount: prior,
            recent14dCount: recent,
            lastVisitYmd: visitRef,
            now,
          })
        ) {
          continue;
        }
        const expected = prior / 2;
        const name = `${c.firstName} ${c.lastName}`.trim();
        const key = `visit_frequency_drop:${c.id}`;
        if (dismissedKeys.has(key)) continue;
        insights.push({
          key,
          kind: 'visit_frequency_drop',
          title: 'Упала частота визитов',
          body: `${name}: ${recent} за 2 нед. (было ~${Math.round(expected)} ожид.)`,
          priority: 21,
          clientId: c.id,
          clientName: name,
          action: {
            label: 'Написать',
            href: `/trainer/clients/${c.id}`,
            messageTemplate: `${c.firstName}, заметил(а), что тренировок стало меньше — всё в порядке? Могу подобрать более удобные окна.`,
          },
        });
      }
    }

    // group_journal_open: past own GP without submitted journal.
    if (clubId && (me?.groupPrograms || me?.trainerReformers)) {
      const codes = [
        ...new Set(
          [me.externalId, me.employeeCode]
            .map((c) => c?.trim())
            .filter((c): c is string => !!c),
        ),
      ];
      if (codes.length) {
        const weekAgo = new Date(now.getTime() - 7 * MS_DAY);
        const pastGroups = await this.prisma.onexClassSession.findMany({
          where: {
            clubId,
            isActive: true,
            kind: OnexClassKind.GROUP,
            status: { not: OnexClassStatus.CANCELLED },
            employeeExternalId: { in: codes },
            endAt: { lt: now, gte: weekAgo },
          },
          select: {
            id: true,
            externalId: true,
            title: true,
            startAt: true,
            endAt: true,
          },
          take: 20,
          orderBy: { startAt: 'desc' },
        });
        if (pastGroups.length) {
          const appointmentIds = pastGroups
            .map((g) => g.externalId)
            .filter((id): id is string => Boolean(id));
          const journals =
            appointmentIds.length === 0
              ? []
              : await this.prisma.groupClassSession.findMany({
                  where: {
                    clubId,
                    trainerId: user.sub,
                    appointmentId: { in: appointmentIds },
                  },
                  select: {
                    appointmentId: true,
                    status: true,
                    trainerSubmittedAt: true,
                  },
                });
          const journalByAppt = new Map(
            journals.map((j) => [j.appointmentId, j] as const),
          );
          let openCount = 0;
          for (const g of pastGroups) {
            if (!g.externalId) continue;
            const journal = journalByAppt.get(g.externalId);
            const submitted =
              journal != null &&
              journal.status !== GroupClassSessionStatus.OPEN &&
              (journal.trainerSubmittedAt != null ||
                journal.status === GroupClassSessionStatus.SUBMITTED ||
                journal.status === GroupClassSessionStatus.AUTO_READY ||
                journal.status === GroupClassSessionStatus.NEEDS_ADMIN ||
                journal.status === GroupClassSessionStatus.APPROVED ||
                journal.status === GroupClassSessionStatus.LOCKED);
            if (submitted) continue;
            openCount += 1;
            if (openCount > 3) continue;
            const key = `group_journal_open:${g.id}`;
            if (dismissedKeys.has(key)) continue;
            insights.push({
              key,
              kind: 'group_journal_open',
              title: 'Журнал группы не закрыт',
              body: `${g.title} · ${g.startAt.toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}`,
              priority: 19,
              action: {
                label: 'Журнал',
                href: '/trainer/group-journal',
              },
            });
          }
        }
      }
    }

    // hold_slot_freed: cancelled PT window overlaps an active client hold.
    {
      const cancelSince = new Date(now.getTime() - 2 * MS_DAY);
      const [cancelled, activeHolds] = await Promise.all([
        this.prisma.personalTrainingBooking.findMany({
          where: {
            trainerId: user.sub,
            status: PersonalBookingStatus.CANCELLED,
            updatedAt: { gte: cancelSince },
            startAt: { gte: now },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            client: { select: { firstName: true, lastName: true } },
          },
          take: 30,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.trainerAvailabilityBlock.findMany({
          where: {
            trainerId: user.sub,
            kind: AvailabilityBlockKind.HOLD_CLIENT,
            holdExpiresAt: { gt: now },
            endAt: { gt: now },
          },
          include: {
            holdClient: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          take: 20,
        }),
      ]);
      const seenHoldOffer = new Set<string>();
      for (const hold of activeHolds) {
        if (!hold.holdClient) continue;
        const match = cancelled.find((c) =>
          matchesHoldSlotFreed({
            cancelledStart: c.startAt,
            cancelledEnd: c.endAt,
            holdStart: hold.startAt,
            holdEnd: hold.endAt,
            holdExpiresAt: hold.holdExpiresAt,
            now,
          }),
        );
        if (!match) continue;
        const key = `hold_slot_freed:${hold.id}`;
        if (dismissedKeys.has(key) || seenHoldOffer.has(hold.id)) continue;
        seenHoldOffer.add(hold.id);
        const name = clientName(hold.holdClient);
        const when = hold.startAt.toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const hoursLeft = hold.holdExpiresAt
          ? Math.max(
              1,
              Math.round((hold.holdExpiresAt.getTime() - now.getTime()) / MS_HOUR),
            )
          : null;
        insights.push({
          key,
          kind: 'hold_slot_freed',
          title: 'Окно свободно — есть резерв',
          body: hoursLeft
            ? `${name} · ${when} · резерв ещё ~${hoursLeft} ч`
            : `${name} · ${when}`,
          priority: 11,
          clientId: hold.holdClientId ?? undefined,
          clientName: name,
          action: {
            label: 'Предложить',
            href: '/trainer/schedule',
            messageTemplate: `${hold.holdClient.firstName}, освободилось окно ${when} — записать вас?`,
          },
        });
      }
    }

    insights.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'ru'));

    return {
      insights,
      generatedAt: now.toISOString(),
    };
  }

  async dismiss(
    user: JwtPayload,
    insightKey: string,
    days = 3,
  ): Promise<{ ok: true; dismissUntil: string }> {
    const key = insightKey.trim().slice(0, 200);
    const safeDays = Math.min(30, Math.max(1, days || 3));
    const dismissUntil = new Date(Date.now() + safeDays * MS_DAY);
    await this.prisma.trainerInsightDismissal.upsert({
      where: {
        trainerId_insightKey: {
          trainerId: user.sub,
          insightKey: key,
        },
      },
      create: {
        trainerId: user.sub,
        insightKey: key,
        dismissUntil,
      },
      update: { dismissUntil },
    });
    return { ok: true, dismissUntil: dismissUntil.toISOString() };
  }

  /** Top insights for morning digest push (max 3). */
  async topInsightsForDigest(
    trainerId: string,
    clubId: string | null,
  ): Promise<TrainerInsight[]> {
    const fakeUser = {
      sub: trainerId,
      clubId: clubId ?? undefined,
    } as JwtPayload;
    const { insights } = await this.listForTrainer(fakeUser);
    return insights.slice(0, 3);
  }
}
