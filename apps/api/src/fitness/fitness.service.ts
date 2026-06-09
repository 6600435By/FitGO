import { Inject, Injectable } from '@nestjs/common';
import type { IFitnessClubProvider } from '@fitgo/1c-adapter';
import { FITNESS_PROVIDER } from './fitness.constants';

@Injectable()
export class FitnessService {
  constructor(
    @Inject(FITNESS_PROVIDER)
    private readonly provider: IFitnessClubProvider,
  ) {}

  getProvider(): IFitnessClubProvider {
    return this.provider;
  }
}
