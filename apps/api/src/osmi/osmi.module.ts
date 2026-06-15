import { Global, Module } from '@nestjs/common';
import { OsmiCardService } from './osmi-card.service';

@Global()
@Module({
  providers: [OsmiCardService],
  exports: [OsmiCardService],
})
export class OsmiModule {}
