import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type {
  ClubWorkingHours,
  StaffShiftTrack,
} from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { StaffRosterService } from './staff-roster.service';

@Controller('admin/staff-roster')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminStaffRosterController {
  constructor(private readonly roster: StaffRosterService) {}

  @Get('working-hours')
  workingHours(@CurrentUser() user: JwtPayload) {
    return this.roster.getWorkingHours(requireClubId(user));
  }

  @Put('day')
  patchDay(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      date: string;
      holiday?: boolean;
      hours?: { open: string; close: string; closed?: boolean } | null;
    },
  ) {
    return this.roster.patchDaySchedule(requireClubId(user), body);
  }

  @Get('staff')
  staff(
    @CurrentUser() user: JwtPayload,
    @Query('track') track: StaffShiftTrack,
  ) {
    return this.roster.listStaffForTrack(requireClubId(user), track);
  }

  @Get('month')
  month(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('track') track?: StaffShiftTrack,
  ) {
    return this.roster.listMonth(
      requireClubId(user),
      Number(year),
      Number(month),
      track,
    );
  }

  @Post('shifts')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      id?: string;
      userId?: string;
      userIds?: string[];
      track: StaffShiftTrack;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
      overtimeMinutes?: number;
    },
  ) {
    return this.roster.createShifts(user, body);
  }

  @Post('shifts/fill')
  fill(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      userId: string;
      track: StaffShiftTrack;
      startTime: string;
      endTime: string;
      dates: string[];
      overtimeMinutes?: number;
      skipIfExists?: boolean;
    },
  ) {
    return this.roster.fillShifts(user, body);
  }

  @Delete('shifts/:id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.roster.deleteShift(requireClubId(user), id);
  }

  @Get('my-hours')
  myHours(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.roster.hourlySummary(requireClubId(user), user.sub, from, to);
  }

  @Get('summaries')
  summaries(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('track') track?: StaffShiftTrack,
  ) {
    // Admins only see own via my-hours; SA uses super-admin route
    if (!user.roles.includes(UserRole.SUPER_ADMIN)) {
      return this.roster.hourlySummary(
        requireClubId(user),
        user.sub,
        from,
        to,
      ).then((s) => [s]);
    }
    return this.roster.listHourlySummaries(
      requireClubId(user),
      from,
      to,
      track,
    );
  }
}

@Controller('super-admin/staff-roster')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminStaffRosterController {
  constructor(private readonly roster: StaffRosterService) {}

  @Get('working-hours')
  workingHours(@CurrentUser() user: JwtPayload) {
    return this.roster.getWorkingHours(requireClubId(user));
  }

  @Put('working-hours')
  setWorkingHours(
    @CurrentUser() user: JwtPayload,
    @Body() body: ClubWorkingHours,
  ) {
    return this.roster.setWorkingHours(requireClubId(user), body);
  }

  @Put('day')
  patchDay(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      date: string;
      holiday?: boolean;
      hours?: { open: string; close: string; closed?: boolean } | null;
    },
  ) {
    return this.roster.patchDaySchedule(requireClubId(user), body);
  }

  @Get('staff')
  staff(
    @CurrentUser() user: JwtPayload,
    @Query('track') track: StaffShiftTrack,
  ) {
    return this.roster.listStaffForTrack(requireClubId(user), track);
  }

  @Get('month')
  month(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('track') track?: StaffShiftTrack,
  ) {
    return this.roster.listMonth(
      requireClubId(user),
      Number(year),
      Number(month),
      track,
    );
  }

  @Post('shifts')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      id?: string;
      userId?: string;
      userIds?: string[];
      track: StaffShiftTrack;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
      overtimeMinutes?: number;
    },
  ) {
    return this.roster.createShifts(user, body);
  }

  @Post('shifts/fill')
  fill(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      userId: string;
      track: StaffShiftTrack;
      startTime: string;
      endTime: string;
      dates: string[];
      overtimeMinutes?: number;
      skipIfExists?: boolean;
    },
  ) {
    return this.roster.fillShifts(user, body);
  }

  @Delete('shifts/:id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.roster.deleteShift(requireClubId(user), id);
  }

  @Get('summaries')
  summaries(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('track') track?: StaffShiftTrack,
  ) {
    return this.roster.listHourlySummaries(
      requireClubId(user),
      from,
      to,
      track,
    );
  }
}

@Controller('trainer/staff-roster')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAINER)
export class TrainerStaffRosterController {
  constructor(private readonly roster: StaffRosterService) {}

  /** Read-only: own shifts for the month (from admin roster). */
  @Get('my-month')
  async myMonth(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const cells = await this.roster.listMonth(
      requireClubId(user),
      Number(year),
      Number(month),
      'TRAINER',
    );
    return cells.map((c) => ({
      ...c,
      shifts: c.shifts.filter((s) => s.userId === user.sub),
    }));
  }
}
