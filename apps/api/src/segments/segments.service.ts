import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, SpaServiceKind } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { allocateStaffLogin } from '../auth/staff-login';
import { FitnessService } from '../fitness/fitness.service';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';

const STAFF_KEYS = [
  'staff.admins',
  'staff.managers',
  'staff.spa',
  'staff.trainers',
  'staff.groupTrainers',
] as const;

const ROLE_BY_KEY: Record<string, Role> = {
  'staff.admins': Role.ADMIN,
  'staff.managers': Role.MANAGER,
  'staff.spa': Role.SPECIALIST,
  'staff.trainers': Role.TRAINER,
  'staff.groupTrainers': Role.TRAINER,
};

export type SegmentSyncResult = {
  key: string;
  added: number;
  updated: number;
  unchanged: number;
  /** Existing (or archived) — left untouched; sync only adds new. */
  skipped: number;
  deactivated: number;
  pruned: number;
  /** Сколько членов вернула 1С */
  fetched: number;
  credentials: Array<{ email: string; password: string; name: string }>;
  lastSyncedAt: string | null;
  error?: string;
  /** Info (e.g. reclaimed wrong name on employeeCode). */
  notes?: string;
};

@Injectable()
export class SegmentsService {
  private readonly logger = new Logger(SegmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly config: ConfigService,
    private readonly payroll: PayrollService,
  ) {}

  private assertLiveFitgo() {
    const provider = this.config.get<string>('FITNESS_PROVIDER', 'mock');
    const fitgoUrl = (this.config.get<string>('FORMA_FITGO_URL') ?? '').trim();
    if (provider === 'mock') {
      throw new ServiceUnavailableException(
        'FITNESS_PROVIDER=mock — синхрон сегментов из 1С отключён. В apps/api/.env задайте FITNESS_PROVIDER=forma и FORMA_FITGO_URL=https://127.0.0.1:8445/fitgo/hs/fitgo/v1, затем Restart-Service FitGO-API.',
      );
    }
    if (provider === 'forma' && !fitgoUrl) {
      throw new ServiceUnavailableException(
        'FORMA_FITGO_URL пуст — Nest не видит FitGOIntegration. Укажите URL вида https://127.0.0.1:8445/fitgo/hs/fitgo/v1 и перезапустите FitGO-API.',
      );
    }
  }

  async getConfig(user: JwtPayload) {
    requireClubId(user);
    this.assertLiveFitgo();
    const provider = this.fitness.getProvider();
    if (!provider.getSegmentsConfig) {
      throw new ServiceUnavailableException('Сегменты 1С не подключены');
    }
    const cfg = await provider.getSegmentsConfig();
    if (!cfg) {
      throw new ServiceUnavailableException(
        'Endpoint /segments/config недоступен — опубликуйте FitGOIntegration',
      );
    }
    const states = await this.prisma.segmentSyncState.findMany({
      where: { clubId: requireClubId(user) },
    });
    const byKey = new Map(states.map((s) => [s.segmentKey, s]));
    return {
      segments: cfg.segments.map((s) => ({
        ...s,
        lastSyncedAt: byKey.get(s.key)?.lastSyncedAt?.toISOString() ?? null,
        lastStatus: byKey.get(s.key)?.lastStatus ?? null,
        lastAdded: byKey.get(s.key)?.lastAdded ?? 0,
        lastUnchanged: byKey.get(s.key)?.lastUnchanged ?? 0,
      })),
    };
  }

