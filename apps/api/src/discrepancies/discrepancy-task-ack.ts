import type { PrismaService } from '../prisma/prisma.service';
import { retentionDays } from './discrepancies-period';
import { invalidateDiscrepancySummary } from './discrepancies.service';

export const DISCREPANCY_TASK_SOURCE = 'DISCREPANCY';

export type DiscrepancyTaskMeta = {
  tab: string;
  itemKey: string;
  fingerprint: string;
  date?: string | null;
  auto?: boolean;
};

export function discrepancyTaskMeta(meta: unknown): DiscrepancyTaskMeta | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (typeof m.tab !== 'string' || typeof m.itemKey !== 'string') return null;
  return {
    tab: m.tab,
    itemKey: m.itemKey,
    fingerprint: typeof m.fingerprint === 'string' ? m.fingerprint : '',
    date: typeof m.date === 'string' ? m.date : null,
    auto: m.auto === true,
  };
}

/** Marks the linked «Нестыковки» item as reviewed once its task is done. */
export async function ackDiscrepancyFromTask(
  prisma: PrismaService,
  task: { clubId: string; source?: string | null; meta?: unknown },
  actorId: string,
  comment?: string | null,
) {
  if (task.source !== DISCREPANCY_TASK_SOURCE) return;
  const meta = discrepancyTaskMeta(task.meta);
  if (!meta?.fingerprint) return;
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { firstName: true, lastName: true },
  });
  const who = actor ? `${actor.lastName} ${actor.firstName}`.trim() : '';
  const note = [`Задача выполнена${who ? `: ${who}` : ''}`, comment?.trim()]
    .filter(Boolean)
    .join(' — ');
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + retentionDays());
  await prisma.discrepancyAck.upsert({
    where: {
      clubId_tab_itemKey: {
        clubId: task.clubId,
        tab: meta.tab,
        itemKey: meta.itemKey,
      },
    },
    create: {
      clubId: task.clubId,
      tab: meta.tab,
      itemKey: meta.itemKey,
      fingerprint: meta.fingerprint,
      note,
      userId: actorId,
      expiresAt,
    },
    update: {
      fingerprint: meta.fingerprint,
      note,
      userId: actorId,
      expiresAt,
      createdAt: new Date(),
    },
  });
  invalidateDiscrepancySummary(task.clubId);
}
