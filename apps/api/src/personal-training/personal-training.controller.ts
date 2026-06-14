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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { BookPersonalTrainingDto } from './dto/book-personal-training.dto';
import { SetWorkScheduleDto } from './dto/set-work-schedule.dto';
import { UpdateSessionPlanDto } from './dto/update-session-plan.dto';
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

  @Get('client/trainers')
  @Roles(UserRole.CLIENT)
  listTrainers(@CurrentUser() user: JwtPayload) {
    return this.personalTraining.listAvailableTrainers(user.clubId);
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
      user.clubId,
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

  @Put('personal-bookings/:bookingId/plan')
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  updateSessionPlan(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateSessionPlanDto,
  ) {
    return this.personalTraining.updateSessionPlan(user, bookingId, dto.goals);
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
