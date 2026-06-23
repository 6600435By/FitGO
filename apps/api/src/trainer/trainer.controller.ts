import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClubMembershipService } from '../common/club-membership.service';
import { TrainerService } from './trainer.service';
import { TrainerRosterService } from './trainer-roster.service';
import { AddGoalDto } from './dto/add-goal.dto';
import { AddMeasurementDto } from './dto/add-measurement.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { AddOfflineClientDto } from './dto/add-offline-client.dto';
import { InviteClientDto } from './dto/invite-client.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('trainer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAINER)
export class TrainerController {
  constructor(
    private readonly trainerService: TrainerService,
    private readonly roster: TrainerRosterService,
    private readonly clubMembership: ClubMembershipService,
  ) {}

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.trainerService.getDashboard(user);
  }

  @Get('clients')
  async listClients(@CurrentUser() user: JwtPayload) {
    const membership = await this.clubMembership.getActiveMembership(user.sub);
    return this.roster.listClients(user.sub, membership?.clubId ?? user.clubId);
  }

  @Post('clients')
  addOfflineClient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AddOfflineClientDto,
  ) {
    return this.roster.addOfflineClient(user.sub, dto);
  }

  @Post('clients/invite')
  inviteClient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InviteClientDto,
  ) {
    return this.roster.inviteClient(user.sub, dto.phone);
  }

  @Get('message-recipients')
  getMessageRecipients(@CurrentUser() user: JwtPayload) {
    return this.trainerService.getMessageRecipients(user);
  }

  @Get('clients/:clientId')
  getClient(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.trainerService.getClientDetail(user, clientId);
  }

  @Post('clients/:clientId/notes')
  addNote(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.trainerService.addNote(user, clientId, dto.content);
  }

  @Post('clients/:clientId/goals')
  addGoal(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Body() dto: AddGoalDto,
  ) {
    return this.trainerService.addGoal(user, clientId, dto);
  }

  @Post('clients/:clientId/measurements')
  addMeasurement(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Body() dto: AddMeasurementDto,
  ) {
    return this.trainerService.addMeasurement(user, clientId, dto);
  }

  @Post('clients/:clientId/message')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.trainerService.sendClientMessage(user, clientId, dto.message);
  }
}
