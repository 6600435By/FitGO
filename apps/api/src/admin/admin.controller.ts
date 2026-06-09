import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AdminService } from './admin.service';
import { CreateDailyReportDto } from './dto/create-daily-report.dto';
import { SendReminderDto } from './dto/send-reminder.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.adminService.getDashboard(user);
  }

  @Get('at-risk')
  getAtRisk(@CurrentUser() user: JwtPayload) {
    return this.adminService.getAtRiskClients(user);
  }

  @Get('clubs')
  getClubs() {
    return this.adminService.getAllClubs();
  }

  @Post('remind/:clientUserId')
  sendReminder(
    @CurrentUser() user: JwtPayload,
    @Param('clientUserId') clientUserId: string,
    @Body() dto: SendReminderDto,
  ) {
    return this.adminService.sendReminder(user, clientUserId, dto.message);
  }

  @Post('daily-report')
  createDailyReport(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDailyReportDto,
  ) {
    return this.adminService.createDailyReport(user, dto);
  }
}
