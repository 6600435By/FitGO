import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

const STAFF_ROLE = ['ADMIN', 'TRAINER', 'SPECIALIST', 'TECH'] as const;
export type StaffRoleId = (typeof STAFF_ROLE)[number];

const APP_ROLES: StaffRoleId[] = ['ADMIN', 'TRAINER', 'SPECIALIST'];

function dtoNeedsAppLogin(dto: {
  roles?: StaffRoleId[];
  role?: StaffRoleId;
}): boolean {
  const list = dto.roles?.length
    ? dto.roles
    : dto.role
      ? [dto.role]
      : [];
  return list.some((r) => APP_ROLES.includes(r));
}

export class CreateStaffDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** Required when staff needs app access (not TECH-only). */
  @ValidateIf((o: CreateStaffDto) => dtoNeedsAppLogin(o))
  @IsEmail()
  email?: string;

  @ValidateIf((o: CreateStaffDto) => dtoNeedsAppLogin(o))
  @IsString()
  @MinLength(6)
  password?: string;

  /** Preferred: one or more departments. */
  @IsOptional()
  @IsArray()
  @IsIn(STAFF_ROLE, { each: true })
  roles?: StaffRoleId[];

  /** Legacy single role (used when roles omitted). */
  @IsOptional()
  @IsIn(STAFF_ROLE)
  role?: StaffRoleId;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsArray()
  @IsIn(STAFF_ROLE, { each: true })
  roles?: StaffRoleId[];
}
