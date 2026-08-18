import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminPermission, UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { EngagementService } from './engagement.service';
import { UpdateThemeDto } from './dto/update-theme.dto';
import {
  ActivateGamificationDto,
  CheckInDto,
  CreateWorkoutDto,
} from './dto/engagement.dto';

@Controller('engagement')
@UseGuards(JwtAuthGuard)
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('gamification')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  getGamification(@CurrentUser() user: JwtPayload) {
    return this.engagement.getGamification(user);
  }

  @Post('activate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  activate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ActivateGamificationDto,
  ) {
    return this.engagement.activate(user, dto);
  }

  @Get('nickname/suggest')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  suggestNickname(@CurrentUser() user: JwtPayload) {
    return this.engagement.suggestNicknameForUser(user.sub);
  }

  @Get('nickname/check')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  checkNickname(
    @CurrentUser() user: JwtPayload,
    @Query('name') name: string,
  ) {
    return this.engagement.checkNickname(requireClubId(user), name ?? '');
  }

  @Post('check-in')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  checkIn(@CurrentUser() user: JwtPayload, @Body() dto: CheckInDto) {
    return this.engagement.checkIn(user, dto);
  }

  @Post('daily-goal')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  dailyGoal(@CurrentUser() user: JwtPayload) {
    return this.engagement.recordDailyGoal(user);
  }

  @Get('league/group')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  getLeagueGroup(@CurrentUser() user: JwtPayload) {
    return this.engagement.getLeagueGroup(user);
  }

  @Post('workouts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  createWorkout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWorkoutDto,
  ) {
    return this.engagement.createWorkout(user, dto);
  }

  @Get('workouts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  getWorkouts(@CurrentUser() user: JwtPayload) {
    return this.engagement.getWorkouts(user);
  }

  @Get('referral')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  getReferral(@CurrentUser() user: JwtPayload) {
    return this.engagement.getReferral(user);
  }

  @Get('theme')
  getTheme(@CurrentUser() user: JwtPayload) {
    return this.engagement.getClubTheme(requireClubId(user));
  }

  @Post('theme')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN)
  @RequirePermission(AdminPermission.SETTINGS_BRANDING)
  updateTheme(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateThemeDto,
  ) {
    return this.engagement.updateClubTheme(requireClubId(user), dto);
  }

  @Get('challenges')
  getChallenges(@CurrentUser() user: JwtPayload) {
    return this.engagement.getChallenges(user);
  }

  @Get('leaderboard')
  getLeaderboard(@CurrentUser() user: JwtPayload) {
    return this.engagement.getLeaderboard(requireClubId(user));
  }

  @Post('wearables/:provider/sync')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  syncWearable(
    @CurrentUser() user: JwtPayload,
    @Param('provider') provider: string,
  ) {
    return this.engagement.syncWearable(user, provider);
  }
}
