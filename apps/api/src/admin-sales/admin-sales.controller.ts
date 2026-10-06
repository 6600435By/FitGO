import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type {
  AdminSalePaymentFilter,
  AdminSaleType,
  ClubRevenueManualKind,
} from '@fitgo/shared-types';
import { ClubSyncProfile, ClubSyncTrigger } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { ClubSyncOrchestrator } from '../club-sync/club-sync-orchestrator.service';
import { ClubSyncStatusService } from '../club-sync/club-sync-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSalesService } from './admin-sales.service';
import { AdminSalesSyncService } from './admin-sales-sync.service';
import { ClubRevenueService } from './club-revenue.service';
import { ClubRevenueSyncService } from './club-revenue-sync.service';
import {
  SalesBackfillService,
  type StartBackfillBody,
} from './sales-backfill.service';

/** Browser / proxy often cut long syncs (~90s+) → opaque «Ошибка 500». */
const SYNC_STALE_MS = 15 * 60 * 1000;
/** After API restart DB may still say running — reclaim if no in-process lock. */
const SYNC_ORPHAN_MS = 90 * 1000;

function assertPeriod(from?: string, to?: string) {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new BadRequestException('from/to YYYY-MM-DD required');
  }
}

@Controller('admin/sales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminSalesController {
  constructor(private readonly sales: AdminSalesService) {}

  @Get('mine')
  mine(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('saleType') saleType?: AdminSaleType | 'all',
    @Query('payment') payment?: AdminSalePaymentFilter,
  ) {
    assertPeriod(from, to);
    return this.sales.mySales(requireClubId(user), user.sub, {
      from,
      to,
      saleType,
      payment,
    });
  }
}

