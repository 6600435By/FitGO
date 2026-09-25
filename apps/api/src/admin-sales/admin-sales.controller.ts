import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type {
  AdminSalePaymentFilter,
  AdminSaleType,
} from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { AdminSalesService } from './admin-sales.service';
import { AdminSalesSyncService } from './admin-sales-sync.service';
import { ClubRevenueService } from './club-revenue.service';
import { ClubRevenueSyncService } from './club-revenue-sync.service';

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
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminSalesController {
  constructor(
    private readonly sales: AdminSalesService,
    private readonly sync: AdminSalesSyncService,
    private readonly clubRevenue: ClubRevenueService,
    private readonly clubRevenueSync: ClubRevenueSyncService,
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

  @Post('sync')
  async syncNow(@CurrentUser() user: JwtPayload) {
    const clubId = requireClubId(user);
    const adminSales = await this.sync.syncClub(clubId, 'incremental');
    const clubRevenue = await this.clubRevenueSync.syncClub(
      clubId,
      'incremental',
    );
    return { adminSales, clubRevenue };
  }
}
