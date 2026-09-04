import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ProductModuleKey } from '@fitgo/shared-types';
import { FeaturesService } from './features.service';
import { REQUIRE_MODULE_KEY } from './require-module.decorator';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.getAllAndOverride<ProductModuleKey | undefined>(
      REQUIRE_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!moduleKey) return true;

    const enabled = await this.features.isEnabled(moduleKey);
    if (!enabled) {
      throw new ForbiddenException(`Модуль «${moduleKey}» отключён`);
    }
    return true;
  }
}
