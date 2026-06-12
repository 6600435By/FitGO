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
}
