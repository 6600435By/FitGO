import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WebkassaController } from './webkassa.controller';
import { WebkassaSchedulerService } from './webkassa-scheduler.service';
import { WebkassaService } from './webkassa.service';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule],
  controllers: [WebkassaController],
  providers: [WebkassaService, WebkassaSchedulerService],
  exports: [WebkassaService],
})
export class WebkassaModule {}
