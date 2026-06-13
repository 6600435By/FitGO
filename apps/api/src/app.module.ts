import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { ClientModule } from './client/client.module';
import { EngagementModule } from './engagement/engagement.module';
import { FitnessModule } from './fitness/fitness.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PersonalTrainingModule } from './personal-training/personal-training.module';
import { PrismaModule } from './prisma/prisma.module';
import { TrainerModule } from './trainer/trainer.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    FitnessModule,
    AuthModule,
    ClientModule,
    TrainerModule,
    AdminModule,
    NotificationsModule,
    ChatModule,
    EngagementModule,
    PersonalTrainingModule,
  ],
})
export class AppModule {}
