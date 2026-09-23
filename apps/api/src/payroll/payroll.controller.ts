import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type {
  ClubPayrollSectionId,
  StaffEmploymentKind,
  StaffPayProfile,
} from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PayrollService } from './payroll.service';

@Controller('super-admin/payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('staff')
  staff(@CurrentUser() user: JwtPayload) {
    return this.payroll.listStaffForPayroll(requireClubId(user));
  }

  @Get('staff/:userId/profile')
  profile(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
  ) {
    return this.payroll.getStaffPayProfile(requireClubId(user), userId);
  }

  @Post('staff/:userId/profile')
  saveProfile(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body()
    body: {
      baseSalaryMinor?: number;
      payProfile: StaffPayProfile;
      effectiveFrom?: string;
    },
  ) {
    return this.payroll.saveStaffPayProfile(user, {
      userId,
      ...body,
    });
  }

  @Post('staff/:userId/profile/copy')
  copyProfile(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body()
    body: {
      departments: Array<'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH'>;
      tracks?: Array<'ADMIN' | 'GROUP_TRAINER' | 'SPA' | 'TECH' | 'PT'>;
    },
  ) {
    return this.payroll.copyStaffPayProfile(
      user,
      userId,
      body.departments ?? [],
      body.tracks,
    );
  }

  @Patch('staff/:userId/employment')
  setEmployment(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body() body: { employmentKind: StaffEmploymentKind },
  ) {
    if (body.employmentKind !== 'STAFF' && body.employmentKind !== 'EXTERNAL') {
      throw new BadRequestException('employmentKind STAFF|EXTERNAL');
    }
    return this.payroll.setEmploymentKind(user, userId, body.employmentKind);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.payroll.getPeriodSummary(
      requireClubId(user),
      userId,
      from,
      to,
    );
  }

  @Get('club-summary')
  clubSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('department') department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
  ) {
    return this.payroll.getClubSummary(
      requireClubId(user),
      from,
      to,
      department ?? 'ALL',
    );
  }

  @Get('club-summary.xlsx')
  async clubSummaryXlsx(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('department') department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
    @Res({ passthrough: true }) res?: { setHeader: (k: string, v: string) => void },
  ) {
    const buf = await this.payroll.exportClubSummaryXlsx(
      requireClubId(user),
      from,
      to,
      department ?? 'ALL',
    );
    res?.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res?.setHeader(
      'Content-Disposition',
      `attachment; filename="ZP_${from}_${to}.xlsx"`,
    );
    return new StreamableFile(buf);
  }

  @Get('corporate-sales')
  listCorporate(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.payroll.listCorporateSales(requireClubId(user), from, to);
  }

  @Post('corporate-sales')
  upsertCorporate(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      userId: string;
      periodFrom: string;
      periodTo: string;
      amountMinor: number;
      note?: string;
    },
  ) {
    return this.payroll.upsertCorporateSale(user, body);
  }

  @Patch('spa-bookings/:bookingId/partner')
  setSpaPartner(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Body() body: { partnerSource: string | null },
  ) {
    return this.payroll.setSpaPartnerSource(
      user,
      bookingId,
      body.partnerSource ?? null,
    );
  }

  @Post('lock')
  lock(
    @CurrentUser() user: JwtPayload,
    @Body() body: { userId: string; from: string; to: string },
  ) {
    return this.payroll.lockPeriod(user, body.userId, body.from, body.to);
  }

  @Post('adjustments')
  adjustment(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      userId: string;
      amountMinor: number;
      reason: string;
      periodFrom: string;
      periodTo: string;
    },
  ) {
    return this.payroll.addAdjustment(user, body);
  }

  @Patch('adjustments/:id')
  updateAdjustment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { amountMinor?: number; reason?: string },
  ) {
    return this.payroll.updateAdjustment(user, id, body);
  }

  @Delete('adjustments/:id')
  deleteAdjustment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.payroll.deleteAdjustment(user, id);
  }

  @Get('payouts')
  listPayouts(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId: string,
  ) {
    return this.payroll.listPayouts(requireClubId(user), userId);
  }

  @Get('payouts/preview')
  previewPayout(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId: string,
    @Query('kind') kind: 'ADVANCE_HALF' | 'MONTH_SETTLEMENT',
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('periodFrom') periodFrom?: string,
    @Query('periodTo') periodTo?: string,
  ) {
    if (kind !== 'ADVANCE_HALF' && kind !== 'MONTH_SETTLEMENT') {
      throw new BadRequestException('Неверный тип выплаты');
    }
    return this.payroll.previewPayout(
      requireClubId(user),
      userId,
      kind,
      Number(year),
      Number(month),
      { periodFrom, periodTo },
    );
  }

  @Get('payouts/batch-preview')
  batchPreviewPayout(
    @CurrentUser() user: JwtPayload,
    @Query('kind') kind: 'ADVANCE_HALF' | 'MONTH_SETTLEMENT',
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('periodFrom') periodFrom?: string,
    @Query('periodTo') periodTo?: string,
    @Query('department') department?: string,
    @Query('userIds') userIds?: string,
  ) {
    if (kind !== 'ADVANCE_HALF' && kind !== 'MONTH_SETTLEMENT') {
      throw new BadRequestException('Неверный тип выплаты');
    }
    return this.payroll.previewPayoutBatch(
      requireClubId(user),
      kind,
      Number(year),
      Number(month),
      {
        periodFrom,
        periodTo,
        department: (department as
          | 'ALL'
          | 'MANAGER'
          | 'ADMIN'
          | 'TRAINER'
          | 'SPECIALIST'
          | 'TECH'
          | 'EXTERNAL') || 'ALL',
        userIds: userIds
          ? userIds.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      },
    );
  }

  @Post('payouts/confirm')
  confirmPayout(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      userId: string;
      kind: 'ADVANCE_HALF' | 'MONTH_SETTLEMENT';
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      cardTransferMinor?: number;
      actualCashMinor?: number;
      note?: string;
    },
  ) {
    return this.payroll.confirmPayout(user, body);
  }

  @Post('payouts/confirm-batch')
  confirmPayoutBatch(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      kind: 'ADVANCE_HALF' | 'MONTH_SETTLEMENT';
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      items: Array<{
        userId: string;
        cardTransferMinor?: number;
        actualCashMinor?: number;
        note?: string;
      }>;
    },
  ) {
    if (!body.items?.length) {
      throw new BadRequestException('Нет строк для подтверждения');
    }
    return this.payroll.confirmPayoutBatch(user, body);
  }
}

@Controller('admin/payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminPayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** Admin sees only own payroll row (not other staff). */
  @Get('staff')
  staff(@CurrentUser() user: JwtPayload) {
    return this.payroll.listSelfForPayroll(requireClubId(user), user.sub);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (userId && userId !== user.sub) {
      throw new ForbiddenException('Админ видит только свою ЗП');
    }
    return this.payroll.getPeriodSummary(
      requireClubId(user),
      user.sub,
      from,
      to,
    );
  }
}
