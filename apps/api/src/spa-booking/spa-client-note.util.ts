import { BadRequestException } from '@nestjs/common';
import { normalizePhone } from '../common/phone.util';
import type { PrismaService } from '../prisma/prisma.service';

export const SPA_NOTE_MAX_LEN = 280;

export type SpaNoteIdentity = {
  clientId?: string | null;
  clientExternalId?: string | null;
  phone?: string | null;
};

/** Strongest key first: ext → user → phone. */
export function spaClientIdentityKeys(id: SpaNoteIdentity): string[] {
  const keys: string[] = [];
  const ext = id.clientExternalId?.trim();
  if (ext && !ext.startsWith('guest:')) {
    keys.push(`ext:${ext}`);
  }
  const userId = id.clientId?.trim();
  if (userId) {
    keys.push(`user:${userId}`);
  }
  const phoneRaw = id.phone?.trim();
  if (phoneRaw) {
    const phone = normalizePhone(phoneRaw);
    if (phone.length >= 9) {
      keys.push(`phone:${phone}`);
    }
  }
  return keys;
}

export function primarySpaClientIdentityKey(
  id: SpaNoteIdentity,
): string | null {
  return spaClientIdentityKeys(id)[0] ?? null;
}

export function normalizeSpaNoteText(raw: string | undefined | null): string {
  return (raw ?? '').trim().slice(0, SPA_NOTE_MAX_LEN);
}

export async function findSpaClientNoteText(
  prisma: PrismaService,
  clubId: string,
  id: SpaNoteIdentity,
): Promise<string | undefined> {
  const keys = spaClientIdentityKeys(id);
  if (!keys.length) return undefined;
  const rows = await prisma.spaClientNote.findMany({
    where: { clubId, identityKey: { in: keys } },
    select: { identityKey: true, text: true },
  });
  if (!rows.length) return undefined;
  const byKey = new Map(rows.map((r) => [r.identityKey, r.text]));
  for (const key of keys) {
    const text = byKey.get(key)?.trim();
    if (text) return text;
  }
  return undefined;
}

/** Batch lookup: returns Map from primary key → text (fallback across aliases). */
export async function findSpaClientNotesByIdentities(
  prisma: PrismaService,
  clubId: string,
  identities: SpaNoteIdentity[],
): Promise<Map<string, string>> {
  const allKeys = new Set<string>();
  const identityKeyLists: string[][] = [];
  for (const id of identities) {
    const keys = spaClientIdentityKeys(id);
    identityKeyLists.push(keys);
    for (const k of keys) allKeys.add(k);
  }
  const result = new Map<string, string>();
  if (!allKeys.size) return result;

  const rows = await prisma.spaClientNote.findMany({
    where: { clubId, identityKey: { in: [...allKeys] } },
    select: { identityKey: true, text: true },
  });
  const byKey = new Map(
    rows
      .map((r) => [r.identityKey, r.text.trim()] as const)
      .filter(([, t]) => t.length > 0),
  );

  for (const keys of identityKeyLists) {
    if (!keys.length) continue;
    let text: string | undefined;
    for (const k of keys) {
      text = byKey.get(k);
      if (text) break;
    }
    if (!text) continue;
    for (const k of keys) {
      result.set(k, text);
    }
  }
  return result;
}

export function resolveNoteFromMap(
  map: Map<string, string>,
  id: SpaNoteIdentity,
): string | undefined {
  for (const k of spaClientIdentityKeys(id)) {
    const text = map.get(k);
    if (text) return text;
  }
  return undefined;
}

/**
 * Upsert client note under the strongest key; migrate from weaker aliases.
 * Empty text deletes the note (all matching keys).
 */
export async function upsertSpaClientNote(
  prisma: PrismaService,
  opts: {
    clubId: string;
    actorId: string;
    identity: SpaNoteIdentity;
    text: string;
  },
): Promise<{ text: string; identityKey: string | null }> {
  const keys = spaClientIdentityKeys(opts.identity);
  if (!keys.length) {
    throw new BadRequestException(
      'Комментарий по клиенту нужен клиент из базы, id 1С или телефон',
    );
  }
  const primary = keys[0]!;
  const text = normalizeSpaNoteText(opts.text);

  if (!text) {
    await prisma.spaClientNote.deleteMany({
      where: { clubId: opts.clubId, identityKey: { in: keys } },
    });
    return { text: '', identityKey: primary };
  }

  await prisma.spaClientNote.upsert({
    where: {
      clubId_identityKey: { clubId: opts.clubId, identityKey: primary },
    },
    create: {
      clubId: opts.clubId,
      identityKey: primary,
      text,
      updatedById: opts.actorId,
    },
    update: {
      text,
      updatedById: opts.actorId,
    },
  });

  const weaker = keys.slice(1);
  if (weaker.length) {
    await prisma.spaClientNote.deleteMany({
      where: { clubId: opts.clubId, identityKey: { in: weaker } },
    });
  }

  return { text, identityKey: primary };
}
