import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { ClubSyncOrchestrator } from '../club-sync/club-sync-orchestrator.service';
import { ClubScheduleService } from './club-schedule.service';

type ListQuery = {
  from?: string;
  to?: string;
  types?: string;
  staffIds?: string;
  status?: string;
  approval?: string;
  clubId?: string;
};

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClubScheduleController {
  constructor(
    private readonly clubSchedule: ClubScheduleService,
    private readonly clubSync: ClubSyncOrchestrator,
  ) {}

  @Get('admin/club-schedule')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  listAdmin(@CurrentUser() user: JwtPayload, @Query() query: ListQuery) {
    return this.clubSchedule.list(
      requireClubId(user),
      this.clubSchedule.parseListQuery(query),
    );
  }

  @Get('super-admin/club-schedule')
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  listSuperAdmin(@CurrentUser() user: JwtPayload, @Query() query: ListQuery) {
    const clubId = this.resolveClubId(user, query.clubId);
    return this.clubSchedule.list(
      clubId,
      this.clubSchedule.parseListQuery(query),
    );
  }

  /** Trainer GP: same schedule surface as admin, forced to own GROUP slots. */
  @Get('trainer/club-schedule')
  @Roles(UserRole.TRAINER)
  listTrainer(@CurrentUser() user: JwtPayload, @Query() query: ListQuery) {
    const clubId = requireClubId(user);
    this.clubSync.ensureFreshToday(clubId);
    return this.clubSchedule.list(
      clubId,
      this.clubSchedule.parseListQuery({
        from: query.from,
        to: query.to,
        status: query.status,
        approval: query.approval,
        types: 'GROUP',
        staffIds: user.sub,
      }),
    );
  }

  private resolveClubId(user: JwtPayload, queryClubId?: string): string {
    const explicit = queryClubId?.trim();
    if (
      explicit &&
      (user.roles.includes(UserRole.MANAGER) ||
        user.roles.includes(UserRole.SUPER_ADMIN))
    ) {
      return explicit;
    }
    return requireClubId(user);
  }
}
