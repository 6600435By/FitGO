/**
 * Smoke: build membership efficiency for last 90 days (ended basis).
 * Run: cd apps/api && npx tsx scripts/smoke-membership-efficiency.ts
 */
import { PrismaClient } from '@prisma/client';
import { MembershipEfficiencyService } from '../src/analytics/membership-efficiency.service';
import { PayrollService } from '../src/payroll/payroll.service';

// Minimal stubs — we only need prisma + payroll for buildInstances path via getReport.
async function main() {
  const prisma = new PrismaClient();
  const club = await prisma.club.findFirst({ select: { id: true } });
  if (!club) {
    console.log('NO_CLUB');
    await prisma.$disconnect();
    return;
  }

  // Direct query path similar to service filter: VIP packages ended recently
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const from = fromDate.toISOString().slice(0, 10);

  const vipMembers = await prisma.onexClassSessionMember.findMany({
    where: {
      cancelled: false,
      attendance: 'ATTENDED',
      packageDocId: { not: null },
      paymentBasis: { contains: 'VIP', mode: 'insensitive' },
      session: {
        clubId: club.id,
        kind: 'GROUP',
        isActive: true,
        status: 'COMPLETED',
      },
    },
    select: {
      packageDocId: true,
      paymentBasis: true,
      packageValidUntil: true,
      externalId: true,
      clientName: true,
    },
    distinct: ['packageDocId'],
    take: 20,
  });

  const ended = vipMembers.filter((m) => {
    const end = (m.packageValidUntil ?? '').slice(0, 10);
    return end >= from && end <= to;
  });

  console.log('period', from, to);
  console.log('VIP distinct packages sampled', vipMembers.length);
  console.log('VIP ended in period (from sample)', ended.length);
  for (const e of ended.slice(0, 5)) {
    console.log(
      '-',
      e.clientName,
      e.paymentBasis?.slice(0, 60),
      'until',
      e.packageValidUntil?.slice(0, 10),
    );
  }

  // Count all VIP ended via packageValidUntil string compare (approx)
  const allVip = await prisma.onexClassSessionMember.findMany({
    where: {
      cancelled: false,
      attendance: 'ATTENDED',
      packageDocId: { not: null },
      OR: [
        { paymentBasis: { contains: 'VIP', mode: 'insensitive' } },
        { paymentBasis: { contains: 'Единый', mode: 'insensitive' } },
        { paymentBasis: { contains: 'Все включено', mode: 'insensitive' } },
      ],
      session: {
        clubId: club.id,
        kind: { in: ['GROUP', 'SPA', 'SOLARIUM'] },
        isActive: true,
      },
    },
    select: { packageDocId: true, packageValidUntil: true, paymentBasis: true },
    distinct: ['packageDocId'],
  });
  const endedAll = allVip.filter((m) => {
    const end = (m.packageValidUntil ?? '').slice(0, 10);
    return end >= from && end <= to;
  });
  console.log('family packages total', allVip.length, 'ended in 90d', endedAll.length);

  await prisma.$disconnect();
  void MembershipEfficiencyService;
  void PayrollService;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
