import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { PtSessionPayKind, TrainerDaySheetStatus } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PtTimesheetService } from './pt-timesheet.service';

@Controller('trainer/pt-timesheet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAINER)
export class TrainerPtTimesheetController {
  constructor(private readonly svc: PtTimesheetService) {}

  @Get('shifts')
  shifts(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.svc.listShifts(user.sub, from, to);
  }

  @Post('shifts')
  upsertShift(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { id?: string; date: string; startAt: string; endAt: string },
  ) {
    return this.svc.upsertShift(user, body);
  }

  @Delete('shifts/:id')
  deleteShift(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.deleteShift(user.sub, id);
  }

  @Get('day')
  day(@CurrentUser() user: JwtPayload, @Query('date') date: string) {
    return this.svc.trainerGetSheet(user, date);
  }

  @Post('day/submit')
  submit(@CurrentUser() user: JwtPayload, @Body() body: { date: string }) {
    return this.svc.submitSheet(user, body.date);
  }

  @Post('day/late-add')
  lateAdd(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      date: string;
      phone: string;
      firstName: string;
      lastName: string;
      startAt: string;
      isComplimentary?: boolean;
    },
  ) {
    return this.svc.lateAddBooking(user, body);
  }

  @Post('bookings/:id/correct-phone')
  correctPhone(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { phone: string },
  ) {
    return this.svc.correctBookingPhone(user, id, body.phone);
  }

  @Post('bookings/:id/escalate')
  escalate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.escalateClientIssue(user, id);
  }

  @Post('bookings/:id/not-this-client')
  notThisClient(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.flagIdentityMismatch(user, id);
  }
}

@Controller('admin/pt-timesheet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminPtTimesheetController {
  constructor(private readonly svc: PtTimesheetService) {}

  @Get('client-issues')
  clientIssues(@CurrentUser() user: JwtPayload) {
    return this.svc.listClientIssueQueue(requireClubId(user));
  }

  @Get('sheets')
  listSheets(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: TrainerDaySheetStatus,
  ) {
    return this.svc.listSheetsForReview(requireClubId(user), status);
  }

  @Get('sheets/:id')
  sheet(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getSheetById(requireClubId(user), id);
  }

  @Post('bookings/:id/rebind-phone')
  rebind(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { phone: string },
  ) {
    return this.svc.adminRebindPhone(user, id, body.phone);
  }

  @Post('bookings/:id/resolve-client')
  resolveClient(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.adminResolveClientIssue(user, id);
  }

  @Patch('bookings/:id/payment')
  setPayment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      paymentStatus: 'PAID' | 'DEBT' | 'PENDING_PAYMENT' | 'N_A';
      payKind?: PtSessionPayKind;
      priceMinor?: number;
      verified1c?: boolean;
    },
  ) {
    return this.svc.adminSetPayment(user, id, body);
  }

  @Post('bookings/:id/verify-1c')
  verify1c(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.verifyBookingPayment1c(user, id);
  }

  @Post('sheets/:id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.adminApproveSheet(user, id);
  }
}

@Controller('super-admin/pt-timesheet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminPtTimesheetController {
  constructor(private readonly svc: PtTimesheetService) {}

  @Get('sheets')
  listSheets(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: TrainerDaySheetStatus,
  ) {
    return this.svc.listSheetsForReview(
      requireClubId(user),
      status ?? TrainerDaySheetStatus.ADMIN_APPROVED,
    );
  }

  @Post('sheets/:id/approve')
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body?: { forceBookingIds?: string[] },
  ) {
    return this.svc.saApproveSheet(user, id, body?.forceBookingIds);
  }

  @Post('sheets/:id/lock')
  lock(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.lockSheet(user, id);
  }
}
