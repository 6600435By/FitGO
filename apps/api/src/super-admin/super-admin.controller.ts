import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_PERMISSION_PRESETS,
  AdminPermission,
  AdminTaskStatus,
  UserRole,
} from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ApplyPresetDto, SetPermissionsDto } from './dto/permissions.dto';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { CreateAdminTaskDto, UpdateAdminTaskDto } from './dto/task.dto';
import { SuperAdminAnalyticsService } from './super-admin-analytics.service';
import { SuperAdminService } from './super-admin.service';
import { FeaturesService } from '../features/features.service';
import type { ProductModulesState } from '@fitgo/shared-types';

@Controller('super-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminController {
  constructor(
    private readonly superAdmin: SuperAdminService,
    private readonly analytics: SuperAdminAnalyticsService,
    private readonly features: FeaturesService,
  ) {}

  @Get('staff')
  listStaff(@CurrentUser() user: JwtPayload) {
    return this.superAdmin.listStaff(user);
  }

  @Post('staff')
  createStaff(@CurrentUser() user: JwtPayload, @Body() dto: CreateStaffDto) {
    return this.superAdmin.createStaff(user, dto);
  }

  @Patch('staff/:id')
  updateStaff(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.superAdmin.updateStaff(user, id, dto);
  }

  @Get('staff/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="staff.csv"')
  exportStaff(@CurrentUser() user: JwtPayload) {
    return this.superAdmin.exportStaffCsv(user);
  }

  @Get('admins/:id/permissions')
  getPermissions(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.superAdmin.getAdminPermissions(user, id);
  }

  @Put('admins/:id/permissions')
  setPermissions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SetPermissionsDto,
  ) {
    return this.superAdmin.setAdminPermissions(user, id, dto.permissions);
  }

  @Post('admins/:id/permissions/preset')
  applyPreset(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyPresetDto,
  ) {
    const preset = ADMIN_PERMISSION_PRESETS[dto.preset];
    return this.superAdmin.setAdminPermissions(user, id, preset.permissions);
  }

  @Get('permission-presets')
  listPresets() {
    return ADMIN_PERMISSION_PRESETS;
  }

  @Get('tasks')
  listTasks(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: AdminTaskStatus,
  ) {
    return this.superAdmin.listTasks(user, status);
  }

  @Post('tasks')
  createTask(@CurrentUser() user: JwtPayload, @Body() dto: CreateAdminTaskDto) {
    return this.superAdmin.createTask(user, dto);
  }

  @Patch('tasks/:id')
  updateTask(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAdminTaskDto,
  ) {
    return this.superAdmin.updateTask(user, id, dto);
  }

  @Get('audit-log')
  auditLog(@CurrentUser() user: JwtPayload) {
    return this.superAdmin.listAuditLog(user);
  }

  @Get('analytics')
  getAnalytics(
    @CurrentUser() user: JwtPayload,
    @Query('period') period?: string,
  ) {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    return this.analytics.getAnalytics(user, days);
  }

  @Get('integration-health')
  async integrationHealth(@CurrentUser() user: JwtPayload) {
    const data = await this.analytics.getAnalytics(user, 7);
    return data.integrationHealth;
  }

  @Get('modules')
  getModules() {
    return this.features.getCatalog();
  }

  @Put('modules')
  setModules(
    @CurrentUser() user: JwtPayload,
    @Body() body: { modules: Partial<ProductModulesState> },
  ) {
    return this.features.setModules(body.modules ?? {}, user.sub).then((modules) => ({
      modules,
    }));
  }
}
