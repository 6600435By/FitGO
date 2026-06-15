import type { OsmiApiClient } from './osmi-client';
import { normalizePhone, phonesMatch } from './normalize';
import { registrationNameMatches } from './pick-best-card';

type RegistrationRow = Record<string, string | undefined> & { serialNo?: string };

function rowsFromBody(body: unknown): RegistrationRow[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as { registrations?: RegistrationRow[] };
  return Array.isArray(root.registrations) ? root.registrations : [];
}

async function loadRegistrationRows(
  client: OsmiApiClient,
  regGroup: string,
): Promise<RegistrationRow[]> {
  const rows: RegistrationRow[] = [];
  for (const withDeleted of [false, true]) {
    const body = await client.request(
      `/registration/data/${encodeURIComponent(regGroup)}?array=false&withDeleted=${withDeleted}`,
      { method: 'GET' },
    );
    rows.push(...rowsFromBody(body));
  }
  return rows;
}

export async function findSerialsByPhoneInRegistration(
  client: OsmiApiClient,
  regGroup: string,
  phone: string,
): Promise<string[]> {
  const rows = await loadRegistrationRows(client, regGroup);
  const serials = new Set<string>();

  for (const row of rows) {
    const regPhone = row['Телефон'] ?? row['телефон'] ?? row['Phone'] ?? '';
    if (!phonesMatch(regPhone, phone)) continue;
    const serial = row.serialNo?.trim();
    if (serial) serials.add(serial);
  }

  return [...serials];
}

export async function findSerialByPhoneInRegistration(
  client: OsmiApiClient,
  regGroup: string,
  phone: string,
): Promise<string | null> {
  const serials = await findSerialsByPhoneInRegistration(client, regGroup, phone);
  return serials[0] ?? null;
}

export async function findSerialsByNameInRegistration(
  client: OsmiApiClient,
  regGroup: string,
  firstName: string,
  lastName: string,
): Promise<string[]> {
  const rows = await loadRegistrationRows(client, regGroup);
  const serials = new Set<string>();

  for (const row of rows) {
    if (!registrationNameMatches(row, firstName, lastName)) continue;
    const serial = row.serialNo?.trim();
    if (serial) serials.add(serial);
  }

  return [...serials];
}

export async function findSerialByNameInRegistration(
  client: OsmiApiClient,
  regGroup: string,
  firstName: string,
  lastName: string,
): Promise<string | null> {
  const serials = await findSerialsByNameInRegistration(client, regGroup, firstName, lastName);
  return serials[0] ?? null;
}

export function phoneSearchVariants(phone: string): string[] {
  const digits = normalizePhone(phone);
  const variants = new Set<string>([digits, phone.trim()]);
  if (digits.length === 12 && digits.startsWith('375')) {
    const local = digits.slice(3);
    variants.add(`+375${local}`);
    variants.add(
      `+375 ${local.slice(0, 2)} ${local.slice(2, 5)}-${local.slice(5, 7)}-${local.slice(7)}`,
    );
    variants.add(`+3752 ${local.slice(1, 4)}-${local.slice(4, 6)}-${local.slice(6)}`);
    variants.add(`8${local}`);
    variants.add(`80${local}`);
  }
  return [...variants].filter(Boolean);
}
