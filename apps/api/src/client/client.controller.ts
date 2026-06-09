import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClientService } from './client.service';
import { BookSessionDto } from './dto/book-session.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Controller('client')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.clientService.getDashboard(user);
  }

  @Get('schedule')
  getSchedule(@CurrentUser() user: JwtPayload) {
    return this.clientService.getSchedule(user);
  }

  @Get('products')
  getProducts(@CurrentUser() user: JwtPayload) {
    return this.clientService.getProducts(user);
  }

  @Get('bookings')
  getBookings(@CurrentUser() user: JwtPayload) {
    return this.clientService.getBookings(user);
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
