import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@fitgo/shared-types';
import { readFileSync, unlinkSync } from 'fs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { BookingControlService } from '../booking-control/booking-control.service';
import { HallSnapshotAgentGuard } from './hall-snapshot-agent.guard';
import { HallSnapshotService } from './hall-snapshot.service';

type UploadFile = {
  buffer?: Buffer;
  path?: string;
  mimetype?: string;
  originalname?: string;
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
export class HallSnapshotController {
  constructor(
    private readonly hallSnapshots: HallSnapshotService,
    private readonly bookingControl: BookingControlService,
  ) {}

  @Get('agent/hall-snapshots/due')
  @UseGuards(HallSnapshotAgentGuard)
  listDue(@Query('clubId') clubId: string) {
    if (!clubId?.trim()) {
      return [];
    }
    return this.hallSnapshots.listDue(clubId.trim());
  }

  @Post('agent/hall-snapshots/:id/upload')
  @UseGuards(HallSnapshotAgentGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  upload(
    @Param('id') id: string,
    @Query('clubId') clubId: string,
    @UploadedFile() file: UploadFile | undefined,
    @Body() body: { cameraLabel?: string; cameraKey?: string },
  ) {
    const cid = clubId?.trim() || '';
    if (!cid) {
      throw new BadRequestException('clubId required');
    }
    const buffer = readUploadBuffer(file);
    if (!buffer?.length) {
      return this.hallSnapshots.markFailed(cid, id, 'Пустой файл снимка');
    }
    return this.hallSnapshots.uploadJpeg(cid, id, buffer, {
      cameraLabel: body.cameraLabel,
      cameraKey: body.cameraKey,
    });
  }

  /** Preferred by LAN agent — avoids multer on Windows. */
  @Post('agent/hall-snapshots/:id/upload-json')
  @UseGuards(HallSnapshotAgentGuard)
  uploadJson(
    @Param('id') id: string,
    @Query('clubId') clubId: string,
    @Body()
    body: {
      jpegBase64?: string;
      cameraLabel?: string;
      cameraKey?: string;
    },
  ) {
    const cid = clubId?.trim() || '';
    if (!cid) {
      throw new BadRequestException('clubId required');
    }
    const b64 = (body.jpegBase64 || '').replace(/^data:image\/jpeg;base64,/, '');
    if (!b64) {
      return this.hallSnapshots.markFailed(cid, id, 'Пустой jpegBase64');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw new BadRequestException('Invalid base64');
    }
    if (buffer.length < 100) {
      return this.hallSnapshots.markFailed(cid, id, 'Слишком короткий JPEG');
    }
    return this.hallSnapshots.uploadJpeg(cid, id, buffer, {
      cameraLabel: body.cameraLabel,
      cameraKey: body.cameraKey,
    });
  }

  @Post('agent/hall-snapshots/:id/fail')
  @UseGuards(HallSnapshotAgentGuard)
  fail(
    @Param('id') id: string,
    @Query('clubId') clubId: string,
    @Body() body: { errorMessage?: string },
  ) {
    return this.hallSnapshots.markFailed(
      clubId?.trim() || '',
      id,
      body.errorMessage || 'capture failed',
    );
  }

  @Get('admin/booking-control/hall-snapshots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  listAdmin(
    @CurrentUser() user: JwtPayload,
    @Query('sessionKey') sessionKey: string,
  ) {
    return this.hallSnapshots.listForSession(
      requireClubId(user),
      sessionKey ?? '',
    );
  }

  @Get('admin/booking-control/hall-snapshots/:id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  imageAdmin(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.hallSnapshots.openImage(requireClubId(user), id);
  }

  @Get('super-admin/booking-control/hall-snapshots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  listSuperAdmin(
    @CurrentUser() user: JwtPayload,
    @Query('sessionKey') sessionKey: string,
  ) {
    return this.hallSnapshots.listForSession(
      requireClubId(user),
      sessionKey ?? '',
    );
  }

  @Get('super-admin/booking-control/hall-snapshots/:id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  imageSuperAdmin(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.hallSnapshots.openImage(requireClubId(user), id);
  }

  @Get('trainer/booking-control/hall-snapshots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRAINER)
  async listTrainer(
    @CurrentUser() user: JwtPayload,
    @Query('sessionKey') sessionKey: string,
  ) {
    await this.bookingControl.detail(requireClubId(user), sessionKey ?? '', {
      userId: user.sub,
      ownOnly: true,
    });
    return this.hallSnapshots.listForSession(
      requireClubId(user),
      sessionKey ?? '',
    );
  }

  @Get('trainer/booking-control/hall-snapshots/:id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRAINER)
  async imageTrainer(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clubId = requireClubId(user);
    const snap = await this.hallSnapshots.listForSessionById(clubId, id);
    await this.bookingControl.detail(clubId, snap.sessionKey, {
      userId: user.sub,
      ownOnly: true,
    });
    return this.hallSnapshots.openImage(clubId, id);
  }
}
