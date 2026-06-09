import { Mock1CProvider } from './mock-provider';
import { OneCFitnessProvider } from './onec-provider';
import type { IFitnessClubProvider, OneCConfig } from './types';

export type FitnessProviderType = 'mock' | '1c';

export function createFitnessProvider(
  type: FitnessProviderType,
  oneCConfig?: OneCConfig,
): IFitnessClubProvider {
  if (type === '1c') {
    if (!oneCConfig?.baseUrl || !oneCConfig?.apiKey) {
      throw new Error(
        'ONEC_BASE_URL and ONEC_API_KEY are required when FITNESS_PROVIDER=1c',
      );
    }
    return new OneCFitnessProvider(oneCConfig);
  }

  return new Mock1CProvider();
}
