import { Global, Module } from '@nestjs/common';
import { ClientPhoneLookupService } from '../common/client-phone-lookup.service';
import { ClubMembershipService } from '../common/club-membership.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, ClubMembershipService, ClientPhoneLookupService],
  exports: [PrismaService, ClubMembershipService, ClientPhoneLookupService],
})
export class PrismaModule {}
