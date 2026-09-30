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
