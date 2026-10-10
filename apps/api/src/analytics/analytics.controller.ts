import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { AnalyticsCompareMode, AnalyticsDepartment } from '@fitgo/shared-types';
import { ClubAnalyticsService } from './club-analytics.service';
import { StaffAnalyticsService } from './staff-analytics.service';

@Controller('super-admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
export class AnalyticsController {
  constructor(
    private readonly club: ClubAnalyticsService,
    private readonly staff: StaffAnalyticsService,
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
}
