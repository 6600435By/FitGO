import { FormaFitnessProvider } from './forma-provider';
import { FormaWordPressProxyProvider } from './forma-wordpress-provider';
import { FitgoHttpProvider } from './fitgo-http-provider';
import { FormaFitgoCompositeProvider } from './forma-fitgo-composite-provider';
import { Mock1CProvider } from './mock-provider';
import { OneCFitnessProvider } from './onec-provider';
import type {
  FormaConfig,
  FormaWordPressConfig,
  IFitnessClubProvider,
  OneCConfig,
} from './types';

export type FitnessProviderType = 'mock' | '1c' | 'forma' | 'forma-wp';

export interface FitnessProviderOptions {
  oneC?: OneCConfig;
  forma?: FormaConfig;
  formaWordPress?: FormaWordPressConfig;
}

export function createFitnessProvider(
  type: FitnessProviderType,
  options: FitnessProviderOptions = {},
): IFitnessClubProvider {
  if (type === '1c') {
    if (!options.oneC?.baseUrl || !options.oneC?.apiKey) {
      throw new Error(
        'ONEC_BASE_URL and ONEC_API_KEY are required when FITNESS_PROVIDER=1c',
      );
    }
    return new OneCFitnessProvider(options.oneC);
  }

  if (type === 'forma') {
    if (!options.forma?.baseUrl || !options.forma?.apiKey || !options.forma?.basicAuth) {
      throw new Error(
        'FORMA_BASE_URL, FORMA_API_KEY and FORMA_BASIC_AUTH are required when FITNESS_PROVIDER=forma',
      );
    }
    const forma = new FormaFitnessProvider(options.forma);
    if (options.forma.fitgoUrl) {
      const fitgo = new FitgoHttpProvider({
        baseUrl: options.forma.fitgoUrl,
        apiKey: options.forma.apiKey,
        basicAuth: options.forma.basicAuth,
      });
      return new FormaFitgoCompositeProvider(forma, fitgo);
    }
    return forma;
  }

  if (type === 'forma-wp') {
    if (!options.formaWordPress?.ajaxUrl) {
      throw new Error(
        'FORMA_WP_AJAX_URL is required when FITNESS_PROVIDER=forma-wp',
      );
    }
    return new FormaWordPressProxyProvider(options.formaWordPress);
  }

  return new Mock1CProvider();
}
