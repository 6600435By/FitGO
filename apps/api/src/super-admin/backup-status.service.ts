import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const STALE_MS = 36 * 60 * 60 * 1000;

export type BackupStatusReason = 'failed' | 'stale' | 'missing';

export type BackupStatusResponse = {
  warn: boolean;
  reason?: BackupStatusReason;
  message?: string;
  finishedAt?: string | null;
  ok?: boolean;
  bundleId?: string | null;
};

type StatusFile = {
  ok?: boolean;
  finishedAt?: string | null;
  error?: string | null;
  bundleId?: string | null;
  dumpBytes?: number | null;
  durationSec?: number | null;
};

@Injectable()
export class BackupStatusService {
  private readonly logger = new Logger(BackupStatusService.name);

  constructor(private readonly config: ConfigService) {}

  statusPath(): string {
    const configured = this.config.get<string>('FITGO_BACKUP_STATUS_PATH')?.trim();
    if (configured) return configured;
    return join(process.cwd(), 'var', 'backup-status.json');
  }

  getStatus(): BackupStatusResponse {
    const path = this.statusPath();
    if (!existsSync(path)) {
      return {
        warn: true,
        reason: 'missing',
        message:
          'Резервная копия ещё не настроена. На сервере клуба зарегистрируйте задачу FitGO-Backup.',
        finishedAt: null,
        ok: false,
        bundleId: null,
      };
    }

    let raw: StatusFile;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as StatusFile;
    } catch (err) {
      this.logger.warn(`Cannot parse backup-status.json at ${path}`, err);
      return {
        warn: true,
        reason: 'failed',
        message: 'Файл статуса резервной копии повреждён. Проверьте Backup-FitGO.ps1 на сервере.',
        finishedAt: null,
        ok: false,
        bundleId: null,
      };
    }

    const finishedAt = raw.finishedAt ?? null;
    const bundleId = raw.bundleId ?? null;

    if (raw.ok !== true) {
      const detail = (raw.error || '').trim();
      const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
      const when = finishedAt
        ? ` Последняя попытка: ${this.formatLocal(finishedAt)}.`
        : '';
      return {
        warn: true,
        reason: 'failed',
        message: `Резервная копия с ошибкой.${when}${suffix} Проверьте задачу FitGO-Backup на сервере клуба.`,
        finishedAt,
        ok: false,
        bundleId,
      };
    }

    const finishedMs = finishedAt ? Date.parse(finishedAt) : NaN;
    if (!Number.isFinite(finishedMs)) {
      return {
        warn: true,
        reason: 'stale',
        message:
          'Резервная копия: нет времени последнего успеха. Проверьте задачу FitGO-Backup на сервере клуба.',
        finishedAt,
        ok: true,
        bundleId,
      };
    }

    if (Date.now() - finishedMs > STALE_MS) {
      return {
        warn: true,
        reason: 'stale',
        message: `Резервная копия устарела (последний успех: ${this.formatLocal(finishedAt!)}). Проверьте задачу FitGO-Backup на сервере клуба.`,
        finishedAt,
        ok: true,
        bundleId,
      };
    }

    return {
      warn: false,
      finishedAt,
      ok: true,
      bundleId,
    };
  }

  private formatLocal(iso: string): string {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Minsk',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }
}
