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
import { CheckSpecialistAvailabilityDto } from './dto/check-availability.dto';
import { SetSpecialistDayHoursDto } from './dto/set-day-hours.dto';
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

  @Get('specialist/spa-board')
  @Roles(UserRole.SPECIALIST)
  specialistSpaBoard(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.spa.getSpecialistSpaBoard(user, from, to);
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

  @Post('specialist/availability/check')
  @Roles(UserRole.SPECIALIST)
  checkAvailabilityOverlap(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CheckSpecialistAvailabilityDto,
  ) {
    return this.spa.checkAvailabilityOverlap(user, dto.startAt, dto.endAt);
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

  @Put('specialist/availability/day')
  @Roles(UserRole.SPECIALIST)
  setDayHours(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSpecialistDayHoursDto,
  ) {
    return this.spa.setDayHours(user, dto.day, dto.startTime, dto.endTime);
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

  @Get('specialist/clients/by-phone')
  @Roles(
    UserRole.SPECIALIST,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.SUPER_ADMIN,
  )
  lookupClientByPhone(
    @CurrentUser() user: JwtPayload,
    @Query('phone') phone?: string,
  ) {
    return this.spa.lookupClientByPhone(user, phone ?? '');
  }

  @Post('specialist/spa-bookings')
  @Roles(UserRole.SPECIALIST)
  specialistAssign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignSpaBookingDto,
  ) {
    return this.spa.specialistAssign(user, {
      clientId: dto.clientId,
      guestName: dto.guestName,
      guestPhone: dto.guestPhone,
      serviceId: dto.serviceId,
      startAt: dto.startAt,
      paymentType: dto.paymentType,
      membershipServiceName: dto.membershipServiceName,
    });
  }

  @Post('specialist/spa-bookings/:bookingId/complete')
  @Roles(UserRole.SPECIALIST)
  specialistComplete(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.spa.specialistComplete(user, bookingId);
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
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminServices(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListServices(user);
  }

  @Post('admin/spa/services')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminUpsertService(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertSpaServiceDto,
  ) {
    return this.spa.adminUpsertService(user, {
      ...dto,
      priceOverrideMinor: dto.priceOverrideMinor,
      bookable: dto.bookable,
    });
  }

  @Get('admin/spa/quota-rules')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminQuotaRules(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListQuotaRules(user);
  }

  @Put('admin/spa/quota-rules')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminSetQuotaRules(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSpaQuotaRulesDto,
  ) {
    return this.spa.adminSetQuotaRules(user, dto.rules);
  }

  @Get('admin/spa/specialists')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminSpecialists(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListSpecialists(user);
  }

  @Put('admin/spa/specialists/:id/services')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminSetSpecialistServices(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SetSpecialistServicesDto,
  ) {
    return this.spa.adminSetSpecialistServices(user, id, dto.serviceIds);
  }

  @Get('admin/spa/calendar')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminCalendar(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.spa.adminCalendar(user, from, to);
  }

  @Get('admin/spa-board')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminSpaBoard(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('specialistIds') specialistIds?: string,
    @Query('serviceIds') serviceIds?: string,
    @Query('status') status?: string,
    @Query('approval') approval?: string,
  ) {
    const split = (raw?: string) =>
      raw
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return this.spa.getAdminSpaBoard(user, from, to, {
      specialistIds: split(specialistIds),
      serviceIds: split(serviceIds),
      status,
      approval,
    });
  }

  @Get('admin/spa/clients')
  @Roles(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.SPECIALIST,
  )
  adminClients(@CurrentUser() user: JwtPayload) {
    return this.spa.adminListClients(user);
  }

  @Post('admin/spa-bookings')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminAssign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignSpaBookingDto,
  ) {
    if (!dto.specialistId) {
      throw new BadRequestException('Укажите специалиста');
    }
    return this.spa.adminAssign(user, {
      clientId: dto.clientId,
      guestName: dto.guestName,
      guestPhone: dto.guestPhone,
      specialistId: dto.specialistId,
      serviceId: dto.serviceId,
      startAt: dto.startAt,
      paymentType: dto.paymentType,
      membershipServiceName: dto.membershipServiceName,
    });
  }

  @Patch('admin/spa-bookings/:bookingId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminCancelBooking(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.spa.adminCancelBooking(user, bookingId);
  }

  @Get('admin/spa/specialists/:id/work-schedule')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminGetWorkSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.spa.adminGetWorkSchedule(user, id);
  }

  @Put('admin/spa/specialists/:id/work-schedule')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminSetWorkSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SetSpecialistWorkScheduleDto,
  ) {
    return this.spa.adminSetWorkSchedule(user, id, dto.slots);
  }

  @Put('admin/spa/specialists/:id/availability/day')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminSetDayHours(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SetSpecialistDayHoursDto,
  ) {
    return this.spa.adminSetDayHours(
      user,
      id,
      dto.day,
      dto.startTime,
      dto.endTime,
    );
  }

  @Post('admin/spa/specialists/:id/schedule/fill-from-template')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminFillFromTemplate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PublishSpecialistScheduleDto,
  ) {
    return this.spa.adminFillFromTemplate(
      user,
      id,
      dto.periodStart,
      dto.periodEnd,
    );
  }

  @Post('admin/spa/specialists/:id/schedule/publish')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  adminPublishSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PublishSpecialistScheduleDto,
  ) {
    return this.spa.adminPublishSchedule(
      user,
      id,
      dto.periodStart,
      dto.periodEnd,
    );
  }
}
