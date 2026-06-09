import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { EngagementService } from './engagement.service';
import { UpdateThemeDto } from './dto/update-theme.dto';

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

  @Get('referral')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  getReferral(@CurrentUser() user: JwtPayload) {
    return this.engagement.getReferral(user);
  }

  @Get('theme')
  getTheme(@CurrentUser() user: JwtPayload) {
    return this.engagement.getClubTheme(user.clubId);
  }

  @Post('theme')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateTheme(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateThemeDto,
  ) {
    return this.engagement.updateClubTheme(user.clubId, dto);
  }

  @Get('challenges')
  getChallenges(@CurrentUser() user: JwtPayload) {
    return this.engagement.getChallenges(user.clubId);
  }

  @Get('leaderboard')
  getLeaderboard(@CurrentUser() user: JwtPayload) {
    return this.engagement.getLeaderboard(user.clubId);
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
