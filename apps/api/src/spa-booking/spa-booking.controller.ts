import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequireModule } from '../features/require-module.decorator';
import { ModuleGuard } from '../features/module.guard';
import { AssignSpaBookingDto } from './dto/assign-spa-booking.dto';
import {
  SetSpaQuotaRulesDto,
  SetSpecialistServicesDto,
  UpsertSpaServiceDto,
} from './dto/admin-spa.dto';
import { BookSpaDto } from './dto/book-spa.dto';
import { PublishSpecialistScheduleDto } from './dto/publish-schedule.dto';
import { SetSpecialistAvailabilityBlocksDto } from './dto/set-availability-blocks.dto';
import { SetSpecialistWorkScheduleDto } from './dto/set-work-schedule.dto';
import { SpaBookingService } from './spa-booking.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule('spa_booking')
export class SpaBookingController {
  constructor(private readonly spa: SpaBookingService) {}

  // ─── Client ────────────────────────────────────────────────────────────────

  @Get('client/spa/services')
  @Roles(UserRole.CLIENT)
  listServices(
    @CurrentUser() user: JwtPayload,
    @Query('membershipServiceName') membershipServiceName?: string,
    @Query('quotaOnly') quotaOnly?: string,
  ) {
    return this.spa.listClientSpaServices(user, {
      membershipServiceName,
      quotaOnly: quotaOnly === '1' || quotaOnly === 'true',
    });
  }

  @Get('client/spa/specialists')
  @Roles(UserRole.CLIENT)
  listSpecialists(
    @CurrentUser() user: JwtPayload,
    @Query('serviceId') serviceId: string,
    @Query('membershipServiceName') membershipServiceName?: string,
    @Query('paymentType') paymentType?: 'QUOTA' | 'PAID',
  ) {
    return this.spa.listSpecialists(user, serviceId, {
      membershipServiceName,
      paymentType,
    });
  }

  @Get('client/spa/specialists/:specialistId/slots')
  @Roles(UserRole.CLIENT)
  listSlots(
    @CurrentUser() user: JwtPayload,
    @Param('specialistId') specialistId: string,
    @Query('serviceId') serviceId: string,
  ) {
    return this.spa.listClientSlots(user, specialistId, serviceId);
  }

  @Post('client/spa-bookings')
  @Roles(UserRole.CLIENT)
  book(@CurrentUser() user: JwtPayload, @Body() dto: BookSpaDto) {
    return this.spa.clientBookSpa(user, dto);
  }

  @Get('client/spa-bookings')
  @Roles(UserRole.CLIENT)
  listBookings(@CurrentUser() user: JwtPayload) {
    return this.spa.listClientBookings(user);
  }

  @Delete('client/spa-bookings/:bookingId')
  @Roles(UserRole.CLIENT)
  cancelBooking(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.spa.cancelClientBooking(user, bookingId);
  }

  // ─── Specialist ────────────────────────────────────────────────────────────

  @Get('specialist/spa/services')
  @Roles(UserRole.SPECIALIST)
  specialistServices(@CurrentUser() user: JwtPayload) {
    return this.spa.listSpecialistOwnServices(user);
  }

  @Get('specialist/work-schedule')
  @Roles(UserRole.SPECIALIST)
  getWorkSchedule(@CurrentUser() user: JwtPayload) {
    return this.spa.getWorkSchedule(user);
  }

  @Put('specialist/work-schedule')
  @Roles(UserRole.SPECIALIST)
  setWorkSchedule(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSpecialistWorkScheduleDto,
  ) {
    return this.spa.setWorkSchedule(user, dto.slots);
  }

  @Get('specialist/calendar')
  @Roles(UserRole.SPECIALIST)
  getCalendar(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.spa.getSpecialistCalendar(user, from, to);
  }

  @Get('specialist/availability-blocks')
  @Roles(UserRole.SPECIALIST)
  getBlocks(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.spa.getAvailabilityBlocks(user, from, to);
  }

  @Put('specialist/availability-blocks')
  @Roles(UserRole.SPECIALIST)
  setBlocks(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSpecialistAvailabilityBlocksDto,
  ) {
    return this.spa.setAvailabilityBlocks(
      user,
      dto.periodStart,
      dto.periodEnd,
      dto.blocks,
    );
  }

  @Post('specialist/schedule/fill-from-template')
  @Roles(UserRole.SPECIALIST)
  fillFromTemplate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishSpecialistScheduleDto,
  ) {
    return this.spa.fillFromTemplate(user, dto.periodStart, dto.periodEnd);
  }

  @Post('specialist/schedule/publish')
  @Roles(UserRole.SPECIALIST)
  publish(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishSpecialistScheduleDto,
  ) {
    return this.spa.publishSchedule(user, dto.periodStart, dto.periodEnd);
  }

  @Get('specialist/spa-bookings')
  @Roles(UserRole.SPECIALIST)
  specialistBookings(@CurrentUser() user: JwtPayload) {
    return this.spa.listSpecialistBookings(user);
  }

  @Post('specialist/spa-bookings')
  @Roles(UserRole.SPECIALIST)
  specialistAssign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignSpaBookingDto,
  ) {
    return this.spa.specialistAssign(user, {
      clientId: dto.clientId,
      serviceId: dto.serviceId,
      startAt: dto.startAt,
      paymentType: dto.paymentType,
      membershipServiceName: dto.membershipServiceName,
    });
  }

  @Patch('specialist/spa-bookings/:bookingId')
  @Roles(UserRole.SPECIALIST)
  cancelSpecialistBooking(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.spa.cancelSpecialistBooking(user, bookingId);
  }

  // ─── Admin ─────────────────────────────────────────────────────────────────

  @Get('admin/spa/services')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminServices(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListServices(user);
  }

  @Post('admin/spa/services')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminUpsertService(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertSpaServiceDto,
  ) {
    return this.spa.adminUpsertService(user, dto);
  }

  @Get('admin/spa/quota-rules')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminQuotaRules(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListQuotaRules(user);
  }

  @Put('admin/spa/quota-rules')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminSetQuotaRules(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSpaQuotaRulesDto,
  ) {
    return this.spa.adminSetQuotaRules(user, dto.rules);
  }

  @Get('admin/spa/specialists')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminSpecialists(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListSpecialists(user);
  }

  @Put('admin/spa/specialists/:id/services')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminSetSpecialistServices(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SetSpecialistServicesDto,
  ) {
    return this.spa.adminSetSpecialistServices(user, id, dto.serviceIds);
  }

  @Get('admin/spa/calendar')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminCalendar(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.spa.adminCalendar(user, from, to);
  }

  @Get('admin/spa/clients')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SPECIALIST)
  adminClients(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListClients(user);
  }

  @Post('admin/spa-bookings')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminAssign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignSpaBookingDto,
  ) {
    if (!dto.specialistId) {
      throw new BadRequestException('Укажите специалиста');
    }
    return this.spa.adminAssign(user, {
      clientId: dto.clientId,
      specialistId: dto.specialistId,
      serviceId: dto.serviceId,
      startAt: dto.startAt,
      paymentType: dto.paymentType,
      membershipServiceName: dto.membershipServiceName,
    });
  }
}
