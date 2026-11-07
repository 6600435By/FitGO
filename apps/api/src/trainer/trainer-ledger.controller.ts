import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import {
  RecordPaymentDto,
  SellPackageDto,
  SetDefaultSessionPriceDto,
  UpsertOwnPackageDto,
} from './dto/trainer-ledger.dto';
import { TrainerLedgerService } from './trainer-ledger.service';

@Controller('trainer/ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAINER)
export class TrainerLedgerController {
  constructor(private readonly ledger: TrainerLedgerService) {}

  @Get('overview')
  overview(@CurrentUser() user: JwtPayload) {
    return this.ledger.overview(user);
  }

  @Get('packages')
  listTemplates(@CurrentUser() user: JwtPayload) {
    return this.ledger.listTemplates(user);
  }

  @Post('packages')
  upsertTemplate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertOwnPackageDto,
  ) {
    return this.ledger.upsertTemplate(user, dto);
  }

  @Patch('settings/session-price')
  setSessionPrice(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetDefaultSessionPriceDto,
  ) {
    return this.ledger.setDefaultSessionPrice(user, dto.priceMinor ?? null);
  }

  @Post('sell')
  sellPackage(@CurrentUser() user: JwtPayload, @Body() dto: SellPackageDto) {
    return this.ledger.sellPackage(user, dto);
  }

  @Post('payments')
  recordPayment(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.ledger.recordPayment(user, dto);
  }

  @Get('clients/:clientId')
  clientSnapshot(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.ledger.clientSnapshot(user, clientId);
  }
}
