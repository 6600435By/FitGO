import { Injectable } from '@nestjs/common';
import { MembershipStatus, type GrowthInsight } from '@fitgo/shared-types';
import {
  AdminTaskStatus,
  PersonalBookingStatus,
  Role,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuperAdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  async getAnalytics(user: JwtPayload, periodDays = 30) {
    const clubId = requireClubId(user);
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - periodDays);
    const prevStart = new Date(periodStart);
    prevStart.setDate(prevStart.getDate() - periodDays);

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
    });

    const [visits, visitsPrev, reports, reportsPrev, ptCompleted, tasks, groupBookings] =
      await Promise.all([
        this.prisma.clubVisit.count({
          where: { user: { clubId: clubId }, visitedAt: { gte: periodStart } },
        }),
        this.prisma.clubVisit.count({
          where: {
            user: { clubId: clubId },
            visitedAt: { gte: prevStart, lt: periodStart },
          },
        }),
        this.prisma.dailyReport.findMany({
          where: { clubId: clubId, date: { gte: periodStart } },
        }),
        this.prisma.dailyReport.findMany({
          where: {
            clubId: clubId,
            date: { gte: prevStart, lt: periodStart },
          },
        }),
        this.prisma.personalTrainingBooking.count({
          where: {
            trainer: { clubId: clubId },
            status: PersonalBookingStatus.COMPLETED,
            endAt: { gte: periodStart },
          },
        }),
        this.prisma.adminTask.findMany({ where: { clubId: clubId } }),
        this.prisma.groupClassBooking.findMany({
          where: {
            client: { clubId: clubId },
            startAt: { gte: periodStart },
          },
        }),
      ]);

    const revenue = reports.reduce((sum, r) => sum + r.revenue, 0);
    const revenuePrev = reportsPrev.reduce((sum, r) => sum + r.revenue, 0);

    let activeMemberships = 0;
    let expiringSoon = 0;
    const provider = this.fitness.getProvider();
    const clients = await this.prisma.user.findMany({
      where: { clubId: clubId, roles: { some: { role: Role.CLIENT } } },
    });

    for (const client of clients) {
      if (!client.externalId) continue;
      const membership = await provider.getMembership(client.externalId);
      if (membership?.status === MembershipStatus.ACTIVE) {
        activeMemberships++;
        const daysLeft = Math.floor(
          (new Date(membership.validUntil).getTime() - now.getTime()) / 86400000,
        );
        if (daysLeft <= 7 && daysLeft >= 0) expiringSoon++;
      }
    }

    const trainerRankings = await this.buildTrainerRankings(clubId, periodStart);
    const groupDirectionLoad = this.buildGroupLoad(groupBookings);

    const doneTasks = tasks.filter((t) => t.status === AdminTaskStatus.DONE);
    const adminTasksDoneRate =
      tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 100;

    const insights = this.buildInsights({
      expiringSoon,
      revenue,
      revenuePrev,
      visits,
      visitsPrev,
      trainerRankings,
      groupDirectionLoad,
      tasks,
      now,
    });

    return {
      periodDays,
      kpis: {
        visits,
        visitsPrev,
        activeMemberships,
        expiringSoon,
        revenue,
        revenuePrev,
        personalSessionsCompleted: ptCompleted,
        adminTasksDoneRate,
      },
      trainerRankings,
      groupDirectionLoad,
      insights,
      integrationHealth: {
        provider: process.env.FITNESS_PROVIDER ?? 'mock',
        clubExternalId: club?.externalId ?? null,
        ok: this.isIntegrationHealthy(club?.externalId),
      },
    };
  }

  private async buildTrainerRankings(clubId: string, since: Date) {
    const trainers = await this.prisma.user.findMany({
      where: { clubId, roles: { some: { role: Role.TRAINER } } },
    });

    const rankings = await Promise.all(
      trainers.map(async (trainer) => {
        const [completedPt, clientIds] = await Promise.all([
          this.prisma.personalTrainingBooking.count({
            where: {
              trainerId: trainer.id,
              status: PersonalBookingStatus.COMPLETED,
              endAt: { gte: since },
            },
          }),
          this.prisma.personalTrainingBooking.findMany({
            where: { trainerId: trainer.id },
            distinct: ['clientId'],
            select: { clientId: true },
          }),
        ]);

        const score = completedPt * 2 + clientIds.length;
        return {
          trainerId: trainer.id,
          name: `${trainer.firstName} ${trainer.lastName}`.trim(),
          score,
          completedPt,
          activeClients: clientIds.length,
        };
      }),
    );

    return rankings.sort((a, b) => b.score - a.score);
  }

  private buildGroupLoad(
    bookings: Array<{ title: string }>,
  ): Array<{ title: string; bookings: number; loadPercent: number }> {
    const counts = new Map<string, number>();
    for (const b of bookings) {
      counts.set(b.title, (counts.get(b.title) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values(), 1);
    return [...counts.entries()]
      .map(([title, count]) => ({
        title,
        bookings: count,
        loadPercent: Math.round((count / max) * 100),
      }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 10);
  }

  private buildInsights(input: {
    expiringSoon: number;
    revenue: number;
    revenuePrev: number;
    visits: number;
    visitsPrev: number;
    trainerRankings: Array<{ name: string; completedPt: number }>;
    groupDirectionLoad: Array<{ title: string; loadPercent: number }>;
    tasks: Array<{ status: AdminTaskStatus; dueAt: Date | null }>;
    now: Date;
  }): GrowthInsight[] {
    const insights: GrowthInsight[] = [];

    if (input.expiringSoon >= 5) {
      insights.push({
        severity: 'warning',
        title: 'Много истекающих абонементов',
        body: `${input.expiringSoon} абонементов истекают в ближайшие 7 дней.`,
        action: 'Запустите кампанию продления через админов',
      });
    }

    if (input.revenuePrev > 0 && input.revenue < input.revenuePrev * 0.85) {
      insights.push({
        severity: 'critical',
        title: 'Снижение выручки',
        body: `Выручка за период на ${Math.round((1 - input.revenue / input.revenuePrev) * 100)}% ниже предыдущего.`,
        action: 'Проверьте DailyReport.problems и воронку',
      });
    }

    if (input.visitsPrev > 0 && input.visits < input.visitsPrev * 0.9) {
      insights.push({
        severity: 'warning',
        title: 'Меньше визитов',
        body: 'Посещаемость ниже прошлого периода.',
        action: 'Активируйте push-напоминания неактивным клиентам',
      });
    }

    const idleTrainer = input.trainerRankings.find((t) => t.completedPt === 0);
    if (idleTrainer) {
      insights.push({
        severity: 'info',
        title: 'Тренер без PT',
        body: `${idleTrainer.name} не провёл персональных тренировок за период.`,
        action: 'Проверьте график work slots',
      });
    }

    const lowLoad = input.groupDirectionLoad.find((g) => g.loadPercent < 40);
    if (lowLoad) {
      insights.push({
        severity: 'info',
        title: 'Низкая загрузка направления',
        body: `«${lowLoad.title}» — низкий спрос.`,
        action: 'Пересмотрите расписание или промо',
      });
    }

    const overdue = input.tasks.filter(
      (t) =>
        t.status !== AdminTaskStatus.DONE &&
        t.status !== AdminTaskStatus.CANCELLED &&
        t.dueAt &&
        t.dueAt < input.now,
    ).length;
    if (overdue > 0) {
      insights.push({
        severity: 'warning',
        title: 'Просроченные задачи админов',
        body: `${overdue} задач просрочено.`,
        action: 'Откройте раздел задач',
      });
    }

    return insights.slice(0, 8);
  }

  private isIntegrationHealthy(clubExternalId?: string | null) {
    const provider = process.env.FITNESS_PROVIDER ?? 'mock';
    if (provider === 'mock') return true;
    return !!clubExternalId;
  }
}
