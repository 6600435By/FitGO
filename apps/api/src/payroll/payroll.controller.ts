import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import type { StaffPayProfile } from '@fitgo/shared-types';
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
