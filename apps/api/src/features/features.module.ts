import { Global, Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { ModuleGuard } from './module.guard';

@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, ModuleGuard],
  exports: [FeaturesService, ModuleGuard],
})
export class FeaturesModule {}
