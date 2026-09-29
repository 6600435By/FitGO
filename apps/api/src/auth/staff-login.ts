import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/** Code-based logins created from 1C sync or seed. Real emails and tech placeholders stay. */
export function isCodeStubEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (e.startsWith('tech.') && e.endsWith('@staff.fitgo.local')) return false;
  if (/^\d+@staff\.fitgo\.local$/.test(e)) return true;
  if (e.startsWith('1c-') && e.endsWith('@fitgo.local')) return true;
  return false;
}

/** Synced identity that can be removed when the person leaves every staff segment. */
export function isDisposableStaffLogin(email: string): boolean {
  if (isCodeStubEmail(email)) return true;
  return !email.includes('@');
}

export function surnameLoginBase(lastName: string): string {
  const compact = lastName.trim().replace(/\s+/g, '');
  const base = compact.replace(/[^\p{L}\p{N}-]/gu, '');
  return base.slice(0, 48) || 'staff';
}

export async function allocateStaffLogin(
  prisma: PrismaService,
  lastName: string,
  exceptUserId?: string,
): Promise<string> {
  const base = surnameLoginBase(lastName);
  for (let i = 0; i < 40; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    const taken = await prisma.user.findFirst({
      where: {
        email: { equals: candidate, mode: 'insensitive' },
        ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
      },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new ConflictException(
    'Не удалось подобрать уникальный логин по фамилии',
  );
}
