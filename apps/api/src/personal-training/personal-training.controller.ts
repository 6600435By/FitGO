import {
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
import { type WorkoutSheet } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { BookPersonalTrainingDto } from './dto/book-personal-training.dto';
import { SetWorkScheduleDto } from './dto/set-work-schedule.dto';
import { UpdateSessionPlanDto } from './dto/update-session-plan.dto';
import { SetAvailabilityBlocksDto } from './dto/set-availability-blocks.dto';
import { PublishScheduleDto } from './dto/publish-schedule.dto';
import { AssignPersonalBookingDto } from './dto/assign-personal-booking.dto';
import { UpdateTrainerBookingDto } from './dto/update-trainer-booking.dto';
import { PersonalTrainingService } from './personal-training.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PersonalTrainingController {
  constructor(private readonly personalTraining: PersonalTrainingService) {}

  @Get('trainer/work-schedule')
  @Roles(UserRole.TRAINER)
  getWorkSchedule(@CurrentUser() user: JwtPayload) {
    return this.personalTraining.getTrainerWorkSchedule(user);
  }

  @Put('trainer/work-schedule')
  @Roles(UserRole.TRAINER)
  setWorkSchedule(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetWorkScheduleDto,
  ) {
    return this.personalTraining.setTrainerWorkSchedule(user, dto.slots);
  }

  @Get('trainer/personal-bookings')
  @Roles(UserRole.TRAINER)
  getTrainerBookings(@CurrentUser() user: JwtPayload) {
    return this.personalTraining.getTrainerPersonalBookings(user);
  }

  @Get('trainer/calendar')
  @Roles(UserRole.TRAINER)
  getTrainerCalendar(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.personalTraining.getTrainerCalendar(user, from, to);
  }

  @Get('trainer/availability-blocks')
  @Roles(UserRole.TRAINER)
  getAvailabilityBlocks(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.personalTraining.getAvailabilityBlocks(user, from, to);
  }

  @Put('trainer/availability-blocks')
  @Roles(UserRole.TRAINER)
  setAvailabilityBlocks(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetAvailabilityBlocksDto,
  ) {
    return this.personalTraining.setAvailabilityBlocks(
      user,
      dto.periodStart,
      dto.periodEnd,
      dto.blocks,
    );
  }

  @Post('trainer/schedule/fill-from-template')
  @Roles(UserRole.TRAINER)
  fillFromTemplate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishScheduleDto,
  ) {
    return this.personalTraining.fillFromTemplate(
      user,
      dto.periodStart,
      dto.periodEnd,
    );
  }

  @Post('trainer/schedule/publish')
  @Roles(UserRole.TRAINER)
  publishSchedule(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishScheduleDto,
  ) {
    return this.personalTraining.publishSchedule(
      user,
      dto.periodStart,
      dto.periodEnd,
    );
  }

  @Post('trainer/personal-bookings')
  @Roles(UserRole.TRAINER)
  assignPersonalBooking(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignPersonalBookingDto,
  ) {
    return this.personalTraining.assignPersonalBooking(
      user,
      dto.clientId,
      dto.startAt,
    );
  }

  @Patch('trainer/personal-bookings/:bookingId')
  @Roles(UserRole.TRAINER)
  updateTrainerPersonalBooking(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateTrainerBookingDto,
  ) {
    return this.personalTraining.updateTrainerPersonalBooking(
      user,
      bookingId,
      dto,
    );
  }

  @Get('client/trainers')
  @Roles(UserRole.CLIENT)
  listTrainers(@CurrentUser() user: JwtPayload) {
    return this.personalTraining.listAvailableTrainers(requireClubId(user));
  }

  @Get('client/trainers/:trainerId/slots')
  @Roles(UserRole.CLIENT)
  getTrainerSlots(
    @CurrentUser() user: JwtPayload,
    @Param('trainerId') trainerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.personalTraining.getTrainerAvailableSlots(
      requireClubId(user),
      trainerId,
      from,
      to,
    );
  }

  @Post('client/personal-bookings')
  @Roles(UserRole.CLIENT)
  bookPersonal(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BookPersonalTrainingDto,
  ) {
    return this.personalTraining.bookPersonalSession(
      user,
      dto.trainerId,
      dto.startAt,
    );
  }

  @Get('client/personal-bookings')
  @Roles(UserRole.CLIENT)
  getClientPersonalBookings(@CurrentUser() user: JwtPayload) {
    return this.personalTraining.getClientPersonalBookings(user);
  }

  @Delete('client/personal-bookings/:bookingId')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  cancelPersonal(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.personalTraining.cancelPersonalBooking(user, bookingId);
  }

  @Get('personal-bookings/goal-templates')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  getGoalTemplates() {
    return this.personalTraining.getGoalTemplates();
  }

  @Get('personal-bookings/:bookingId')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  getSessionDetail(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.personalTraining.getSessionDetail(user, bookingId);
  }

  @Get('personal-bookings/:bookingId/previous-sheet')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  getPreviousSheet(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.personalTraining.getPreviousWorkoutSheet(user, bookingId);
  }

  @Get('personal-bookings/:bookingId/circuit-history')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  getCircuitHistory(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.personalTraining.getCircuitHistory(user, bookingId);
  }

  @Put('personal-bookings/:bookingId/plan')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  updateSessionPlan(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateSessionPlanDto,
  ) {
    return this.personalTraining.updateSessionPlan(
      user,
      bookingId,
      dto.goals,
      dto.workoutSheet as WorkoutSheet | undefined,
    );
  }

  @Post('personal-bookings/:bookingId/goals/:goalId/confirm')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  confirmSessionGoal(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Param('goalId') goalId: string,
  ) {
    return this.personalTraining.confirmSessionGoal(user, bookingId, goalId);
  }

  @Post('personal-bookings/:bookingId/tasks/:taskId/confirm')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  confirmSessionTask(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.personalTraining.confirmSessionTask(user, bookingId, taskId);
  }

  @Post('personal-bookings/:bookingId/complete')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  completeSession(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.personalTraining.completeSession(user, bookingId);
  }
}