  async syncStaffFrom1C(
    user: JwtPayload,
    _opts: { replace?: boolean } = {},
  ): Promise<{
    results: SegmentSyncResult[];
    credentials: Array<{ email: string; password: string; name: string }>;
    removed: number;
  }> {
    this.assertLiveFitgo();
    const clubId = requireClubId(user);
    const provider = this.fitness.getProvider();
    if (!provider.getSegmentMembers) {
      throw new ServiceUnavailableException(
        'getSegmentMembers недоступен — нужен FORMA_FITGO_URL',
      );
    }

    const prefetched = new Map<
      string,
      {
        found: boolean;
        name?: string;
        data: Array<{
          externalId: string;
          name: string;
          code?: string;
          phone?: string;
        }>;
      } | null
    >();
    let totalFetched = 0;
    for (const key of STAFF_KEYS) {
      const members = await provider.getSegmentMembers({ key });
      prefetched.set(key, members);
      if (members?.found && Array.isArray(members.data)) {
        const bad =
          typeof members.name === 'string' && /не найден/i.test(members.name);
        if (!bad) totalFetched += members.data.length;
      }
    }
    if (totalFetched === 0) {
      throw new ServiceUnavailableException(
        '1С вернула 0 сотрудников по всем staff-сегментам. Проверьте: 1) в конфигураторе обновлён FitGOIntegration_Клиенты.bsl и переопубликован fitgo; 2) в сегментах нажато «Сформировать сегмент»; 3) имена сегментов: «Администраторы приложение», «Управляющий», «Спа специалисты», «Тренера все», «Тренера ГП приложение».',
      );
    }

    // Add-only for accounts: never prune or recreate. Same externalId may
    // refresh firstName/lastName/phone from 1C; login stays unchanged.
    const results: SegmentSyncResult[] = [];
    const credentials: Array<{ email: string; password: string; name: string }> =
      [];
    for (const key of STAFF_KEYS) {
      const r = await this.syncStaffSegment(clubId, key, prefetched.get(key));
      results.push(r);
      credentials.push(...r.credentials);
    }
    return { results, credentials, removed: 0 };
  }

  async syncNomenclature(
    user: JwtPayload,
    kind: 'spa' | 'membership' | 'shop' | 'all' = 'all',
  ): Promise<{ results: SegmentSyncResult[] }> {
    this.assertLiveFitgo();
    const clubId = requireClubId(user);
    const keys: string[] = [];
    if (kind === 'all' || kind === 'spa') keys.push('nom.spaCabinet');
    if (kind === 'all' || kind === 'membership') keys.push('nom.membershipApp');
    if (kind === 'all' || kind === 'shop') keys.push('nom.shop');
    const results: SegmentSyncResult[] = [];
    for (const key of keys) {
      results.push(await this.syncNomSegment(clubId, key));
    }
    return { results };
  }

