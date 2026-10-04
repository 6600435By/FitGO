import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@fitgo/shared-types';
import type { Response } from 'express';
import { readFileSync, unlinkSync } from 'fs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { StaffProfileService } from './staff-profile.service';

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

@Controller()
export class StaffProfileController {
  constructor(private readonly profiles: StaffProfileService) {}

  @Get('me/staff-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.TRAINER,
    UserRole.SPECIALIST,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.SUPER_ADMIN,
  )
  getMine(@CurrentUser() user: JwtPayload) {
    return this.profiles.getMine(user.sub);
  }

  @Patch('me/staff-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRAINER, UserRole.SPECIALIST)
  updateMine(
    @CurrentUser() user: JwtPayload,
    @Body() body: { bio?: string },
  ) {
    return this.profiles.updateBio(user.sub, body.bio ?? '');
  }

  @Post('me/staff-profile/photo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRAINER, UserRole.SPECIALIST)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadPhoto(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: UploadFile | undefined,
  ) {
    const buffer = readUploadBuffer(file);
    if (!buffer?.length) throw new BadRequestException('Файл обязателен');
    return this.profiles.uploadPhoto(user.sub, buffer, file?.mimetype);
  }

  @Delete('me/staff-profile/photo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRAINER, UserRole.SPECIALIST)
  deletePhoto(@CurrentUser() user: JwtPayload) {
    return this.profiles.deletePhoto(user.sub);
  }

  @Patch('admin/staff-profile/:userId/visibility')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  setVisibility(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body() body: { hidden?: boolean },
  ) {
    const isSuper =
      user.roles.includes(UserRole.SUPER_ADMIN) ||
      user.roles.includes(UserRole.MANAGER);
    return this.profiles.setHidden(
      user.clubId,
      userId,
      Boolean(body.hidden),
      isSuper,
    );
  }

  @Get('client/staff/:id')
  @UseGuards(JwtAuthGuard)
  clientCard(@Param('id') id: string) {
    return this.profiles.getPublicCard(id);
  }

  /** Public photo bytes (same-origin /api/media via Next rewrite). */
  @Get('media/staff/:userId/:file')
  media(
    @Param('userId') userId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const kind = file.startsWith('thumb') ? 'thumb' : 'full';
    const buf = this.profiles.readMediaFile(userId, kind);
    if (!buf) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  }
}
