/**
 * Read-only probe: packageDocId coverage, membership sales match, personal account.
 * Run: cd apps/api && npx tsx scripts/probe-membership-efficiency.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const club = await prisma.club.findFirst({ select: { id: true, name: true } });
  if (!club) {
    console.log('NO_CLUB');
    return;
  }
  console.log('club', club.id, club.name);

  for (const kind of ['GROUP', 'SPA', 'SOLARIUM'] as const) {
    const total = await prisma.onexClassSessionMember.count({
      where: {
        cancelled: false,
        attendance: 'ATTENDED',
        session: { clubId: club.id, kind, isActive: true },
      },
    });
    const withPkg = await prisma.onexClassSessionMember.count({
      where: {
        cancelled: false,
        attendance: 'ATTENDED',
        packageDocId: { not: null },
        session: { clubId: club.id, kind, isActive: true },
      },
    });
    const pct = total ? ((withPkg / total) * 100).toFixed(1) + '%' : 'n/a';
    console.log(kind, 'attended', total, 'withPackageDocId', withPkg, pct);
  }

  const memSales = await prisma.clubRevenueEntry.count({
    where: { clubId: club.id, isActive: true, saleType: 'membership' },
  });
  const vipSales = await prisma.clubRevenueEntry.count({
    where: {
      clubId: club.id,
      isActive: true,
      saleType: 'membership',
      productName: { contains: 'VIP', mode: 'insensitive' },
    },
  });
  const ediny = await prisma.clubRevenueEntry.count({
    where: {
      clubId: club.id,
      isActive: true,
      saleType: 'membership',
      productName: { contains: 'Единый', mode: 'insensitive' },
    },
  });
  const credits = await prisma.clubRevenueEntry.aggregate({
    where: { clubId: club.id, isActive: true, operationType: 'personal_credit' },
    _count: true,
    _sum: { amount: true },
  });
  const burns = await prisma.clubRevenueEntry.aggregate({
    where: { clubId: club.id, isActive: true, operationType: 'personal_burn' },
    _count: true,
    _sum: { amount: true },
  });
  console.log('membership sales', memSales, 'VIP', vipSales, 'Единый', ediny);
  console.log(
    'personal_credit',
    credits._count,
    'sum',
    credits._sum.amount,
    'personal_burn',
    burns._count,
    'sum',
    burns._sum.amount,
  );

  const samples = await prisma.onexClassSessionMember.findMany({
    where: {
      packageDocId: { not: null },
      cancelled: false,
      attendance: 'ATTENDED',
      session: { clubId: club.id, kind: 'GROUP', isActive: true },
    },
    select: {
      packageDocId: true,
      paymentBasis: true,
      packageValidUntil: true,
      externalId: true,
    },
    take: 8,
    distinct: ['packageDocId'],
  });
  console.log('sample GROUP packages:');
  for (const s of samples) {
    const sale = await prisma.clubRevenueEntry.findFirst({
      where: {
        clubId: club.id,
        isActive: true,
        saleType: 'membership',
        clientExternalId: s.externalId,
      },
      orderBy: { occurredAt: 'desc' },
      select: {
        productName: true,
        paidAmount: true,
        saleAmount: true,
        occurredAt: true,
        clientName: true,
      },
    });
    console.log(
      '-',
      s.paymentBasis,
      'until',
      s.packageValidUntil,
      'client',
      s.externalId?.slice(0, 8),
      '→ sale',
      sale
        ? `${sale.productName} paid=${sale.paidAmount} at ${sale.occurredAt.toISOString().slice(0, 10)}`
        : 'NONE',
    );
  }

  const hall = await prisma.clubHallVisit.count({
    where: { clubId: club.id, isActive: true },
  });
  console.log('hall visits', hall);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
