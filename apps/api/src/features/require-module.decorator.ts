import { SetMetadata } from '@nestjs/common';
import type { ProductModuleKey } from '@fitgo/shared-types';

export const REQUIRE_MODULE_KEY = 'requireModule';

export const RequireModule = (module: ProductModuleKey) =>
  SetMetadata(REQUIRE_MODULE_KEY, module);
