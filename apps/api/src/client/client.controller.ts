import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClientService } from './client.service';
import { ClientProfileService } from './client-profile.service';
import { BookSessionDto } from './dto/book-session.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  CreateBodyLogDto,
  UpdateBodyProfileDto,
  UpdateClientProfileDto,
  UpdateGamificationSettingsDto,
} from './dto/client-profile.dto';

@Controller('client')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly profileService: ClientProfileService,
  ) {}

  @Get('profile')
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.profileService.getProfile(user.sub);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.profileService.updateProfile(user.sub, user.clubId, dto);
  }

  @Patch('profile/gamification')
  updateGamificationSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateGamificationSettingsDto,
  ) {
    return this.profileService.updateGamificationSettings(user.sub, user.clubId, dto);
  }

  @Get('body')
  getBody(@CurrentUser() user: JwtPayload) {
    return this.profileService.getBodyProfile(user.sub);
  }

  @Patch('body/profile')
  updateBodyProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateBodyProfileDto,
  ) {
    return this.profileService.updateBodyProfile(user.sub, dto);
  }

  @Post('body/log')
  addBodyLog(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBodyLogDto,
  ) {
    return this.profileService.addBodyLog(user.sub, dto);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.clientService.getDashboard(user);
  }

  @Get('schedule')
  getSchedule(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('serviceId') serviceId?: string,
    @Query('trainerId') trainerId?: string,
  ) {
    return this.clientService.getSchedule(user, {
      from,
      to,
      serviceId,
      trainerId,
    });
  }

  @Get('products')
  getProducts(@CurrentUser() user: JwtPayload) {
    return this.clientService.getProducts(user);
  }

  @Get('bookings')
  getBookings(@CurrentUser() user: JwtPayload) {
    return this.clientService.getBookings(user);
  }

  @Get('booking-history')
  getBookingHistory(
    @CurrentUser() user: JwtPayload,
    @Query('filter') filter?: 'all' | 'upcoming' | 'completed' | 'cancelled',
  ) {
    return this.clientService.getBookingHistory(user, filter ?? 'all');
  }

  @Get('club-trainers')
  getClubTrainers(@CurrentUser() user: JwtPayload) {
    return this.clientService.getClubTrainers(user.clubId);
  }

  @Post('book')
  bookSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BookSessionDto,
  ) {
    return this.clientService.bookSession(user, dto.sessionId);
  }

  @Delete('bookings/:sessionId')
  cancelBooking(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.clientService.cancelBooking(user, sessionId);
  }

  @Post('payment')
  createPayment(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.clientService.createPayment(user, dto.productId);
  }
}
