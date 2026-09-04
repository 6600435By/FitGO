import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminTaskStatus, MembershipStatus } from '@fitgo/shared-types';
import { AdminTaskStatus as PrismaAdminTaskStatus } from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDailyReportDto } from './dto/create-daily-report.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly notifications: NotificationsService,
  ) {}

  async getDashboard(user: JwtPayload) {
    const clubId = requireClubId(user);
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
    });

    const today = new Date().toISOString().slice(0, 10);

    const recentReports = await this.prisma.dailyReport.findMany({
      where: { clubId },
      orderBy: { date: 'desc' },
      take: 7,
    });

    const clients = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: 'CLIENT' } },
      },
    });

    const provider = this.fitness.getProvider();
    let activeMemberships = 0;
    let visitsToday = 0;
    let expiringSoon = 0;
    const expiringClients: Array<{
      id: string;
      name: string;
      membership: string;
      validUntil: string;
      daysLeft: number;
    }> = [];

    const clientData = club?.externalId && provider.getAllClientsMemberships
      ? await provider.getAllClientsMemberships(club.externalId)
      : [];

    for (const client of clients) {
      const externalId = client.externalId;
      if (!externalId) continue;

      const membership = await provider.getMembership(externalId);
      const visits = await provider.getVisits(externalId);

      if (membership?.status === MembershipStatus.ACTIVE) {
        activeMemberships++;
        const daysLeft = Math.floor(
          (new Date(membership.validUntil).getTime() - Date.now()) / 86400000,
        );
        if (daysLeft <= 14 && daysLeft >= 0) {
          expiringSoon++;
          expiringClients.push({
            id: externalId,
            name: `${client.firstName} ${client.lastName}`,
            membership: membership.name,
            validUntil: membership.validUntil,
            daysLeft,
          });
        }
      }

      visitsToday += visits.filter((v) => v.date === today).length;
    }

    const bookingsToday = clientData.length > 0
      ? Math.min(clients.length, 24)
      : visitsToday;

    const pendingCrmCount = await this.prisma.userClubMembership.count({
      where: {
        clubId,
        leftAt: null,
        crmStatus: 'PENDING_CRM',
      },
    });

    return {
      club: club
        ? {
            id: club.id,
            name: club.name,
            slug: club.slug,
            address: club.address ?? undefined,
            currency: club.currency,
          }
        : null,
      stats: {
        activeMemberships,
        visitsToday,
        revenueToday: recentReports[0]?.revenue ?? 0,
        expiringSoon,
        bookingsToday,
        pendingCrmCount,
      },
      expiringClients: expiringClients.slice(0, 10),
      funnel: await this.buildFunnel(clubId),
      recentReports,
    };
  }

  async getFunnel(user: JwtPayload) {
    return { funnel: await this.buildFunnel(requireClubId(user)) };
  }

  async getReports(user: JwtPayload) {
    const recentReports = await this.prisma.dailyReport.findMany({
      where: { clubId: requireClubId(user) },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return { recentReports };
  }

  private async buildFunnel(clubId: string) {
    const totalClients = await this.prisma.user.count({
      where: { clubId, roles: { some: { role: 'CLIENT' } } },
    });

    const provider = this.fitness.getProvider();
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    let withMembership = 0;
    let active = 0;

    if (club?.externalId && provider.getAllClientsMemberships) {
      const data = await provider.getAllClientsMemberships(club.externalId);
      withMembership = data.filter((c: { membershipName?: string }) => c.membershipName).length;
      active = data.filter(
        (c: { membershipStatus?: string }) =>
          c.membershipStatus === MembershipStatus.ACTIVE,
      ).length;
    }

    const trials = Math.max(1, Math.floor(totalClients * 0.6));
    const offers = Math.max(1, Math.floor(withMembership * 0.5));

    return [
      { stage: 'Новый лид', count: totalClients },
      { stage: 'Пробное занятие', count: trials },
      { stage: 'Предложение', count: offers },
      { stage: 'Оплата', count: active || withMembership },
    ];
  }

  async getAtRiskClients(user: JwtPayload) {
    const clients = await this.prisma.user.findMany({
      where: {
        clubId: requireClubId(user),
        roles: { some: { role: 'CLIENT' } },
      },
    });

    const provider = this.fitness.getProvider();
    const atRisk: Array<{
      id: string;
      userId: string;
      name: string;
      email: string;
      reason: string;
      daysInactive?: number;
      daysUntilExpiry?: number;
      membership?: string;
    }> = [];

    const today = new Date();

    for (const client of clients) {
      if (!client.externalId) continue;

      const [membership, visits] = await Promise.all([
        provider.getMembership(client.externalId),
        provider.getVisits(client.externalId),
      ]);

      const lastVisit = visits[0]?.date ? new Date(visits[0].date) : null;
      if (lastVisit) {
        const daysInactive = Math.floor(
          (today.getTime() - lastVisit.getTime()) / 86400000,
        );
        if (daysInactive >= 3) {
          atRisk.push({
            id: client.externalId,
            userId: client.id,
            name: `${client.firstName} ${client.lastName}`,
            email: client.email,
            reason: 'Не посещал клуб',
            daysInactive,
            membership: membership?.name,
          });
        }
      }

      if (membership?.status === MembershipStatus.ACTIVE) {
        const daysUntilExpiry = Math.floor(
          (new Date(membership.validUntil).getTime() - today.getTime()) / 86400000,
        );
        if (daysUntilExpiry <= 7 && daysUntilExpiry >= 0) {
          atRisk.push({
            id: client.externalId,
            userId: client.id,
            name: `${client.firstName} ${client.lastName}`,
            email: client.email,
            reason: 'Абонемент истекает',
            daysUntilExpiry,
            membership: membership.name,
          });
        }
      }
    }

    return atRisk;
  }

  async getAllClubs() {
    const clubs = await this.prisma.club.findMany({
      include: { theme: true },
      orderBy: { name: 'asc' },
    });
    return clubs.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      address: c.address ?? undefined,
      currency: c.currency,
      primaryColor: c.theme?.primaryColor ?? '#14b88a',
    }));
  }

  async sendReminder(user: JwtPayload, clientUserId: string, message?: string) {
    const text =
      message ??
      'Мы заметили, что вы давно не были в клубе. Запишитесь на тренировку!';
    return this.notifications.sendReminderToClient(clientUserId, text);
  }

  async createDailyReport(user: JwtPayload, dto: CreateDailyReportDto) {
    const clubId = requireClubId(user);
    const date = new Date(dto.date);

    return this.prisma.dailyReport.upsert({
      where: {
        clubId_date: {
          clubId,
          date,
        },
      },
      update: {
        revenue: dto.revenue,
        problems: dto.problems,
        ideas: dto.ideas,
        createdBy: user.sub,
      },
      create: {
        clubId,
        date,
        revenue: dto.revenue,
        problems: dto.problems,
        ideas: dto.ideas,
        createdBy: user.sub,
      },
    });
  }

  async getMyTasks(user: JwtPayload) {
    const tasks = await this.prisma.adminTask.findMany({
      where: { clubId: requireClubId(user), assigneeId: user.sub },
      include: { assignee: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    });

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status as AdminTaskStatus,
      dueAt: task.dueAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
      createdAt: task.createdAt.toISOString(),
    }));
  }

  async updateMyTask(user: JwtPayload, taskId: string, status: AdminTaskStatus) {
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, assigneeId: user.sub, clubId: requireClubId(user) },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    return this.prisma.adminTask.update({
      where: { id: taskId },
      data: {
        status: status as PrismaAdminTaskStatus,
        completedAt: status === AdminTaskStatus.DONE ? new Date() : null,
      },
    });
  }

  async getPendingCrmClients(user: JwtPayload) {
    const clubId = requireClubId(user);
    const rows = await this.prisma.userClubMembership.findMany({
      where: {
        clubId,
        leftAt: null,
        crmStatus: 'PENDING_CRM',
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            createdAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      phone: row.user.phone ?? undefined,
      email: row.user.email,
      joinedAt: row.joinedAt.toISOString(),
      lastCrmSyncAt: row.lastCrmSyncAt?.toISOString(),
      crmStatus: row.crmStatus,
    }));
  }

  async getClubProfile(user: JwtPayload) {
    const club = await this.prisma.club.findUnique({
      where: { id: requireClubId(user) },
      include: { theme: true },
    });
    if (!club) throw new NotFoundException('Клуб не найден');
    return {
      id: club.id,
      name: club.name,
      slug: club.slug,
      address: club.address ?? undefined,
      phone: club.phone ?? undefined,
      website: club.website ?? undefined,
      currency: club.currency,
      externalId: club.externalId ?? undefined,
      theme: {
        clubName: club.name,
        logoUrl: club.theme?.logoUrl ?? undefined,
        primaryColor: club.theme?.primaryColor ?? '#14b88a',
        address: club.address ?? undefined,
        phone: club.phone ?? undefined,
        website: club.website ?? undefined,
      },
    };
  }

  async updateClubProfile(
    user: JwtPayload,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      website?: string;
      logoUrl?: string;
      primaryColor?: string;
    },
  ) {
    const clubId = requireClubId(user);
    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.address !== undefined
          ? { address: data.address.trim() || null }
          : {}),
        ...(data.phone !== undefined ? { phone: data.phone.trim() || null } : {}),
        ...(data.website !== undefined
          ? { website: data.website.trim() || null }
          : {}),
      },
    });

    if (data.logoUrl !== undefined || data.primaryColor !== undefined) {
      await this.prisma.clubTheme.upsert({
        where: { clubId },
        update: {
          ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl || null } : {}),
          ...(data.primaryColor !== undefined
            ? { primaryColor: data.primaryColor }
            : {}),
        },
        create: {
          clubId,
          logoUrl: data.logoUrl || null,
          primaryColor: data.primaryColor ?? '#14b88a',
        },
      });
    }

    return this.getClubProfile(user);
  }
}
