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
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClubMembershipService } from '../common/club-membership.service';
import { FloorStaffHomeService } from '../floor-home/floor-staff-home.service';
import { GpScheduleService } from './gp-schedule.service';
import { TrainerClientLookupService } from './trainer-client-lookup.service';
import { TrainerInsightsService } from './trainer-insights.service';
import { TrainerPersonalGoalsService } from './trainer-personal-goals.service';
import { TrainerService } from './trainer.service';
import { TrainerRosterService } from './trainer-roster.service';
import { AddGoalDto } from './dto/add-goal.dto';
import { AddMeasurementDto } from './dto/add-measurement.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { AddOfflineClientDto } from './dto/add-offline-client.dto';
import { DismissInsightDto } from './dto/dismiss-insight.dto';
import { InviteClientDto } from './dto/invite-client.dto';
import { UpdateOfflineClientDto } from './dto/update-offline-client.dto';
import { PutPersonalGoalsDto } from './dto/personal-goals.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  CreateTimerPresetDto,
  UpdateTimerPresetDto,
} from './dto/timer-preset.dto';
import {
  CreateHomeworkDto,
  UpsertGroupClassNoteDto,
} from './dto/homework.dto';

@Controller('trainer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAINER)
export class TrainerController {
  constructor(
    private readonly trainerService: TrainerService,
    private readonly roster: TrainerRosterService,
    private readonly clientLookup: TrainerClientLookupService,
    private readonly clubMembership: ClubMembershipService,
    private readonly gpSchedule: GpScheduleService,
    private readonly floorHome: FloorStaffHomeService,
    private readonly insights: TrainerInsightsService,
    private readonly personalGoals: TrainerPersonalGoalsService,
  ) {}

  @Get('gp-schedule')
  getGpSchedule(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.gpSchedule.list(user, from, to);
  }

  @Get('gp-home')
  getGpHome(
    @CurrentUser() user: JwtPayload,
    @Query('lite') lite?: string,
  ) {
    const isLite =
      lite === '1' || lite === 'true' || lite === 'yes';
    return this.floorHome.getGpTrainerHome(user, { lite: isLite });
  }

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.trainerService.getDashboard(user);
  }

  @Get('insights')
  getInsights(@CurrentUser() user: JwtPayload) {
    return this.insights.listForTrainer(user);
  }

  @Post('insights/dismiss')
  dismissInsight(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DismissInsightDto,
  ) {
    return this.insights.dismiss(user, dto.key, dto.days);
  }

  @Get('motivation-goals')
  getMotivationGoals(@CurrentUser() user: JwtPayload) {
    return this.personalGoals.getGoals(user);
  }

  @Put('motivation-goals')
  putMotivationGoals(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PutPersonalGoalsDto,
  ) {
    return this.personalGoals.putGoals(user, dto.goals);
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

  /** Phone-first lookup for add-client / assign-PT sheets. Before :clientId. */
  @Get('clients/lookup')
  lookupClient(
    @CurrentUser() user: JwtPayload,
    @Query('phone') phone?: string,
    @Query('q') q?: string,
  ) {
    if (phone?.trim()) {
      return this.clientLookup.lookupByPhone(user, phone);
    }
    if (q?.trim()) {
      return this.clientLookup.searchRosterByName(user.sub, q);
    }
    return {
      source: 'none' as const,
      phone: '',
      inRoster: false,
      found: false,
      pending: false,
    };
  }

  @Patch('clients/:clientId')
  updateClient(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateOfflineClientDto,
  ) {
    return this.roster.updateClient(user.sub, clientId, dto);
  }

  @Delete('clients/:clientId')
  removeClient(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.roster.removeClient(user.sub, clientId);
  }

  @Get('message-recipients')
  getMessageRecipients(@CurrentUser() user: JwtPayload) {
    return this.trainerService.getMessageRecipients(user);
  }

  @Get('clients/:clientId/progress')
  getClientProgress(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.trainerService.getClientProgress(user, clientId);
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

  @Post('group-bookings/:bookingId/confirm-attendance')
  confirmGroupAttendance(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
    return this.trainerService.confirmGroupAttendance(user, bookingId);
  }

  @Get('timer-presets')
  listTimerPresets(@CurrentUser() user: JwtPayload) {
    return this.trainerService.listTimerPresets(user);
  }

  @Post('timer-presets')
  createTimerPreset(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTimerPresetDto,
  ) {
    return this.trainerService.createTimerPreset(user, dto);
  }

  @Patch('timer-presets/:presetId')
  updateTimerPreset(
    @CurrentUser() user: JwtPayload,
    @Param('presetId') presetId: string,
    @Body() dto: UpdateTimerPresetDto,
  ) {
    return this.trainerService.updateTimerPreset(user, presetId, dto);
  }

  @Delete('timer-presets/:presetId')
  deleteTimerPreset(
    @CurrentUser() user: JwtPayload,
    @Param('presetId') presetId: string,
  ) {
    return this.trainerService.deleteTimerPreset(user, presetId);
  }

  @Post('homework')
  createHomework(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHomeworkDto,
  ) {
    return this.trainerService.createHomework(user, dto);
  }

  @Post('sessions/:bookingId/notify-notes')
  notifySessionNotes(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
    @Body() body: { hasHomework?: boolean },
  ) {
    return this.trainerService.notifySessionNotes(
      user,
      bookingId,
      Boolean(body.hasHomework),
    );
  }

  @Get('clients/:clientId/homework')
  listClientHomework(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.trainerService.listClientHomework(user, clientId);
  }

  @Get('clients/:clientId/homework/previous')
  previousHomework(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.trainerService.getPreviousHomework(user, clientId);
  }

  @Get('group-notes/:sessionKey')
  getGroupNote(
    @CurrentUser() user: JwtPayload,
    @Param('sessionKey') sessionKey: string,
  ) {
    return this.trainerService.getGroupClassNote(user, sessionKey);
  }

  @Post('group-notes')
  upsertGroupNote(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertGroupClassNoteDto,
  ) {
    return this.trainerService.upsertGroupClassNote(user, dto);
  }
}
