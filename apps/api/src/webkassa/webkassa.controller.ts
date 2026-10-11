import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { readFileSync, unlinkSync } from 'fs';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { WebkassaService } from './webkassa.service';

type UploadFile = {
  buffer?: Buffer;
  path?: string;
  mimetype?: string;
};

function readUploadBuffer(file: UploadFile | undefined): Buffer | null {
  if (file?.buffer?.length) return file.buffer;
  if (file?.path) {
    try {
      const buf = readFileSync(file.path);
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return buf.length ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}

@Controller('super-admin/webkassa')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
export class WebkassaController {
  constructor(private readonly webkassa: WebkassaService) {}

  @Get('status')
  status(@CurrentUser() user: JwtPayload) {
    return this.webkassa.status(user);
  }

  @Post('sync')
  sync(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.webkassa.sync(user, from, to);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: UploadFile | undefined,
  ) {
    const buffer = readUploadBuffer(file);
    if (!buffer?.length) {
      throw new BadRequestException('Файл xlsx не передан (field: file)');
    }
    return this.webkassa.upload(user, buffer);
  }
}
