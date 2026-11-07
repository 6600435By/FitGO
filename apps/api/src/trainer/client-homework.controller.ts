import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CheckHomeworkItemDto } from './dto/homework.dto';
import { TrainerService } from './trainer.service';

@Controller('client/homework')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class ClientHomeworkController {
  constructor(private readonly trainerService: TrainerService) {}

  @Get('active')
  getActive(@CurrentUser() user: JwtPayload) {
    return this.trainerService.getActiveHomeworkForClient(user.sub);
  }

  @Post('items/:itemId/check')
  checkItem(
    @CurrentUser() user: JwtPayload,
    @Param('itemId') itemId: string,
    @Body() dto: CheckHomeworkItemDto,
  ) {
    return this.trainerService.checkHomeworkItem(
      user.sub,
      itemId,
      dto.dayKey,
      dto.done ?? true,
    );
  }
}
