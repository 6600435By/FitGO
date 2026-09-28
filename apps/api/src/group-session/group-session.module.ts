import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FitnessModule } from '../fitness/fitness.module';
import { GroupSessionController } from './group-session.controller';
import { GroupSessionService } from './group-session.service';

@Module({
  imports: [AuthModule, FitnessModule],
  controllers: [GroupSessionController],
  providers: [GroupSessionService],
  exports: [GroupSessionService],
})
export class GroupSessionModule {}
