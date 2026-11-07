import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  DEFAULT_PRODUCT_MODULES,
  PRODUCT_MODULE_CATALOG,
  type ModulePilotsState,
  type ProductModuleKey,
  type ProductModulesState,
} from '@fitgo/shared-types';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PILOT_USER_LIMIT,
  applyPilotsForUser,
  isPilotableKey,
  parsePilots,
} from './features-pilot.util';

export type ModulePilotMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  private mergeModules(raw: unknown): ProductModulesState {
    const stored =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Partial<Record<ProductModuleKey, boolean>>)
        : {};
    const merged = { ...DEFAULT_PRODUCT_MODULES };
    for (const def of PRODUCT_MODULE_CATALOG) {
      if (typeof stored[def.key] === 'boolean') {
        merged[def.key] = stored[def.key]!;
      }
    }
    return merged;
  }

  private async loadFlagsRow() {
    return this.prisma.appFeatureFlags.findUnique({
      where: { id: 'default' },
    });
  }

  async getModules(): Promise<ProductModulesState> {
    const row = await this.loadFlagsRow();
    return this.mergeModules(row?.modules);
  }

  async getPilots(): Promise<ModulePilotsState> {
    const row = await this.loadFlagsRow();
    return parsePilots(row?.pilots);
  }

  /** Global modules with pilot overlay for this user (nav / UI gates). */
  async getModulesForUser(userId: string): Promise<ProductModulesState> {
    const row = await this.loadFlagsRow();
    const modules = this.mergeModules(row?.modules);
    if (!userId) return modules;
    return applyPilotsForUser(modules, parsePilots(row?.pilots), userId);
  }

  async getCatalog() {
    const row = await this.loadFlagsRow();
    const modules = this.mergeModules(row?.modules);
    const pilots = parsePilots(row?.pilots);
    const pilotIds = [
      ...new Set(Object.values(pilots).flatMap((ids) => ids ?? [])),
    ];
    const users =
      pilotIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: pilotIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          });
    const byId = new Map(users.map((u) => [u.id, u]));
    const pilotsResolved: Partial<
      Record<ProductModuleKey, ModulePilotMember[]>
    > = {};
    for (const [key, ids] of Object.entries(pilots) as [
      ProductModuleKey,
      string[],
    ][]) {
      pilotsResolved[key] = ids
        .map((id) => byId.get(id))
        .filter((u): u is ModulePilotMember => Boolean(u));
    }

    return {
      modules,
      pilots: pilotsResolved,
      catalog: PRODUCT_MODULE_CATALOG.map((item) => ({
        ...item,
        enabled: modules[item.key],
      })),
      updatedAt: row?.updatedAt?.toISOString(),
    };
  }

  async setModules(
    partial: Partial<ProductModulesState>,
    updatedBy?: string,
  ): Promise<ProductModulesState> {
    const current = await this.getModules();
    const next = { ...current };
    for (const def of PRODUCT_MODULE_CATALOG) {
      if (typeof partial[def.key] === 'boolean') {
        next[def.key] = partial[def.key]!;
      }
    }
    const row = await this.loadFlagsRow();
    await this.prisma.appFeatureFlags.upsert({
      where: { id: 'default' },
      update: { modules: next, updatedBy: updatedBy ?? null },
      create: {
        id: 'default',
        modules: next,
        pilots: parsePilots(row?.pilots),
        updatedBy: updatedBy ?? null,
      },
    });
    return next;
  }

  /**
   * Replace pilot user ids for a pilotable module.
   * Only active TRAINER accounts are kept.
   */
  async setPilot(
    key: ProductModuleKey,
    userIds: string[],
    updatedBy?: string,
  ): Promise<ModulePilotsState> {
    if (!isPilotableKey(key)) {
      throw new BadRequestException(
        `Модуль «${key}» не поддерживает пилот по пользователям`,
      );
    }
    const unique = [
      ...new Set(
        (userIds ?? []).filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        ),
      ),
    ];
    if (unique.length > PILOT_USER_LIMIT) {
      throw new BadRequestException(
        `В пилоте не больше ${PILOT_USER_LIMIT} тренеров`,
      );
    }

    if (unique.length) {
      const trainers = await this.prisma.user.findMany({
        where: {
          id: { in: unique },
          isActive: true,
          archivedAt: null,
          roles: { some: { role: Role.TRAINER } },
        },
        select: { id: true },
      });
      const ok = new Set(trainers.map((t) => t.id));
      const bad = unique.filter((id) => !ok.has(id));
      if (bad.length) {
        throw new BadRequestException(
          `В пилот можно добавить только активных тренеров. Не подошли: ${bad.join(', ')}`,
        );
      }
    }

    const current = await this.getPilots();
    const next: ModulePilotsState = { ...current };
    if (unique.length === 0) {
      delete next[key];
    } else {
      next[key] = unique;
    }

    const modules = await this.getModules();
    await this.prisma.appFeatureFlags.upsert({
      where: { id: 'default' },
      update: { pilots: next, updatedBy: updatedBy ?? null },
      create: {
        id: 'default',
        modules,
        pilots: next,
        updatedBy: updatedBy ?? null,
      },
    });
    return next;
  }

  /** Global-only check (payroll, PT control, ModuleGuard). Ignores pilots. */
  async isEnabled(key: ProductModuleKey): Promise<boolean> {
    const modules = await this.getModules();
    return modules[key] !== false;
  }

  /** Per-user check (UI + morning digest). Respects pilots for pilotable keys. */
  async isEnabledForUser(
    key: ProductModuleKey,
    userId: string,
  ): Promise<boolean> {
    const modules = await this.getModulesForUser(userId);
    return modules[key] !== false;
  }
}
