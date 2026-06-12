import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createFitnessProvider,
  type IFitnessClubProvider,
} from '@fitgo/1c-adapter';
import { FITNESS_PROVIDER } from './fitness.constants';
import { FitnessService } from './fitness.service';

@Global()
@Module({
  providers: [
    {
      provide: FITNESS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IFitnessClubProvider => {
        const type = config.get<'mock' | '1c' | 'forma' | 'forma-wp'>(
          'FITNESS_PROVIDER',
          'mock',
        );
        return createFitnessProvider(type, {
          oneC: {
            baseUrl: config.get('ONEC_BASE_URL', ''),
            apiKey: config.get('ONEC_API_KEY', ''),
          },
          forma: {
            baseUrl: config.get('FORMA_BASE_URL', ''),
            apiKey: config.get('FORMA_API_KEY', ''),
            basicAuth: config.get('FORMA_BASIC_AUTH', ''),
            defaultPassword: config.get('FORMA_DEFAULT_PASSWORD', ''),
          },
          formaWordPress: {
            ajaxUrl: config.get('FORMA_WP_AJAX_URL', ''),
          },
        });
      },
    },
    FitnessService,
  ],
  exports: [FITNESS_PROVIDER, FitnessService],
})
export class FitnessModule {}
