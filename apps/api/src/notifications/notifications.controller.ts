import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { SendStaffMessageDto } from './dto/send-staff-message.dto';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('filter') filter?: 'all' | 'pending' | 'completed' | 'unread',
  ) {
    return this.notifications.getNotifications(user.sub, filter ?? 'all');
  }

  @Patch(':id/read')
  markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(user.sub, id);
  }

  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  markComplete(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notifications.markComplete(user.sub, id, user.roles);
  }

  @Post('staff-message')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  sendStaffMessage(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendStaffMessageDto,
  ) {
    return this.notifications.sendStaffMessage(user, dto);
  }

  @Post('admin-message')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT, UserRole.TRAINER)
  sendToAdminLegacy(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { message: string },
  ) {
    return this.notifications.sendStaffMessage(user, {
      message: dto.message,
      recipientType: 'admin',
    });
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.notifications.getPreferences(user.sub);
  }

  @Post('preferences')
  updatePreferences(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.notifications.updatePreferences(user.sub, dto);
  }

  @Post('subscribe')
  subscribe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubscribePushDto,
  ) {
    return this.notifications.subscribePush(user.sub, dto);
  }
}
