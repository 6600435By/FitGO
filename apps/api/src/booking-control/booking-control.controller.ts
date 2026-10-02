import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { BookingControlService } from './booking-control.service';

type ListQuery = {
  from?: string;
  to?: string;
  kind?: string;
  performerId?: string;
  status?: string;
  needsReview?: string;
  payment?: string;
  sessionKey?: string;
};

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingControlController {
  constructor(private readonly bookingControl: BookingControlService) {}

  @Get('super-admin/booking-control')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  listSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListQuery,
  ) {
    if (query.sessionKey?.trim()) {
      return this.bookingControl.detail(
        requireClubId(user),
        query.sessionKey.trim(),
      );
    }
    return this.list(requireClubId(user), query);
  }

  @Post('super-admin/booking-control/remark')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  openRemarkSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.openRemark(
      user,
      body.sessionKey ?? '',
      body.comment ?? '',
    );
  }

  @Post('super-admin/booking-control/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  resolveSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; adminComment?: string },
  ) {
    return this.bookingControl.resolveRemark(
      user,
      body.sessionKey ?? '',
      body.adminComment ?? '',
    );
  }

  @Post('super-admin/booking-control/refresh-from-1c')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  refreshSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { from?: string; to?: string },
  ) {
    return this.bookingControl.refreshFrom1c(
      requireClubId(user),
      body.from?.trim() || '',
      body.to?.trim() || '',
    );
  }

  @Post('super-admin/booking-control/attendance')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  attendanceSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      sessionKey?: string;
      clientExternalId?: string;
      attendance?: 'ATTENDED' | 'NO_SHOW';
    },
  ) {
    return this.bookingControl.setGroupAttendance(
      requireClubId(user),
      body.sessionKey ?? '',
      body.clientExternalId ?? '',
      body.attendance ?? 'ATTENDED',
    );
  }

  @Post('super-admin/booking-control/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  approveSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.approveGroup(
      user,
      body.sessionKey ?? '',
      body.comment,
    );
  }

  @Post('super-admin/booking-control/return-approval')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  returnSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.returnGroupApproval(
      user,
      body.sessionKey ?? '',
      body.comment,
    );
  }

  @Get('super-admin/booking-control/pending-approvals')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  pendingSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookingControl.listPendingAdminApprovals(
      requireClubId(user),
      from,
      to,
    );
  }

  @Get('admin/booking-control')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  listAdmin(@CurrentUser() user: JwtPayload, @Query() query: ListQuery) {
    if (query.sessionKey?.trim()) {
      return this.bookingControl.detail(
        requireClubId(user),
        query.sessionKey.trim(),
      );
    }
    return this.list(requireClubId(user), query);
  }

  @Post('admin/booking-control/remark')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  openRemarkAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.openRemark(
      user,
      body.sessionKey ?? '',
      body.comment ?? '',
    );
  }

  @Post('admin/booking-control/resolve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  resolveAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; adminComment?: string },
  ) {
    return this.bookingControl.resolveRemark(
      user,
      body.sessionKey ?? '',
      body.adminComment ?? '',
    );
  }

  @Post('admin/booking-control/refresh-from-1c')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  refreshAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { from?: string; to?: string },
  ) {
    return this.bookingControl.refreshFrom1c(
      requireClubId(user),
      body.from?.trim() || '',
      body.to?.trim() || '',
    );
  }

  @Post('admin/booking-control/attendance')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  attendanceAdmin(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      sessionKey?: string;
      clientExternalId?: string;
      attendance?: 'ATTENDED' | 'NO_SHOW';
    },
  ) {
    return this.bookingControl.setGroupAttendance(
      requireClubId(user),
      body.sessionKey ?? '',
      body.clientExternalId ?? '',
      body.attendance ?? 'ATTENDED',
    );
  }

  @Post('admin/booking-control/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  approveAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.approveGroup(
      user,
      body.sessionKey ?? '',
      body.comment,
    );
  }

  @Post('admin/booking-control/return-approval')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  returnAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.returnGroupApproval(
      user,
      body.sessionKey ?? '',
      body.comment,
    );
  }

  @Get('admin/booking-control/pending-approvals')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  pendingAdmin(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookingControl.listPendingAdminApprovals(
      requireClubId(user),
      from,
      to,
    );
  }

  @Get('trainer/booking-control')
  @Roles(UserRole.TRAINER)
  listTrainer(@CurrentUser() user: JwtPayload, @Query() query: ListQuery) {
    if (query.sessionKey?.trim()) {
      return this.bookingControl.detail(
        requireClubId(user),
        query.sessionKey.trim(),
        { userId: user.sub, ownOnly: true },
      );
    }
    return this.list(requireClubId(user), {
      ...query,
      performerId: user.sub,
      _own: true,
    });
  }

  @Post('trainer/booking-control/remark')
  @Roles(UserRole.TRAINER)
  openRemarkTrainer(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.openRemark(
      user,
      body.sessionKey ?? '',
      body.comment ?? '',
    );
  }

  @Post('trainer/booking-control/trainer-seen')
  @Roles(UserRole.TRAINER)
  trainerSeen(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; seenClientIds?: string[] },
  ) {
    return this.bookingControl.saveTrainerSeen(
      user,
      body.sessionKey ?? '',
      body.seenClientIds ?? [],
    );
  }

  @Post('trainer/booking-control/approve')
  @Roles(UserRole.TRAINER)
  approveTrainer(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.approveGroup(
      user,
      body.sessionKey ?? '',
      body.comment,
    );
  }

  @Get('specialist/booking-control')
  @Roles(UserRole.SPECIALIST)
  listSpecialist(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListQuery,
  ) {
    if (query.sessionKey?.trim()) {
      return this.bookingControl.detail(
        requireClubId(user),
        query.sessionKey.trim(),
        { userId: user.sub, ownOnly: true },
      );
    }
    return this.list(requireClubId(user), {
      ...query,
      kind: 'SPA',
      performerId: user.sub,
      _own: true,
    });
  }

  @Post('specialist/booking-control/remark')
  @Roles(UserRole.SPECIALIST)
  openRemarkSpecialist(
    @CurrentUser() user: JwtPayload,
    @Body() body: { sessionKey?: string; comment?: string },
  ) {
    return this.bookingControl.openRemark(
      user,
      body.sessionKey ?? '',
      body.comment ?? '',
    );
  }

  private list(
    clubId: string,
    query: ListQuery & { _own?: boolean },
  ) {
    const from =
      query.from?.trim() ||
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to =
      query.to?.trim() || new Date().toISOString().slice(0, 10);
    const kind = (query.kind?.toUpperCase() || 'ALL') as
      | 'ALL'
      | 'GROUP'
      | 'PT'
      | 'SPA';
    const status = (query.status?.toUpperCase() || 'ALL') as
      | 'ALL'
      | 'SCHEDULED'
      | 'COMPLETED'
      | 'CANCELLED';
    const payment = (query.payment?.toUpperCase() || 'ALL') as
      | 'ALL'
      | 'PAID'
      | 'DEBT';
    return this.bookingControl.list(clubId, {
      from,
      to,
      kind,
      status,
      payment,
      needsReview:
        query.needsReview === '1' || query.needsReview === 'true',
      performerId: query._own ? undefined : query.performerId,
      restrictPerformerId: query._own ? query.performerId : undefined,
    });
  }
}
