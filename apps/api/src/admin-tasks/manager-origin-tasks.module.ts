import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ManagerOriginTasksService } from './manager-origin-tasks.service';

@Module({
  imports: [PrismaModule],
  providers: [ManagerOriginTasksService],
  exports: [ManagerOriginTasksService],
})
export class ManagerOriginTasksModule {}
