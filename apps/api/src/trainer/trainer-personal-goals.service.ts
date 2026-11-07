import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PersonalBookingStatus,
  TrainerGoalMetric,
  TrainerOwnPackageStatus,
} from '@prisma/client';
import {
  TRAINER_GOAL_METRIC_LABELS,
  TRAINER_GOAL_METRICS,
  type TrainerGoalMetric as GoalMetric,
  type TrainerPersonalGoalInput,
  type TrainerPersonalGoalProgress,
  type TrainerPersonalGoalsResponse,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

const MAX_GOALS = 3;

function monthBounds(d = new Date()): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start, end, key };
}

function isGoalMetric(v: string): v is GoalMetric {
  return (TRAINER_GOAL_METRICS as string[]).includes(v);
}

@Injectable()
export class TrainerPersonalGoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGoals(user: JwtPayload): Promise<TrainerPersonalGoalsResponse> {
    const { start, end, key } = monthBounds();
    const rows = await this.prisma.trainerPersonalGoal.findMany({
      where: { trainerId: user.sub },
      orderBy: { createdAt: 'asc' },
    });
    const currents = await this.computeCurrents(user.sub, start, end);
    const goals: TrainerPersonalGoalProgress[] = rows.map((row) => {
      const metric = row.metric as GoalMetric;
      const current = currents[metric] ?? 0;
      const percent =
        row.target > 0
          ? Math.min(100, Math.round((current / row.target) * 1000) / 10)
          : 0;
      return {
        metric,
        label: TRAINER_GOAL_METRIC_LABELS[metric],
        target: row.target,
        current,
        percent,
        unit: metric === 'SALES_SUM' ? 'money_minor' : 'count',
      };
    });
    return { goals, month: key };
  }

  async putGoals(
    user: JwtPayload,
    goals: TrainerPersonalGoalInput[],
  ): Promise<TrainerPersonalGoalsResponse> {
    if (!Array.isArray(goals)) {
      throw new BadRequestException('goals must be an array');
    }
    if (goals.length > MAX_GOALS) {
      throw new BadRequestException(`Не больше ${MAX_GOALS} целей`);
    }
    const seen = new Set<string>();
    const cleaned: TrainerPersonalGoalInput[] = [];
    for (const g of goals) {
      if (!g || !isGoalMetric(g.metric)) {
        throw new BadRequestException('Неизвестная метрика');
      }
      if (seen.has(g.metric)) {
        throw new BadRequestException('Метрики не должны повторяться');
      }
      seen.add(g.metric);
      const target = Math.floor(Number(g.target));
      if (!Number.isFinite(target) || target < 1) {
        throw new BadRequestException('Цель должна быть ≥ 1');
      }
      cleaned.push({ metric: g.metric, target });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.trainerPersonalGoal.deleteMany({
        where: { trainerId: user.sub },
      });
      if (cleaned.length === 0) return;
      await tx.trainerPersonalGoal.createMany({
        data: cleaned.map((g) => ({
          trainerId: user.sub,
          metric: g.metric as TrainerGoalMetric,
          target: g.target,
        })),
      });
    });

    return this.getGoals(user);
  }

  private async computeCurrents(
    trainerId: string,
    start: Date,
    end: Date,
  ): Promise<Record<GoalMetric, number>> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const [
      ptSessions,
      salesAgg,
      activeFromBookings,
      activePackages,
      packagesSold,
      firstBookings,
    ] = await Promise.all([
      this.prisma.personalTrainingBooking.count({
        where: {
          trainerId,
          status: PersonalBookingStatus.COMPLETED,
          startAt: { gte: start, lt: end },
        },
      }),
      this.prisma.trainerClientPayment.aggregate({
        where: {
          trainerId,
          paidAt: { gte: start, lt: end },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId,
          status: { not: PersonalBookingStatus.CANCELLED },
          startAt: { gte: thirtyDaysAgo },
        },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      this.prisma.trainerClientPackage.findMany({
        where: {
          trainerId,
          status: TrainerOwnPackageStatus.ACTIVE,
          sessionsRemaining: { gt: 0 },
        },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      this.prisma.trainerClientPackage.count({
        where: {
          trainerId,
          soldAt: { gte: start, lt: end },
        },
      }),
      this.prisma.personalTrainingBooking.groupBy({
        by: ['clientId'],
        where: {
          trainerId,
          status: { not: PersonalBookingStatus.CANCELLED },
        },
        _min: { startAt: true },
      }),
    ]);

    const activeIds = new Set<string>();
    for (const r of activeFromBookings) activeIds.add(r.clientId);
    for (const r of activePackages) activeIds.add(r.clientId);

    let newClients = 0;
    for (const row of firstBookings) {
      const first = row._min.startAt;
      if (first && first >= start && first < end) newClients += 1;
    }

    return {
      PT_SESSIONS: ptSessions,
      SALES_SUM: salesAgg._sum.amountMinor ?? 0,
      ACTIVE_CLIENTS: activeIds.size,
      PACKAGES_SOLD: packagesSold,
      NEW_CLIENTS: newClients,
    };
  }
}