@Controller('super-admin/sales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
export class SuperAdminSalesController {
  private readonly logger = new Logger(SuperAdminSalesController.name);
  private readonly syncInFlight = new Set<string>();

  constructor(
    private readonly sales: AdminSalesService,
    private readonly sync: AdminSalesSyncService,
    private readonly clubRevenue: ClubRevenueService,
    private readonly clubRevenueSync: ClubRevenueSyncService,
    private readonly backfill: SalesBackfillService,
    private readonly prisma: PrismaService,
    private readonly clubSync: ClubSyncOrchestrator,
    private readonly clubSyncStatus: ClubSyncStatusService,
  ) {}

  @Get('club')
  clubReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('operationType') operationType?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('employeeExternalId') employeeExternalId?: string,
    @Query('q') q?: string,
  ) {
    assertPeriod(from, to);
    return this.clubRevenue.report(requireClubId(user), {
      from,
      to,
      operationType,
      paymentMethod,
      employeeExternalId,
      q,
    });
  }

  @Get('club/:id')
  clubDetail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.clubRevenue.detail(requireClubId(user), id);
  }

  @Get()
  overview(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('saleType') saleType?: AdminSaleType | 'all',
    @Query('payment') payment?: AdminSalePaymentFilter,
    @Query('q') q?: string,
  ) {
    assertPeriod(from, to);
    return this.sales.overview(requireClubId(user), {
      from,
      to,
      saleType,
      payment,
      q,
    });
  }

  @Get('staff/:userId')
  staffDetail(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('saleType') saleType?: AdminSaleType | 'all',
    @Query('payment') payment?: AdminSalePaymentFilter,
  ) {
    assertPeriod(from, to);
    return this.sales.staffDetail(requireClubId(user), userId, {
      from,
      to,
      saleType,
      payment,
    });
  }

  @Post('club/manual')
  addManual(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      kind?: ClubRevenueManualKind;
      amount?: number;
      entryDate?: string;
      note?: string;
    },
  ) {
    if (!body.kind || body.amount == null || !body.entryDate) {
      throw new BadRequestException('kind, amount, entryDate required');
    }
    return this.clubRevenue.addManual(requireClubId(user), user.sub, {
      kind: body.kind,
      amountMajor: body.amount,
      entryDate: body.entryDate,
      note: body.note,
    });
  }

  @Delete('club/manual/:id')
  deleteManual(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.clubRevenue.deleteManual(requireClubId(user), id);
  }

  @Get('sync-status')
  syncStatus(@CurrentUser() user: JwtPayload) {
    return this.readSyncStatus(requireClubId(user));
  }

  /**
   * Historical load 2018–sealed (no debt) then 2025–to (still no debt).
   * Operational sync keeps current window + debt. Re-run mutable after 1C cleanup:
   * `{ "mode": "mutable-refresh" }`.
   */
  @Post('backfill')
  startBackfill(
    @CurrentUser() user: JwtPayload,
    @Body() body: StartBackfillBody,
  ) {
    return this.backfill.start(requireClubId(user), body ?? {});
  }

  @Get('backfill-status')
  backfillStatus(@CurrentUser() user: JwtPayload) {
    return this.backfill.status(requireClubId(user));
  }

  @Post('backfill/stop')
  stopBackfill(@CurrentUser() user: JwtPayload) {
    return this.backfill.stop(requireClubId(user));
  }

  @Post('backfill/resume')
  resumeBackfill(@CurrentUser() user: JwtPayload) {
    return this.backfill.resume(requireClubId(user));
  }

  /**
   * Delegates to club-wide LIGHT sync (staff/sync/refresh).
   * Kept for existing admin sales UI buttons.
   */
  @Post('sync')
  async syncNow(@CurrentUser() user: JwtPayload) {
    const clubId = requireClubId(user);
    const bf = await this.backfill.status(clubId);
    if (bf.running) {
      throw new BadRequestException(
        'Идёт исторический backfill — дождитесь окончания или stop, затем «Обновить из 1С».',
      );
    }
    const result = await this.clubSync.start(clubId, {
      trigger: ClubSyncTrigger.MANUAL,
      profile: ClubSyncProfile.LIGHT,
      userId: user.sub,
    });
    const clubStatus = await this.clubSyncStatus.status(clubId, {
      includeErrors: true,
    });
    return {
      ...result,
      ...clubStatus,
      running: clubStatus.running,
      lastSyncedAt: clubStatus.dataAsOfIso,
      syncStatus: result.status,
    };
  }

  /** Clear leftover `running` rows after crash/restart (no in-process lock). */
  private async reclaimOrphanRunning(clubId: string) {
    if (this.syncInFlight.has(clubId)) return;
    const cutoff = new Date(Date.now() - SYNC_ORPHAN_MS);
    // Only operational keys — sales_backfill may run for hours.
    await this.prisma.salesSyncState.updateMany({
      where: {
        clubId,
        resourceKey: { in: ['admin_sales', 'club_revenue'] },
        lastStatus: 'running',
        OR: [{ lastRunAt: null }, { lastRunAt: { lt: cutoff } }],
      },
      data: {
        lastStatus: 'error',
        lastError: 'Синхронизация прервана (перезапуск API). Нажмите «Обновить из 1С» ещё раз.',
        lastRunAt: new Date(),
      },
    });
  }

  private async runSyncBackground(clubId: string) {
    try {
      try {
        await this.sync.syncClub(clubId, 'incremental');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.salesSyncState.updateMany({
          where: { clubId, resourceKey: 'club_revenue', lastStatus: 'running' },
          data: {
            lastStatus: 'error',
            lastError: message.slice(0, 500),
            lastRunAt: new Date(),
          },
        });
        throw err;
      }
      await this.clubRevenueSync.syncClub(clubId, 'incremental');
    } catch (err) {
      this.logger.error(
        `Background sales sync failed club=${clubId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    } finally {
      this.syncInFlight.delete(clubId);
    }
  }

  private async readSyncStatus(clubId: string) {
    const rows = await this.prisma.salesSyncState.findMany({
      where: {
        clubId,
        resourceKey: { in: ['admin_sales', 'club_revenue'] },
      },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.resourceKey, r]));
    const admin = byKey['admin_sales'];
    const revenue = byKey['club_revenue'];
    const now = Date.now();
    const isFreshRunning = (row?: (typeof rows)[number]) => {
      if (!row || row.lastStatus !== 'running' || !row.lastRunAt) return false;
      const age = now - row.lastRunAt.getTime();
      if (age >= SYNC_STALE_MS) return false;
      // Prefer in-process lock; otherwise only trust very recent DB mark.
      if (this.syncInFlight.has(clubId)) return true;
      return age < SYNC_ORPHAN_MS;
    };

    const running =
      this.syncInFlight.has(clubId) ||
      isFreshRunning(admin) ||
      isFreshRunning(revenue);

    const errors = [admin?.lastError, revenue?.lastError].filter(
      (e): e is string => !!e?.trim(),
    );
    const lastSuccessAt = [admin?.lastSuccessAt, revenue?.lastSuccessAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      running,
      adminStatus: admin?.lastStatus ?? null,
      revenueStatus: revenue?.lastStatus ?? null,
      error: errors[0] ?? null,
      lastSyncedAt: lastSuccessAt?.toISOString() ?? null,
    };
  }
}
