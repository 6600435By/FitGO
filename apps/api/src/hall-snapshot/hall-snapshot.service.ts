import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HallClassSnapshotStatus,
  OnexClassKind,
  OnexClassStatus,
} from '@prisma/client';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import {
  onexSessionKey,
  type HallClassSnapshotDueItem,
  type HallClassSnapshotItem,
} from '@fitgo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

const SNAPSHOT_OFFSETS_MIN = [20, 40] as const;
/** Capture window after slotAt / nextAttemptAt (agent may poll every 30s). */
const DUE_WINDOW_MS = 3 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
/** First failure schedules one retry; second failure → FAILED. */
const MAX_CAPTURE_ATTEMPTS_BEFORE_FAIL = 1;
const RETENTION_DAYS = 60;

@Injectable()
export class HallSnapshotService {
  private readonly logger = new Logger(HallSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  storageRoot(): string {
    const configured = this.config.get<string>('HALL_SNAPSHOT_DIR')?.trim();
    if (configured) return configured;
    return join(process.cwd(), 'var', 'hall-snapshots');
  }

  async listClubIds(): Promise<string[]> {
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    return clubs.map((c) => c.id);
  }

  async syncTodayAndEnsureSlots(): Promise<void> {
    // Local DB only. Nightly ClassSyncScheduler already pulls Документ.Занятие.
    // Calling 1C here on API boot / every 15m opened extra WordpressUserAPI sessions.
    for (const clubId of await this.listClubIds()) {
      try {
        await this.ensureSlotsForClub(clubId);
      } catch (err) {
        this.logger.error(`Hall snapshot ensureSlots failed ${clubId}`, err);
      }
    }
  }

  async ensureSlotsAllClubs(): Promise<void> {
    for (const clubId of await this.listClubIds()) {
      await this.ensureSlotsForClub(clubId);
    }
  }

  async ensureSlotsForClub(clubId: string): Promise<number> {
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 26 * 60 * 60 * 1000);

    // Drop pending slots for cancelled / inactive GROUP sessions in window
    const cancelled = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        startAt: { gte: from, lte: to },
        OR: [
          { status: OnexClassStatus.CANCELLED },
          { isActive: false },
        ],
      },
      select: { externalId: true },
    });
    if (cancelled.length > 0) {
      await this.prisma.hallClassSnapshot.deleteMany({
        where: {
          clubId,
          status: HallClassSnapshotStatus.PENDING,
          externalId: { in: cancelled.map((c) => c.externalId) },
        },
      });
    }

    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        isActive: true,
        status: { not: OnexClassStatus.CANCELLED },
        startAt: { gte: from, lte: to },
      },
      select: {
        externalId: true,
        startAt: true,
        endAt: true,
        roomTitle: true,
        status: true,
      },
    });

    let created = 0;
    for (const s of sessions) {
      if (!s.roomTitle?.trim()) continue;
      const endAt =
        s.endAt ?? new Date(s.startAt.getTime() + 60 * 60 * 1000);
      const sessionKey = onexSessionKey(s.externalId);
      for (const offsetMin of SNAPSHOT_OFFSETS_MIN) {
        const slotAt = new Date(s.startAt.getTime() + offsetMin * 60 * 1000);
        if (slotAt.getTime() >= endAt.getTime()) continue;
        const existing = await this.prisma.hallClassSnapshot.findUnique({
          where: {
            clubId_externalId_offsetMin_cameraKey: {
              clubId,
              externalId: s.externalId,
              offsetMin,
              cameraKey: '',
            },
          },
        });
        if (existing) continue;
        await this.prisma.hallClassSnapshot.create({
          data: {
            clubId,
            externalId: s.externalId,
            sessionKey,
            roomTitle: s.roomTitle.trim(),
            offsetMin,
            slotAt,
            cameraKey: '',
            status: HallClassSnapshotStatus.PENDING,
          },
        });
        created += 1;
      }
    }
    return created;
  }

  async listDue(clubId: string): Promise<HallClassSnapshotDueItem[]> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - DUE_WINDOW_MS);

    const rows = await this.prisma.hallClassSnapshot.findMany({
      where: {
        clubId,
        status: HallClassSnapshotStatus.PENDING,
        OR: [
          {
            captureAttempts: 0,
            nextAttemptAt: null,
            slotAt: { gte: windowStart, lte: now },
          },
          {
            captureAttempts: { gt: 0 },
            nextAttemptAt: { gte: windowStart, lte: now },
          },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { slotAt: 'asc' }],
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      clubId: r.clubId,
      sessionKey: r.sessionKey,
      externalId: r.externalId,
      roomTitle: r.roomTitle,
      offsetMin: r.offsetMin,
      slotAt: r.slotAt.toISOString(),
    }));
  }

  async uploadJpeg(
    clubId: string,
    snapshotId: string,
    buffer: Buffer,
    meta?: { cameraLabel?: string; cameraKey?: string },
  ): Promise<HallClassSnapshotItem> {
    if (!buffer?.length) {
      throw new BadRequestException('Пустой файл снимка');
    }
    const row = await this.prisma.hallClassSnapshot.findFirst({
      where: { id: snapshotId, clubId },
    });
    if (!row) throw new NotFoundException('Слот снимка не найден');
    if (row.status === HallClassSnapshotStatus.CAPTURED && row.filePath) {
      return this.toItem(row);
    }

    const dir = join(this.storageRoot(), clubId, row.externalId);
    mkdirSync(dir, { recursive: true });
    const fileName = `${row.offsetMin}.jpg`;
    const filePath = join(dir, fileName);
    await writeFile(filePath, buffer);

    const updated = await this.prisma.hallClassSnapshot.update({
      where: { id: row.id },
      data: {
        status: HallClassSnapshotStatus.CAPTURED,
        filePath,
        capturedAt: new Date(),
        errorMessage: null,
        nextAttemptAt: null,
        cameraLabel: meta?.cameraLabel?.trim() || row.cameraLabel,
        cameraKey: meta?.cameraKey?.trim() || row.cameraKey,
      },
    });
    return this.toItem(updated);
  }

  async markFailed(
    clubId: string,
    snapshotId: string,
    errorMessage: string,
  ): Promise<HallClassSnapshotItem> {
    const row = await this.prisma.hallClassSnapshot.findFirst({
      where: { id: snapshotId, clubId },
    });
    if (!row) throw new NotFoundException('Слот снимка не найден');
    if (row.status === HallClassSnapshotStatus.CAPTURED) {
      return this.toItem(row);
    }

    const msg = (errorMessage || 'capture failed').slice(0, 500);
    const noCamera =
      /no camera|нет камеры/i.test(msg);

    // Permanent fail: no matching camera, or already used the one retry
    if (
      noCamera ||
      row.captureAttempts >= MAX_CAPTURE_ATTEMPTS_BEFORE_FAIL
    ) {
      const updated = await this.prisma.hallClassSnapshot.update({
        where: { id: row.id },
        data: {
          status: HallClassSnapshotStatus.FAILED,
          errorMessage: msg,
          nextAttemptAt: null,
          captureAttempts: row.captureAttempts + 1,
        },
      });
      return this.toItem(updated);
    }

    // Schedule one retry in 5 minutes
    const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
    const updated = await this.prisma.hallClassSnapshot.update({
      where: { id: row.id },
      data: {
        status: HallClassSnapshotStatus.PENDING,
        captureAttempts: row.captureAttempts + 1,
        nextAttemptAt,
        errorMessage: `${msg} (повтор ~${nextAttemptAt.toISOString().slice(11, 16)} UTC)`,
      },
    });
    this.logger.warn(
      `Hall snapshot ${row.id} retry at ${nextAttemptAt.toISOString()}: ${msg}`,
    );
    return this.toItem(updated);
  }

  async listForSession(
    clubId: string,
    sessionKey: string,
  ): Promise<HallClassSnapshotItem[]> {
    const key = sessionKey.trim();
    if (!key.startsWith('1c:')) {
      return [];
    }
    const rows = await this.prisma.hallClassSnapshot.findMany({
      where: { clubId, sessionKey: key },
      orderBy: [{ offsetMin: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toItem(r));
  }

  /** Resolve sessionKey for a snapshot (ownership checks). */
  async listForSessionById(
    clubId: string,
    snapshotId: string,
  ): Promise<{ sessionKey: string }> {
    const row = await this.prisma.hallClassSnapshot.findFirst({
      where: { id: snapshotId, clubId },
      select: { sessionKey: true },
    });
    if (!row) throw new NotFoundException('Снимок не найден');
    return { sessionKey: row.sessionKey };
  }

  async openImage(
    clubId: string,
    snapshotId: string,
  ): Promise<StreamableFile> {
    const row = await this.prisma.hallClassSnapshot.findFirst({
      where: { id: snapshotId, clubId },
    });
    if (!row?.filePath || row.status !== HallClassSnapshotStatus.CAPTURED) {
      throw new NotFoundException('Снимок ещё не готов');
    }
    if (!existsSync(row.filePath)) {
      throw new NotFoundException('Файл снимка отсутствует на диске');
    }
    return new StreamableFile(createReadStream(row.filePath), {
      type: 'image/jpeg',
      disposition: `inline; filename="${row.externalId}-${row.offsetMin}.jpg"`,
    });
  }

  async purgeOlderThanRetention(): Promise<number> {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const old = await this.prisma.hallClassSnapshot.findMany({
      where: { slotAt: { lt: cutoff } },
      select: { id: true, filePath: true },
    });
    for (const row of old) {
      if (row.filePath && existsSync(row.filePath)) {
        try {
          unlinkSync(row.filePath);
        } catch (err) {
          this.logger.warn(`Failed to delete ${row.filePath}: ${String(err)}`);
        }
      }
    }
    if (old.length === 0) return 0;
    const res = await this.prisma.hallClassSnapshot.deleteMany({
      where: { id: { in: old.map((r) => r.id) } },
    });
    return res.count;
  }

  private toItem(row: {
    id: string;
    sessionKey: string;
    externalId: string;
    roomTitle: string;
    offsetMin: number;
    slotAt: Date;
    status: HallClassSnapshotStatus;
    captureAttempts?: number;
    nextAttemptAt?: Date | null;
    cameraLabel: string | null;
    errorMessage: string | null;
    capturedAt: Date | null;
    filePath: string | null;
  }): HallClassSnapshotItem {
    return {
      id: row.id,
      sessionKey: row.sessionKey,
      externalId: row.externalId,
      roomTitle: row.roomTitle,
      offsetMin: row.offsetMin,
      slotAt: row.slotAt.toISOString(),
      status: row.status,
      captureAttempts: row.captureAttempts ?? 0,
      nextAttemptAt: row.nextAttemptAt?.toISOString(),
      cameraLabel: row.cameraLabel ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      capturedAt: row.capturedAt?.toISOString(),
      imagePath:
        row.status === HallClassSnapshotStatus.CAPTURED
          ? row.id
          : undefined,
    };
  }

  /** Europe/Minsk calendar day YYYY-MM-DD (UTC+3 year-round). */
  private clubDateKey(d: Date): string {
    const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
}
