import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import { parsePeriod } from '../discrepancies/discrepancies-period';
import { WebkassaFetcher } from './webkassa-fetcher';
import {
  parseWebkassaXlsx,
  type ParsedWebkassaReceipt,
} from './webkassa-parser';

@Injectable()
export class WebkassaService {
  private readonly logger = new Logger(WebkassaService.name);
  private readonly fetcher: WebkassaFetcher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.fetcher = new WebkassaFetcher(config);
  }

  async upload(user: JwtPayload, buffer: Buffer) {
    const clubId = requireClubId(user);
    let rows: ParsedWebkassaReceipt[];
    try {
      rows = await parseWebkassaXlsx(buffer);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Ошибка разбора xlsx',
      );
    }
    const saved = await this.upsertRows(clubId, rows);
    await this.touchState(clubId, {
      status: 'ok',
      error: null,
      count: saved,
      from: rows[0]?.occurredAt.toISOString().slice(0, 10) ?? null,
      to: rows[rows.length - 1]?.occurredAt.toISOString().slice(0, 10) ?? null,
    });
    return { ok: true, count: saved };
  }

  async sync(user: JwtPayload, from?: string, to?: string) {
    const clubId = requireClubId(user);
    if (!this.fetcher.configured()) {
      throw new ServiceUnavailableException(
        'WEBKASSA_LOGIN / WEBKASSA_PASSWORD не заданы. Загрузите xlsx вручную или настройте .env.',
      );
    }
    const period = parsePeriod(from, to);
    try {
      const buf = await this.fetcher.fetchReport(period.fromD, period.toD);
      const rows = await parseWebkassaXlsx(buf);
      const saved = await this.upsertRows(clubId, rows);
      await this.touchState(clubId, {
        status: 'ok',
        error: null,
        count: saved,
        from: period.from,
        to: period.to,
      });
      return { ok: true, count: saved };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webkassa sync failed: ${message}`);
      await this.touchState(clubId, {
        status: 'error',
        error: message,
        count: 0,
        from: period.from,
        to: period.to,
      });
      throw new ServiceUnavailableException(message);
    }
  }

  async syncClub(clubId: string, from: Date, to: Date) {
    if (!this.fetcher.configured()) return { skipped: true, count: 0 };
    try {
      const buf = await this.fetcher.fetchReport(from, to);
      const rows = await parseWebkassaXlsx(buf);
      const saved = await this.upsertRows(clubId, rows);
      await this.touchState(clubId, {
        status: 'ok',
        error: null,
        count: saved,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
      return { skipped: false, count: saved };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.touchState(clubId, {
        status: 'error',
        error: message,
        count: 0,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
      throw err;
    }
  }

  status(user: JwtPayload) {
    const clubId = requireClubId(user);
    return this.prisma.webkassaSyncState.findUnique({ where: { clubId } });
  }

  private async upsertRows(clubId: string, rows: ParsedWebkassaReceipt[]) {
    let n = 0;
    for (const r of rows) {
      await this.prisma.webkassaReceipt.upsert({
        where: {
          clubId_receiptId: { clubId, receiptId: r.receiptId },
        },
        create: {
          clubId,
          receiptId: r.receiptId,
          occurredAt: r.occurredAt,
          shiftNumber: r.shiftNumber,
          kedNumber: r.kedNumber,
          amount: r.amount,
          cash: r.cash,
          cashless: r.cashless,
          receiptType: r.receiptType,
          tradeObject: r.tradeObject,
          cashier: r.cashier,
          status: r.status,
          uid: r.uid,
        },
        update: {
          occurredAt: r.occurredAt,
          shiftNumber: r.shiftNumber,
          kedNumber: r.kedNumber,
          amount: r.amount,
          cash: r.cash,
          cashless: r.cashless,
          receiptType: r.receiptType,
          tradeObject: r.tradeObject,
          cashier: r.cashier,
          status: r.status,
          uid: r.uid,
          syncedAt: new Date(),
        },
      });
      n += 1;
    }
    return n;
  }

  private async touchState(
    clubId: string,
    opts: {
      status: string;
      error: string | null;
      count: number;
      from: string | null;
      to: string | null;
    },
  ) {
    const now = new Date();
    await this.prisma.webkassaSyncState.upsert({
      where: { clubId },
      create: {
        clubId,
        lastRunAt: now,
        lastSuccessAt: opts.status === 'ok' ? now : null,
        lastStatus: opts.status,
        lastError: opts.error,
        lastFrom: opts.from,
        lastTo: opts.to,
        lastCount: opts.count,
      },
      update: {
        lastRunAt: now,
        ...(opts.status === 'ok' ? { lastSuccessAt: now } : {}),
        lastStatus: opts.status,
        lastError: opts.error,
        lastFrom: opts.from,
        lastTo: opts.to,
        lastCount: opts.count,
      },
    });
  }
}