  private async syncStaffSegment(
    clubId: string,
    key: string,
    prefetched?: {
      found: boolean;
      name?: string;
      data: Array<{
        externalId: string;
        name: string;
        code?: string;
        phone?: string;
      }>;
    } | null,
  ): Promise<SegmentSyncResult> {
    const role = ROLE_BY_KEY[key];
    if (!role) {
      throw new BadRequestException(`Unknown staff key ${key}`);
    }
    const provider = this.fitness.getProvider();
    if (!provider.getSegmentMembers) {
      return this.failResult(
        clubId,
        key,
        'getSegmentMembers недоступен — нужен FORMA_FITGO_URL (FitGOIntegration)',
      );
    }
    const members =
      prefetched !== undefined
        ? prefetched
        : await provider.getSegmentMembers({ key });
    if (!members) {
      return this.failResult(
        clubId,
        key,
        'segments/members недоступен (404/ошибка) — опубликуйте шаблоны в FitGOIntegration',
      );
    }
    // Битая ссылка UUID («Объект не найден») с пустым data — как not found
    const badName =
      typeof members.name === 'string' &&
      /не найден/i.test(members.name);
    if (members.found && badName && members.data.length === 0) {
      return this.failResult(
        clubId,
        key,
        `Сегмент ${key}: UUID не резолвится в 1С (Объект не найден). Обновите FitGOIntegration_Клиенты.bsl (поиск по имени) и переопубликуйте.`,
      );
    }
    if (!members.found && key === 'staff.groupTrainers') {
      await this.saveState(clubId, key, {
        lastStatus: 'skipped',
        lastError: 'Сегмент Тренера ГП приложение не найден в 1С',
        lastAdded: 0,
        lastUnchanged: 0,
      });
      return {
        key,
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        deactivated: 0,
        fetched: 0,
        pruned: 0,
        credentials: [],
        lastSyncedAt: new Date().toISOString(),
        error: 'Сегмент «Тренера ГП приложение» не найден в 1С',
      };
    }
    if (!members.found) {
      return this.failResult(
        clubId,
        key,
        `Сегмент ${key} не найден в 1С (uuid/имя). Проверьте СегментыСотрудников.`,
      );
    }

    // Mock fingerprint — защита от «тишины» на mock-данных
    if (
      members.data.some(
        (m) =>
          m.externalId === 'staff-1' ||
          m.externalId === 'staff-2' ||
          m.name === 'Админ Тест',
      )
    ) {
      return this.failResult(
        clubId,
        key,
        'Получены mock-данные, не 1С. Задайте FITNESS_PROVIDER=forma и FORMA_FITGO_URL, перезапустите API.',
      );
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;
    const failNotes: string[] = [];
    const reclaimNotes: string[] = [];
    const credentials: SegmentSyncResult['credentials'] = [];
    const groupPrograms = key === 'staff.groupTrainers';
    const fetched = members.data.length;

    for (const m of members.data) {
      const externalId = m.externalId?.trim();
      if (!externalId) {
        failed += 1;
        continue;
      }
      const code = m.code?.trim() || null;
      const nameParts = (m.name || '').trim().split(/\s+/);
      const lastName = nameParts[0] || 'Сотрудник';
      const firstName = nameParts.slice(1).join(' ') || '1С';
      const oneCName = `${lastName} ${firstName}`.trim();

      const byExternal =
        (await this.prisma.user.findFirst({
          where: { clubId, externalId },
          select: {
            id: true,
            archivedAt: true,
            externalId: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        })) ?? null;
      const byCode =
        !byExternal && code
          ? ((await this.prisma.user.findFirst({
              where: { clubId, employeeCode: code },
              select: {
                id: true,
                archivedAt: true,
                externalId: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
              },
            })) ?? null)
          : null;
      const existing = byExternal ?? byCode;

      if (existing) {
        // Same 1C person (externalId) — refresh name/phone; never touch login.
        if (existing.externalId === externalId) {
          const staleName = `${existing.lastName} ${existing.firstName}`.trim();
          const namesDiffer = !staffNamesMatch(staleName, oneCName);
          const phone = m.phone?.trim() || null;
          if (!namesDiffer && !phone) {
            skipped += 1;
            unchanged += 1;
            continue;
          }
          try {
            await this.prisma.user.update({
              where: { id: existing.id },
              data: {
                ...(namesDiffer ? { firstName, lastName } : {}),
                ...(phone ? { phone } : {}),
              },
            });
            if (namesDiffer) {
              updated += 1;
              if (reclaimNotes.length < 5) {
                reclaimNotes.push(`${staleName} → ${oneCName}`);
              }
              this.logger.log(
                `Staff sync renamed ${externalId}: "${staleName}" → "${oneCName}"`,
              );
            } else {
              unchanged += 1;
            }
          } catch (err) {
            failed += 1;
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Staff rename failed for ${externalId}: ${msg}`);
            if (failNotes.length < 5) failNotes.push(`${m.name}: ${msg}`);
          }
          continue;
        }
        // Code reused / stale card: FitGO has another name on this employeeCode
        // (e.g. Аниковец on 000000163 while 1C has Алешкович). Reclaim for 1C.
        const staleName = `${existing.lastName} ${existing.firstName}`.trim();
        const namesDiffer = !staffNamesMatch(staleName, oneCName);
        const canReclaim =
          !existing.archivedAt &&
          namesDiffer &&
          (!existing.externalId || existing.externalId !== externalId);
        if (canReclaim) {
          try {
            await this.prisma.user.update({
              where: { id: existing.id },
              data: {
                firstName,
                lastName,
                phone: m.phone?.trim() || null,
                externalId,
                employeeCode: code,
                ...(role === Role.TRAINER
                  ? {
                      groupPrograms,
                      trainerStaff: !groupPrograms,
                      trainerClub: false,
                      trainerGroupsSet: true,
                    }
                  : {}),
              },
            });
            const hasRole = await this.prisma.userRole.findFirst({
              where: { userId: existing.id, role },
            });
            if (!hasRole) {
              await this.prisma.userRole.create({
                data: { userId: existing.id, role },
              });
            }
            updated += 1;
            if (reclaimNotes.length < 5) {
              reclaimNotes.push(`${staleName} → ${oneCName} (код ${code})`);
            }
            this.logger.warn(
              `Staff sync reclaimed code ${code}: "${staleName}" → "${oneCName}" (${externalId})`,
            );
          } catch (err) {
            failed += 1;
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Staff reclaim failed for ${externalId}: ${msg}`);
            if (failNotes.length < 5) failNotes.push(`${m.name}: ${msg}`);
          }
          continue;
        }
        // Already in FitGO (including archived) — never overwrite; never re-create.
        skipped += 1;
        unchanged += 1;
        continue;
      }

      const plainPassword = randomBytes(9).toString('base64url').slice(0, 12);
      const email = await allocateStaffLogin(this.prisma, lastName);
      const passwordHash = await bcrypt.hash(plainPassword, 10);
      try {
        const created = await this.prisma.user.create({
          data: {
            clubId,
            email,
            password: passwordHash,
            firstName,
            lastName,
            phone: m.phone?.trim() || null,
            externalId,
            employeeCode: code,
            loginEnabled: false,
            groupPrograms,
            trainerStaff: role === Role.TRAINER && !groupPrograms,
            trainerClub: false,
            trainerGroupsSet: role === Role.TRAINER,
            roles: { create: [{ role }] },
          },
        });
        added += 1;
        credentials.push({
          email,
          password: plainPassword,
          name: `${lastName} ${firstName}`.trim(),
        });
        try {
          await this.payroll.applyPayTemplatesForNewUser(clubId, created.id);
        } catch (err) {
          this.logger.warn(
            `Pay template for ${created.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Staff upsert failed for ${externalId}: ${msg}`);
        if (failNotes.length < 5) failNotes.push(`${m.name}: ${msg}`);
      }
    }

    const error =
      failed > 0
        ? `Не удалось записать ${failed} из ${fetched}. ${failNotes.join('; ')}`
        : undefined;
    const notes = reclaimNotes.length
      ? `Обновлены карточки: ${reclaimNotes.join('; ')}`
      : undefined;

    await this.saveState(clubId, key, {
      lastStatus: failed > 0 && added === 0 && updated === 0 ? 'error' : 'ok',
      lastError: error ?? null,
      lastAdded: added,
      lastUnchanged: unchanged + updated,
    });

    return {
      key,
      added,
      updated,
      unchanged,
      skipped,
      deactivated: 0,
      pruned: 0,
      fetched,
      credentials,
      lastSyncedAt: new Date().toISOString(),
      error,
      notes,
    };
  }

  private async syncNomSegment(
    clubId: string,
    key: string,
  ): Promise<SegmentSyncResult> {
    const provider = this.fitness.getProvider();
    if (!provider.getSegmentMembers) {
      return this.failResult(clubId, key, 'getSegmentMembers unsupported');
    }
    const members = await provider.getSegmentMembers({ key });
    if (!members) {
      return this.failResult(
        clubId,
        key,
        'segments/members недоступен — проверьте FORMA_FITGO_URL и публикацию FitGOIntegration',
      );
    }
    if (!members.found) {
      if (key === 'nom.spaCabinet') {
        const detail =
          members.error === 'unknown key'
            ? 'Ключ nom.spaCabinet нет в опубликованном FitGOIntegration — обновите BSL (КартаСегментовПриложения) и F7.'
            : 'В 1С нет сегмента номенклатуры «Спа кабинет приложение» (uuid 8deca45d-36c3-2cf1-11f1-b9bd204f566c). Обновите FitGOIntegration_Клиенты.bsl (КартаСегментовПриложения) и переопубликуйте HTTP (F7). Если сегмент «по правилам» — нажмите в 1С «Сформировать».';
        return this.failResult(clubId, key, detail);
      }
      return this.failResult(
        clubId,
        key,
        members.error ? `segment not found (${members.error})` : 'segment not found',
      );
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let deactivated = 0;
    const seen = new Set<string>();
    const fetched = members.data.length;

    if (key === 'nom.spaCabinet') {
      for (const m of members.data) {
        const externalId = m.externalId?.trim();
        if (!externalId) continue;
        seen.add(externalId);
        const rawPriceMinor = Math.round(Number(m.price ?? 0) * 100);
        const existing = await this.prisma.spaService.findFirst({
          where: { clubId, externalId },
        });
        if (existing) {
          // 1C `Объект.Цена` often returns 0 on missing attr — keep last known price.
          const priceFromOneCMinor =
            rawPriceMinor > 0
              ? rawPriceMinor
              : (existing.priceFromOneCMinor ?? 0);
          const effectivePrice =
            existing.priceOverrideMinor ?? priceFromOneCMinor;
          if (
            existing.name === m.name &&
            existing.priceFromOneCMinor === priceFromOneCMinor &&
            existing.priceMinor === effectivePrice
          ) {
            unchanged += 1;
            continue;
          }
          await this.prisma.spaService.update({
            where: { id: existing.id },
            data: {
              name: m.name,
              priceFromOneCMinor,
              // Keep duration/buffer/bookable/active/override; only name + 1C price.
              priceMinor: effectivePrice,
            },
          });
          updated += 1;
        } else {
          await this.prisma.spaService.create({
            data: {
              clubId,
              name: m.name,
              kind: inferSpaKind(m.name),
              durationMin: 60,
              priceFromOneCMinor: rawPriceMinor,
              priceMinor: rawPriceMinor,
              externalId,
              active: true,
              bookable: false,
            },
          });
          added += 1;
        }
      }
      const stale = await this.prisma.spaService.findMany({
        where: {
          clubId,
          externalId: { not: null },
          active: true,
        },
      });
      for (const s of stale) {
        if (s.externalId && !seen.has(s.externalId)) {
          await this.prisma.spaService.update({
            where: { id: s.id },
            data: { active: false },
          });
          deactivated += 1;
        }
      }
    } else {
      const kind = key === 'nom.shop' ? 'shop' : 'membership';
      for (const m of members.data) {
        const externalId = m.externalId?.trim();
        if (!externalId) continue;
        seen.add(externalId);
        const priceMinor = Math.round(Number(m.price ?? 0) * 100);
        const existing = await this.prisma.catalogProduct.findUnique({
          where: {
            clubId_kind_externalId: { clubId, kind, externalId },
          },
        });
        if (existing) {
          if (
            existing.name === m.name &&
            existing.priceMinor === priceMinor &&
            existing.active
          ) {
            unchanged += 1;
            continue;
          }
          await this.prisma.catalogProduct.update({
            where: { id: existing.id },
            data: {
              name: m.name,
              code: m.code ?? null,
              priceMinor,
              unit: m.unit ?? null,
              active: true,
            },
          });
          updated += 1;
        } else {
          await this.prisma.catalogProduct.create({
            data: {
              clubId,
              kind,
              externalId,
              name: m.name,
              code: m.code ?? null,
              priceMinor,
              unit: m.unit ?? null,
              active: true,
            },
          });
          added += 1;
        }
      }
      const stale = await this.prisma.catalogProduct.findMany({
        where: { clubId, kind, active: true },
      });
      for (const p of stale) {
        if (!seen.has(p.externalId)) {
          await this.prisma.catalogProduct.update({
            where: { id: p.id },
            data: { active: false },
          });
          deactivated += 1;
        }
      }
    }

    await this.saveState(clubId, key, {
      lastStatus: 'ok',
      lastError: null,
      lastAdded: added,
      lastUnchanged: unchanged + updated,
    });

    return {
      key,
      added,
      updated,
      unchanged,
      skipped: 0,
      deactivated,
      pruned: 0,
      fetched,
      credentials: [],
      lastSyncedAt: new Date().toISOString(),
    };
  }

  private async failResult(
    clubId: string,
    key: string,
    error: string,
  ): Promise<SegmentSyncResult> {
    await this.saveState(clubId, key, {
      lastStatus: 'error',
      lastError: error,
      lastAdded: 0,
      lastUnchanged: 0,
    });
    return {
      key,
      added: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      deactivated: 0,
      pruned: 0,
      fetched: 0,
      credentials: [],
      lastSyncedAt: null,
      error,
    };
  }

  private async saveState(
    clubId: string,
    segmentKey: string,
    data: {
      lastStatus: string;
      lastError: string | null;
      lastAdded: number;
      lastUnchanged: number;
    },
  ) {
    await this.prisma.segmentSyncState.upsert({
      where: { clubId_segmentKey: { clubId, segmentKey } },
      create: {
        clubId,
        segmentKey,
        lastSyncedAt: new Date(),
        ...data,
      },
      update: {
        lastSyncedAt: new Date(),
        ...data,
      },
    });
  }
}

function inferSpaKind(name: string): SpaServiceKind {
  const n = name.toLowerCase();
  if (n.includes('состав') || n.includes('body') || n.includes('анализ')) {
    return SpaServiceKind.BODY_COMPOSITION;
  }
  if (n.includes('обёрт') || n.includes('оберт') || n.includes('wrap')) {
    return SpaServiceKind.WRAP;
  }
  return SpaServiceKind.MASSAGE;
}

/** Normalized full-name compare for staff sync reclaim. */
function staffNamesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  return norm(a) === norm(b);
}
