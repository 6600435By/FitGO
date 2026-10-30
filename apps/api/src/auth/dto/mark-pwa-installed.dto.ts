import { IsBoolean } from 'class-validator';

export class MarkPwaInstalledDto {
  @IsBoolean()
  installed!: boolean;
}
