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
import {
  UserRole,
  type DiscrepancyTaskCreateBody,
  type DiscrepancyTaskRuleDto,
} from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { DiscrepanciesService } from './discrepancies.service';
import { DiscrepancyTasksService } from './discrepancy-tasks.service';

type ListQuery = {
  from?: string;
  to?: string;
  employee?: string;
  showAcked?: string;
};

@Controller('super-admin/discrepancies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
export class DiscrepanciesController {
  constructor(
    private readonly discrepancies: DiscrepanciesService,
    private readonly tasks: DiscrepancyTasksService,
  ) {}

  private opts(q: ListQuery) {
    return {
      from: q.from,
      to: q.to,
      employee: q.employee,
      showAcked: q.showAcked === '1' || q.showAcked === 'true',
    };
  }

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload, @Query() q: ListQuery) {
    return this.discrepancies.summary(user, this.opts(q));
  }

  @Get('segments')
  segments(@CurrentUser() user: JwtPayload, @Query() q: ListQuery) {
    return this.discrepancies.segmentsTab(user, this.opts(q));
  }

  @Post('segments/recheck')
  recheck(@CurrentUser() user: JwtPayload) {
    return this.discrepancies.recheckSegments(user);
  }

  @Get('sales')
  sales(@CurrentUser() user: JwtPayload, @Query() q: ListQuery) {
    return this.discrepancies.salesTab(user, this.opts(q));
  }

  @Get('spa')
  spa(@CurrentUser() user: JwtPayload, @Query() q: ListQuery) {
    return this.discrepancies.spaPtTab(user, 'SPA', this.opts(q));
  }

  @Get('pt')
  pt(@CurrentUser() user: JwtPayload, @Query() q: ListQuery) {
    return this.discrepancies.spaPtTab(user, 'PT', this.opts(q));
  }

  @Get('group')
  group(@CurrentUser() user: JwtPayload, @Query() q: ListQuery) {
    return this.discrepancies.groupTab(user, this.opts(q));
  }

  @Post('ack')
  ack(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      tab?: string;
      itemKey?: string;
      fingerprint?: string;
      note?: string;
    },
  ) {
    return this.discrepancies.ack(user, body);
  }

  @Delete('ack/:id')
  unack(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.discrepancies.unack(user, id);
  }

  @Get('tasks/options')
  taskOptions(
    @CurrentUser() user: JwtPayload,
    @Query()
    q: { date?: string; at?: string; tab?: string; performerUserId?: string },
  ) {
    return this.tasks.options(user, q);
  }

  @Get('tasks/links')
  taskLinks(@CurrentUser() user: JwtPayload, @Query('tab') tab?: string) {
    return this.tasks.links(user, tab);
  }

  @Post('tasks')
  createTask(
    @CurrentUser() user: JwtPayload,
    @Body() body: DiscrepancyTaskCreateBody,
  ) {
    return this.tasks.create(user, body);
  }

  @Get('tasks/rules')
  rules(@CurrentUser() user: JwtPayload) {
    return this.tasks.getRules(user);
  }

  @Put('tasks/rules')
  saveRules(
    @CurrentUser() user: JwtPayload,
    @Body() body: { rules?: DiscrepancyTaskRuleDto[] },
  ) {
    return this.tasks.saveRules(user, body.rules ?? []);
  }

  @Post('tasks/auto/run')
  runAuto(@CurrentUser() user: JwtPayload) {
    return this.tasks.runAutoForUser(user);
  }
}

/** Inbox for any staff member assigned a task from the manager / «Нестыковки». */
@Controller('staff-tasks')
@UseGuards(JwtAuthGuard)
export class StaffTasksController {
  constructor(private readonly tasks: DiscrepancyTasksService) {}

  @Get('mine')
  mine(@CurrentUser() user: JwtPayload) {
    return this.tasks.mine(user);
  }

  @Post(':id/done')
  done(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return this.tasks.complete(user, id, body?.comment);
  }
}
