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
import { requireClubId } from '../auth/require-club-id';
import { GroupSessionService } from './group-session.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class GroupSessionController {
  constructor(private readonly sessions: GroupSessionService) {}

  @Post('trainer/group-sessions/open')
  @Roles(UserRole.TRAINER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  open(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      appointmentId: string;
      title: string;
      startAt: string;
      endAt: string;
      trainerId?: string;
    },
  ) {
    return this.sessions.openJournal(user, body);
  }

  @Get('trainer/group-sessions')
  @Roles(UserRole.TRAINER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listMine(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.sessions.listTrainerSessions(user, from, to);
  }

  @Get('trainer/group-sessions/:id')
  @Roles(UserRole.TRAINER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sessions.getSession(user, id);
  }

  @Patch('trainer/group-sessions/:id/members/:memberId')
  @Roles(UserRole.TRAINER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  setAttendance(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: { attendance: 'ATTENDED' | 'NO_SHOW' | 'REMOVED' | 'EXPECTED' },
  ) {
    return this.sessions.setMemberAttendance(
      user,
      id,
      memberId,
      body.attendance,
    );
  }

  @Post('trainer/group-sessions/:id/members')
  @Roles(UserRole.TRAINER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: { clientId?: string; displayName: string; externalId?: string },
  ) {
    return this.sessions.addMember(user, id, body);
  }

  @Post('trainer/group-sessions/:id/submit')
  @Roles(UserRole.TRAINER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sessions.submitJournal(user, id);
  }

  @Get('admin/group-sessions/exceptions')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminExceptions(@CurrentUser() user: JwtPayload) {
    return this.sessions.listAdminExceptions(requireClubId(user));
  }

  @Post('admin/group-sessions/:id/resolve')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  resolve(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.sessions.resolveSessionException(user, id, body.note);
  }

  @Post('admin/group-sessions/:id/return')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  returnToTrainer(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sessions.returnToTrainer(user, id);
  }
}
