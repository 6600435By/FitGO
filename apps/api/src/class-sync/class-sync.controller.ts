import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
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

  /** Refresh class sessions for payroll period, then return hint for UI. */
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

    const sync = await this.classSessions.syncClub(clubId, {
      from: body.from,
      to: body.to,
    });

    return {
      ...sync,
      periodLocked,
      message: periodLocked
        ? 'Период зафиксирован — сырые занятия обновлены, выплаченные цифры не меняются. Пересчитайте открытый период.'
        : sync.endpointMissing
          ? 'Шаблон GET /v1/class-sessions ещё не опубликован в 1С.'
          : `Обновлено занятий: ${sync.sessionsUpserted}. Можно пересчитать сотрудника.`,
    };
  }
}

@Controller('admin/class-sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
export class AdminClassSyncController {
  constructor(private readonly classSessions: ClassSessionsSyncService) {}

  @Post('refresh-for-payroll')
  async refreshForPayroll(
    @CurrentUser() user: JwtPayload,
    @Body() body: { from: string; to: string; userId?: string },
  ) {
    const clubId = requireClubId(user);
    assertDate(body.from);
    assertDate(body.to);
    const sync = await this.classSessions.syncClub(clubId, {
      from: body.from,
      to: body.to,
    });
    return {
      ...sync,
      message: sync.endpointMissing
        ? 'Шаблон GET /v1/class-sessions ещё не опубликован в 1С.'
        : `Обновлено занятий: ${sync.sessionsUpserted}.`,
    };
  }
}

function assertDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`Invalid date: ${s}`);
  }
}
