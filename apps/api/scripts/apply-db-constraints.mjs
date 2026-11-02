/**
 * Apply idempotent Postgres constraints from scripts/sql/club-sync-constraints.sql
 * after `prisma db push` (which does not manage EXCLUDE / partial unique indexes).
 *
 * Specialist SPA overlap EXCLUDE is dropped first (app-enforced). Remaining DDL
 * runs in one transaction so a failed ADD rolls back its matching DROP.
 *
 * Usage (from repo root):
 *   pnpm --filter @fitgo/api exec node ./scripts/apply-db-constraints.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));

const SPECIALIST_DROP =
  'ALTER TABLE "SpaBooking" DROP CONSTRAINT IF EXISTS spa_booking_no_overlap_specialist';

function splitSqlStatements(sql) {
  const withoutLineComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  return withoutLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeStmt(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolveSqlPath() {
  const candidates = [
    join(here, '..', '..', '..', 'scripts', 'sql', 'club-sync-constraints.sql'),
    join(process.cwd(), 'scripts', 'sql', 'club-sync-constraints.sql'),
    join(process.cwd(), '..', '..', 'scripts', 'sql', 'club-sync-constraints.sql'),
  ];
  for (const p of candidates) {
    try {
      return { path: p, raw: readFileSync(p, 'utf8') };
    } catch {
      /* try next */
    }
  }
  throw new Error(
    'Could not find scripts/sql/club-sync-constraints.sql relative to apply-db-constraints.mjs',
  );
}

try {
  const { path, raw } = resolveSqlPath();
  const statements = splitSqlStatements(raw);
  const specialistNorm = normalizeStmt(SPECIALIST_DROP);
  const rest = statements.filter(
    (s) => normalizeStmt(s) !== specialistNorm,
  );

  // Always drop specialist EXCLUDE first — independent of other constraints.
  console.log('Dropping spa_booking_no_overlap_specialist (if present)…');
  await prisma.$executeRawUnsafe(SPECIALIST_DROP);

  console.log(
    `Applying ${rest.length} SQL statement(s) in one transaction from ${path}…`,
  );
  await prisma.$transaction(async (tx) => {
    for (const stmt of rest) {
      await tx.$executeRawUnsafe(stmt);
    }
  });
  console.log('DB constraints applied.');
} catch (err) {
  console.error('apply-db-constraints failed:', err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
