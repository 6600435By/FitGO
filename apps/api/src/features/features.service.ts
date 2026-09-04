import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PRODUCT_MODULES,
  PRODUCT_MODULE_CATALOG,
  type ProductModuleKey,
  type ProductModulesState,
} from '@fitgo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

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

  async getModules(): Promise<ProductModulesState> {
    const row = await this.prisma.appFeatureFlags.findUnique({
      where: { id: 'default' },
    });
    return this.mergeModules(row?.modules);
  }

  async getCatalog() {
    const modules = await this.getModules();
    return {
      modules,
      catalog: PRODUCT_MODULE_CATALOG.map((item) => ({
        ...item,
        enabled: modules[item.key],
      })),
      updatedAt: (
        await this.prisma.appFeatureFlags.findUnique({
          where: { id: 'default' },
        })
      )?.updatedAt?.toISOString(),
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
    await this.prisma.appFeatureFlags.upsert({
      where: { id: 'default' },
      update: { modules: next, updatedBy: updatedBy ?? null },
      create: { id: 'default', modules: next, updatedBy: updatedBy ?? null },
    });
    return next;
  }

  async isEnabled(key: ProductModuleKey): Promise<boolean> {
    const modules = await this.getModules();
    return modules[key] !== false;
  }
}
