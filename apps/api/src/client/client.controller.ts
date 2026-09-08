import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { RequireModule } from '../features/require-module.decorator';
import { ModuleGuard } from '../features/module.guard';
import { TrainerRosterService } from '../trainer/trainer-roster.service';
import { ClientService } from './client.service';
import { ClientProfileService } from './client-profile.service';
import { BookSessionDto } from './dto/book-session.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FreezeMembershipDto } from './dto/freeze-membership.dto';
import { JoinClubDto } from './dto/join-club.dto';
import {
  CreateBodyLogDto,
  UpdateBodyProfileDto,
  UpdateClientProfileDto,
  UpdateGamificationSettingsDto,
} from './dto/client-profile.dto';

@Controller('client')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@Roles(UserRole.CLIENT)
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly profileService: ClientProfileService,
    private readonly roster: TrainerRosterService,
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
    return this.profileService.updateProfile(user.sub, requireClubId(user), dto);
  }

  @Patch('profile/gamification')
  updateGamificationSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateGamificationSettingsDto,
  ) {
    return this.profileService.updateGamificationSettings(user.sub, requireClubId(user), dto);
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

  @Get('clubs')
  listClubs() {
    return this.clientService.listClubs();
  }

  @Post('club/join')
  joinClub(@CurrentUser() user: JwtPayload, @Body() dto: JoinClubDto) {
    return this.clientService.joinClub(user, dto.clubSlug, dto.externalId);
  }

  @Get('membership')
  @RequireModule('membership_read')
  getMembership(@CurrentUser() user: JwtPayload) {
    return this.clientService.getMembership(user);
  }

  @Post('membership/freeze')
  @RequireModule('membership_read')
  freezeMembership(
    @CurrentUser() user: JwtPayload,
    @Body() dto: FreezeMembershipDto,
  ) {
    return this.clientService.freezeMembership(user, dto.days, dto.fromDate);
  }

  @Get('visits')
  @RequireModule('club_card')
  getVisits(@CurrentUser() user: JwtPayload) {
    return this.clientService.getClubVisits(user);
  }

  @Get('schedule')
  @RequireModule('group_classes')
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
  @RequireModule('membership_shop')
  getProducts(@CurrentUser() user: JwtPayload) {
    return this.clientService.getProducts(user);
  }

  @Get('bookings')
  @RequireModule('group_classes')
  getBookings(@CurrentUser() user: JwtPayload) {
    return this.clientService.getBookings(user);
  }

  @Get('booking-history')
  @RequireModule('group_classes')
  getBookingHistory(
    @CurrentUser() user: JwtPayload,
    @Query('filter') filter?: 'all' | 'upcoming' | 'completed' | 'cancelled',
  ) {
    return this.clientService.getBookingHistory(user, filter ?? 'all');
  }

  @Get('club-trainers')
  getClubTrainers(@CurrentUser() user: JwtPayload) {
    return this.clientService.getClubTrainers(requireClubId(user));
  }

  @Post('book')
  @RequireModule('group_classes')
  bookSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BookSessionDto,
  ) {
    return this.clientService.bookSession(user, dto.sessionId);
  }

  @Delete('bookings/:sessionId')
  @RequireModule('group_classes')
  cancelBooking(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.clientService.cancelBooking(user, sessionId);
  }

  @Get('waitlist')
  @RequireModule('group_classes')
  getWaitlist(@CurrentUser() user: JwtPayload) {
    return this.clientService.getWaitlist(user);
  }

  @Post('waitlist/:sessionId')
  @RequireModule('group_classes')
  joinWaitlist(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.clientService.joinWaitlist(user, sessionId);
  }

  @Delete('waitlist/:sessionId')
  @RequireModule('group_classes')
  leaveWaitlist(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.clientService.leaveWaitlist(user, sessionId);
  }

  @Post('waitlist/:sessionId/confirm')
  @RequireModule('group_classes')
  confirmWaitlist(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.clientService.confirmWaitlistSpot(user, sessionId);
  }

  @Post('payment')
  @RequireModule('membership_shop')
  createPayment(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.clientService.createPayment(user, dto.productId);
  }

  @Get('card')
  @RequireModule('club_card')
  getClubCard(@CurrentUser() user: JwtPayload) {
    return this.clientService.getClubCard(user);
  }

  @Post('card/sync')
  @RequireModule('club_card')
  syncClubCard(@CurrentUser() user: JwtPayload) {
    return this.clientService.syncClubCard(user);
  }

  @Get('trainer-invites')
  getTrainerInvites(@CurrentUser() user: JwtPayload) {
    return this.roster.getPendingTrainerRequests(user.sub);
  }

  @Post('trainer-invites/:trainerId/accept')
  acceptTrainerInvite(
    @CurrentUser() user: JwtPayload,
    @Param('trainerId') trainerId: string,
  ) {
    return this.roster.acceptTrainerRequest(user.sub, trainerId);
  }

  @Post('trainer-invites/:trainerId/reject')
  rejectTrainerInvite(
    @CurrentUser() user: JwtPayload,
    @Param('trainerId') trainerId: string,
  ) {
    return this.roster.rejectTrainerRequest(user.sub, trainerId);
  }
}
