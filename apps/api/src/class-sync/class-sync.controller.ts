import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { ClubSyncProfile, ClubSyncTrigger } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { ClubSyncOrchestrator } from '../club-sync/club-sync-orchestrator.service';
import { ClubSyncStatusService } from '../club-sync/club-sync-status.service';
import { ClassSessionsSyncService } from './class-sessions-sync.service';
import { HallVisitsSyncService } from './hall-visits-sync.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('super-admin/class-sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
export class ClassSyncController {
  constructor(
    private readonly classSessions: ClassSessionsSyncService,
    private readonly hallVisits: HallVisitsSyncService,
    private readonly prisma: PrismaService,
    private readonly clubSync: ClubSyncOrchestrator,
    private readonly clubSyncStatus: ClubSyncStatusService,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: JwtPayload) {
    const clubId = requireClubId(user);
    const [classes, visits] = await Promise.all([
      this.prisma.salesSyncState.findUnique({
        where: {
          clubId_resourceKey: { clubId, resourceKey: 'class_sessions' },
        },
      }),
      this.prisma.salesSyncState.findUnique({
        where: {
          clubId_resourceKey: { clubId, resourceKey: 'hall_visits' },
        },
      }),
    ]);
    return { classes, visits };
  }

  @Post('sessions')
  async syncSessions(
    @CurrentUser() user: JwtPayload,
    @Body()
    body?: { from?: string; to?: string; yearToDate?: boolean },
  ) {
    const clubId = requireClubId(user);
    if (body?.from && body?.to) {
      assertDate(body.from);
      assertDate(body.to);
      if (body.from > body.to) {
        throw new BadRequestException('from must be ≤ to');
      }
      return this.classSessions.syncClub(clubId, {
        from: body.from,
        to: body.to,
      });
    }
    return this.classSessions.syncClub(clubId, {
      forceYear: Boolean(body?.yearToDate),
    });
  }

  @Post('visits')
  async syncVisits(
    @CurrentUser() user: JwtPayload,
    @Body()
    body?: { from?: string; to?: string; yearToDate?: boolean },
  ) {
    const clubId = requireClubId(user);
    if (body?.from && body?.to) {
      assertDate(body.from);
      assertDate(body.to);
      if (body.from > body.to) {
        throw new BadRequestException('from must be ≤ to');
      }
      return this.hallVisits.syncClub(clubId, {
        from: body.from,
        to: body.to,
      });
    }
    return this.hallVisits.syncClub(clubId, {
      forceYear: Boolean(body?.yearToDate),
    });
  }

  /** Club-wide LIGHT sync (same as «Обновить из 1С»). */
  @Post('refresh-for-payroll')
  async refreshForPayroll(
    @CurrentUser() user: JwtPayload,
    @Body() body: { from: string; to: string; userId?: string },
  ) {
    const clubId = requireClubId(user);
    assertDate(body.from);
    assertDate(body.to);
    if (body.from > body.to) {
      throw new BadRequestException('from must be ≤ to');
    }

    let periodLocked = false;
    if (body.userId) {
      const lock = await this.prisma.payrollPeriodLock.findFirst({
        where: {
          clubId,
          userId: body.userId,
          periodFrom: { lte: new Date(`${body.to}T00:00:00`) },
          periodTo: { gte: new Date(`${body.from}T00:00:00`) },
        },
      });
      periodLocked = Boolean(lock);
    }

    const result = await this.clubSync.start(clubId, {
      trigger: ClubSyncTrigger.MANUAL,
      profile: ClubSyncProfile.LIGHT,
      userId: user.sub,
    });
    const status = await this.clubSyncStatus.status(clubId, {
      includeErrors: true,
    });

    return {
      ...result,
      ...status,
      periodLocked,
      message: periodLocked
        ? 'Период зафиксирован — сырые занятия обновятся из кэша, выплаченные цифры не меняются.'
        : 'Запущено обновление из 1С для клуба. Дождитесь «Данные на …».',
    };
  }
}

@Controller('admin/class-sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
export class AdminClassSyncController {
  constructor(
    private readonly clubSync: ClubSyncOrchestrator,
    private readonly clubSyncStatus: ClubSyncStatusService,
  ) {}

  @Post('refresh-for-payroll')
  async refreshForPayroll(
    @CurrentUser() user: JwtPayload,
    @Body() body: { from: string; to: string; userId?: string },
  ) {
    const clubId = requireClubId(user);
    assertDate(body.from);
    assertDate(body.to);
    const result = await this.clubSync.start(clubId, {
      trigger: ClubSyncTrigger.MANUAL,
      profile: ClubSyncProfile.LIGHT,
      userId: user.sub,
    });
    const status = await this.clubSyncStatus.status(clubId, {
      includeErrors: true,
    });
    return {
      ...result,
      ...status,
      message: 'Запущено обновление из 1С для клуба. Дождитесь «Данные на …».',
    };
  }
}

function assertDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`Invalid date: ${s}`);
  }
}
