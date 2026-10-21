import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type {
  AnalyticsCompareMode,
  AnalyticsDepartment,
  UpsertCompetitorPriceDto,
  UpsertSaleWindowDto,
  UpsertSegmentCompetitorDto,
} from '@fitgo/shared-types';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AdminTaskReportService } from './admin-task-report.service';
import { ClubAnalyticsService } from './club-analytics.service';
import { PricingAnalyticsService } from './pricing-analytics.service';
import { StaffAnalyticsService } from './staff-analytics.service';

@Controller('super-admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
export class AnalyticsController {
  constructor(
    private readonly club: ClubAnalyticsService,
    private readonly staff: StaffAnalyticsService,
    private readonly taskReport: AdminTaskReportService,
    private readonly pricing: PricingAnalyticsService,
  ) {}

  @Get('club')
  clubReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('compare') compare?: AnalyticsCompareMode,
    @Query('cmpFrom') cmpFrom?: string,
    @Query('cmpTo') cmpTo?: string,
    @Query('includePay') includePay?: string,
  ) {
    return this.club.getClubReport(user, {
      from,
      to,
      compare,
      cmpFrom,
      cmpTo,
      includePay: includePay === '1' || includePay === 'true',
    });
  }

  @Get('staff')
  staffReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('department') department?: AnalyticsDepartment,
    @Query('userId') userId?: string,
    @Query('includePay') includePay?: string,
  ) {
    return this.staff.getStaffReport(user, {
      from,
      to,
      department,
      userId,
      includePay: includePay === '1' || includePay === 'true',
    });
  }

  @Get('staff/manager-efficiency')
  @Roles(UserRole.SUPER_ADMIN)
  managerEfficiency(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!user.roles.includes(UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException();
    }
    return this.staff.getManagerEfficiency(user, { from, to });
  }

  @Get('staff.xlsx')
  async staffXlsx(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('department') department?: AnalyticsDepartment,
    @Query('userId') userId?: string,
    @Query('includePay') includePay?: string,
    @Res() res?: Response,
  ) {
    const buf = await this.staff.exportStaffXlsx(user, {
      from,
      to,
      department,
      userId,
      includePay: includePay === '1' || includePay === 'true',
    });
    res!.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res!.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics_staff_${from}_${to}.xlsx"`,
    );
    res!.send(buf);
  }

  @Get('tasks')
  taskWorkReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.taskReport.getReport(user, { from, to });
  }

  @Get('tasks.xlsx')
  async taskWorkXlsx(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res?: Response,
  ) {
    const buf = await this.taskReport.exportXlsx(user, { from, to });
    res!.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res!.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics_tasks_${from}_${to}.xlsx"`,
    );
    res!.send(buf);
  }

  @Get('market')
  marketReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('compare') compare?: AnalyticsCompareMode,
  ) {
    return this.pricing.getReport(user, { from, to, compare });
  }

  @Post('market/competitors')
  addCompetitor(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpsertSegmentCompetitorDto,
  ) {
    return this.pricing.addCompetitor(user, body);
  }

  @Delete('market/competitors/:id')
  deleteCompetitor(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.pricing.deleteCompetitor(user, id);
  }

  @Put('market/competitor-prices')
  upsertCompetitorPrice(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpsertCompetitorPriceDto,
  ) {
    return this.pricing.upsertCompetitorPrice(user, body);
  }

  @Post('market/sale-windows')
  addSaleWindow(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpsertSaleWindowDto,
  ) {
    return this.pricing.addSaleWindow(user, body);
  }

  @Delete('market/sale-windows/:id')
  deleteSaleWindow(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.pricing.deleteSaleWindow(user, id);
  }

  @Post('market/discounts/refresh')
  refreshDiscounts(
    @CurrentUser() user: JwtPayload,
    @Body() body: { from: string; to: string },
  ) {
    return this.pricing.refreshDiscounts(user, body);
  }
}
