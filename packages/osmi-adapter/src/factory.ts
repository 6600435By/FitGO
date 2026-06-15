import { HttpOsmiCardsProvider } from './http-provider';
import { MockOsmiCardsProvider } from './mock-provider';
import type { IOsmiCardsProvider, OsmiHttpConfig } from './types';

export type OsmiProviderType = 'mock' | 'http';

export function createOsmiProvider(
  type: OsmiProviderType,
  httpConfig?: OsmiHttpConfig,
): IOsmiCardsProvider {
  if (type === 'http') {
    if (!httpConfig?.baseUrl || !httpConfig.apiId) {
      throw new Error(
        'OSMI_API_BASE_URL and OSMI_API_ID are required when OSMI_PROVIDER=http',
      );
    }
    if (!httpConfig.apiKey) {
      console.warn(
        '[osmi-adapter] OSMI_API_KEY is empty — OSMI API calls will fail until configured',
      );
    }
    return new HttpOsmiCardsProvider(httpConfig);
  }
  return new MockOsmiCardsProvider();
}
