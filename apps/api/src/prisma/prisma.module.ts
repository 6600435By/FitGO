import { Global, Module } from '@nestjs/common';
import { ClubMembershipService } from '../common/club-membership.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, ClubMembershipService],
  exports: [PrismaService, ClubMembershipService],
})
export class PrismaModule {}
