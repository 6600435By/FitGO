import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupSessionController } from './group-session.controller';
import { GroupSessionService } from './group-session.service';

@Module({
  imports: [AuthModule],
  controllers: [GroupSessionController],
  providers: [GroupSessionService],
  exports: [GroupSessionService],
})
export class GroupSessionModule {}
