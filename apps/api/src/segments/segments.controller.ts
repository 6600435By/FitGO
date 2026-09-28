import {
  Controller,
  Get,
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
import { SegmentsService } from './segments.service';

@Controller('super-admin/segments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get('config')
  config(@CurrentUser() user: JwtPayload) {
    return this.segments.getConfig(user);
  }

  @Post('sync-staff')
  syncStaff(@CurrentUser() user: JwtPayload) {
    return this.segments.syncStaffFrom1C(user);
  }

  @Post('sync-nomenclature')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  syncNom(
    @CurrentUser() user: JwtPayload,
    @Query('kind') kind?: 'spa' | 'membership' | 'shop' | 'all',
  ) {
    return this.segments.syncNomenclature(user, kind ?? 'all');
  }
}