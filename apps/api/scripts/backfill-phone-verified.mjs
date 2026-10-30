/**
 * One-shot: ACTIVE users with a phone get phoneVerifiedAt so CRM link keeps working
 * after OTP gate. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const result = await prisma.$executeRawUnsafe(`
  UPDATE "User"
  SET "phoneVerifiedAt" = COALESCE("phoneVerifiedAt", "activatedAt", NOW())
  WHERE "phoneNormalized" IS NOT NULL
    AND "accountStatus" = 'ACTIVE'
    AND "phoneVerifiedAt" IS NULL
`);

console.log('phoneVerifiedAt backfill rows:', result);
await prisma.$disconnect();
