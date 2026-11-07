import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { TRAINER_GOAL_METRICS } from '@fitgo/shared-types';

class PersonalGoalItemDto {
  @IsIn(TRAINER_GOAL_METRICS)
  metric!: (typeof TRAINER_GOAL_METRICS)[number];

  @IsInt()
  @Min(1)
  target!: number;
}

export class PutPersonalGoalsDto {
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PersonalGoalItemDto)
  goals!: PersonalGoalItemDto[];
}
