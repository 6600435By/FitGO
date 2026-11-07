import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { TrainerLedgerController } from './trainer-ledger.controller';
import { TrainerLedgerService } from './trainer-ledger.service';

@Module({
  imports: [PayrollModule],
  controllers: [TrainerLedgerController],
  providers: [TrainerLedgerService],
  exports: [TrainerLedgerService],
})
export class TrainerLedgerModule {}
