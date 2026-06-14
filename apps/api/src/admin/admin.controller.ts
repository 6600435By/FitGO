import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminPermission, AdminTaskStatus, UserRole } from '@fitgo/shared-types';
import { AdminPermissionsService } from '../auth/admin-permissions.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AdminService } from './admin.service';
import { CreateDailyReportDto } from './dto/create-daily-report.dto';
import { SendReminderDto } from './dto/send-reminder.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminPermissions: AdminPermissionsService,
  ) {}

  @Get('permissions')
  getMyPermissions(@CurrentUser() user: JwtPayload) {
    return this.adminPermissions.getPermissions(user).then((permissions) => ({
      permissions,
    }));
  }

  @Get('tasks')
  getMyTasks(@CurrentUser() user: JwtPayload) {
    return this.adminService.getMyTasks(user);
  }

  @Patch('tasks/:id')
  updateMyTask(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: AdminTaskStatus },
  ) {
    return this.adminService.updateMyTask(user, id, body.status);
  }

  @Get('dashboard')
  @RequirePermission(AdminPermission.DASHBOARD_VIEW)
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.adminService.getDashboard(user);
  }

  @Get('funnel')
  @RequirePermission(AdminPermission.FUNNEL_VIEW)
  getFunnel(@CurrentUser() user: JwtPayload) {
    return this.adminService.getFunnel(user);
  }

  @Get('reports')
  @RequirePermission(AdminPermission.REPORTS_VIEW)
  getReports(@CurrentUser() user: JwtPayload) {
    return this.adminService.getReports(user);
  }

  @Get('at-risk')
  @RequirePermission(AdminPermission.AT_RISK_VIEW)
  getAtRisk(@CurrentUser() user: JwtPayload) {
    return this.adminService.getAtRiskClients(user);
  }

  @Get('clubs')
  @RequirePermission(AdminPermission.DASHBOARD_VIEW)
  getClubs() {
    return this.adminService.getAllClubs();
  }

  @Post('remind/:clientUserId')
  @RequirePermission(AdminPermission.CLIENTS_MESSAGE)
  sendReminder(
    @CurrentUser() user: JwtPayload,
    @Param('clientUserId') clientUserId: string,
    @Body() dto: SendReminderDto,
  ) {
    return this.adminService.sendReminder(user, clientUserId, dto.message);
  }

  @Post('daily-report')
  @RequirePermission(AdminPermission.REPORTS_EDIT)
  createDailyReport(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDailyReportDto,
  ) {
    return this.adminService.createDailyReport(user, dto);
  }
}
