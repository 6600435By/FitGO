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
import { SpaBookingModule } from './spa-booking/spa-booking.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServiceUsageModule } from './service-usage/service-usage.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { TrainerModule } from './trainer/trainer.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { OsmiModule } from './osmi/osmi.module';
import { FeaturesModule } from './features/features.module';
import { GroupSessionModule } from './group-session/group-session.module';
import { PayrollModule } from './payroll/payroll.module';
import { PtTimesheetModule } from './pt-timesheet/pt-timesheet.module';
import { StaffRosterModule } from './staff-roster/staff-roster.module';
import { AdminSalesModule } from './admin-sales/admin-sales.module';
import { SegmentsModule } from './segments/segments.module';
import { ClassSyncModule } from './class-sync/class-sync.module';
import { BookingControlModule } from './booking-control/booking-control.module';
import { HallSnapshotModule } from './hall-snapshot/hall-snapshot.module';
import { StaffProfileModule } from './staff-profile/staff-profile.module';
import { ClubScheduleModule } from './club-schedule/club-schedule.module';
import { ClubSyncModule } from './club-sync/club-sync.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    FitnessModule,
    FeaturesModule,
    ServiceUsageModule,
    AuthModule,
    ClientModule,
    TrainerModule,
    AdminModule,
    SuperAdminModule,
    AnalyticsModule,
    NotificationsModule,
    ChatModule,
    EngagementModule,
    PersonalTrainingModule,
    SpaBookingModule,
    WaitlistModule,
    OsmiModule,
    GroupSessionModule,
    PayrollModule,
    PtTimesheetModule,
    StaffRosterModule,
    AdminSalesModule,
    SegmentsModule,
    ClassSyncModule,
    ClubSyncModule,
    BookingControlModule,
    HallSnapshotModule,
    StaffProfileModule,
    ClubScheduleModule,
  ],
})
export class AppModule {}
