import { Module } from '@nestjs/common';
import { PersonalTrainingModule } from '../personal-training/personal-training.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';

@Module({
  imports: [PersonalTrainingModule],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
