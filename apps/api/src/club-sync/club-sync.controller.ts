import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClubSyncProfile, ClubSyncTrigger } from '@prisma/client';
import { UserRole as SharedUserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { ClubSyncOrchestrator } from './club-sync-orchestrator.service';
import { ClubSyncStatusService } from './club-sync-status.service';

const STAFF_ROLES = [
  SharedUserRole.ADMIN,
  SharedUserRole.SUPER_ADMIN,
  SharedUserRole.MANAGER,
  SharedUserRole.TRAINER,
  SharedUserRole.SPECIALIST,
  SharedUserRole.TECH,
];

@Controller('staff/sync')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClubSyncController {
  constructor(
    private readonly orchestrator: ClubSyncOrchestrator,
    private readonly statusService: ClubSyncStatusService,
  ) {}

  @Get('status')
  @Roles(...STAFF_ROLES)
  async status(@CurrentUser() user: JwtPayload) {
    const clubId = requireClubId(user);
    const canSeeErrors =
      user.roles.includes(SharedUserRole.SUPER_ADMIN) ||
      user.roles.includes(SharedUserRole.MANAGER);
    return this.statusService.status(clubId, { includeErrors: canSeeErrors });
  }

  /**
   * One light club-wide pull. Second concurrent caller gets { status: 'running' }.
   * Super-admin / manager (ops) — desk admins use freshness read-only.
   */
  @Post('refresh')
  @Roles(SharedUserRole.SUPER_ADMIN, SharedUserRole.MANAGER)
  async refresh(
    @CurrentUser() user: JwtPayload,
    @Body() body?: { profile?: 'LIGHT' | 'FULL' },
  ) {
    const clubId = requireClubId(user);
    const profile =
      body?.profile === 'FULL' ? ClubSyncProfile.FULL : ClubSyncProfile.LIGHT;
    const result = await this.orchestrator.start(clubId, {
      trigger: ClubSyncTrigger.MANUAL,
      profile,
      userId: user.sub,
    });
    const status = await this.statusService.status(clubId, {
      includeErrors: true,
    });
    return { ...result, ...status };
  }
}
