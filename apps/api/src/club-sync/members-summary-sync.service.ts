import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FitgoAnalyticsHttpProvider } from '@fitgo/1c-adapter';
import { PrismaService } from '../prisma/prisma.service';
import { addMoscowDays, moscowDayKey } from './moscow-time';

const RESOURCE_KEY = 'members_summary';

@Injectable()
export class MembersSummarySyncService {
  private readonly logger = new Logger(MembersSummarySyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private provider(): FitgoAnalyticsHttpProvider | null {
    const baseUrl = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim() ?? '';
    const basicAuth =
      this.config.get<string>('FORMA_BASIC_AUTH')?.trim() ?? '';
    if (!baseUrl || !apiKey) return null;
    return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
  }

  async syncClub(
    clubId: string,
    opts?: { from?: string; to?: string },
  ): Promise<{ from: string; to: string; upserted: number }> {
    const today = moscowDayKey();
    const to = opts?.to ?? today;
    const from = opts?.from ?? addMoscowDays(to, -30);

    await this.prisma.salesSyncState.upsert({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      create: {
        clubId,
        resourceKey: RESOURCE_KEY,
        lastStatus: 'running',
        lastRunAt: new Date(),
      },
      update: {
        lastStatus: 'running',
        lastRunAt: new Date(),
        lastError: null,
      },
    });

    const provider = this.provider();
    if (!provider?.getMembersSummary) {
      await this.mark(clubId, 'skipped', 'Analytics URL / getMembersSummary unavailable');
      return { from, to, upserted: 0 };
    }

    try {
      const snap = await provider.getMembersSummary({ from, to });
      if (!snap) {
        await this.mark(
          clubId,
          'skipped',
          'scope=members unavailable (publish ПолучитьСводкуАбонементов)',
        );
        return { from, to, upserted: 0 };
      }

      const asOfDate = (snap.asOf || to).slice(0, 10);
      await this.prisma.clubMembersSummary.upsert({
        where: { clubId_asOfDate: { clubId, asOfDate } },
        create: {
          clubId,
          asOfDate,
          fromDate: (snap.from || from).slice(0, 10),
          active: snap.active,
          frozen: snap.frozen,
          expiring7: snap.expiring7,
          expiring30: snap.expiring30,
          endedInPeriod: snap.endedInPeriod,
          endedClientIds: snap.endedClientIds,
          syncedAt: new Date(),
        },
        update: {
          fromDate: (snap.from || from).slice(0, 10),
          active: snap.active,
          frozen: snap.frozen,
          expiring7: snap.expiring7,
          expiring30: snap.expiring30,
          endedInPeriod: snap.endedInPeriod,
          endedClientIds: snap.endedClientIds,
          syncedAt: new Date(),
        },
      });

      await this.mark(clubId, 'ok', null);
      this.logger.log(
        `Members summary ${clubId}: active=${snap.active} frozen=${snap.frozen} asOf=${asOfDate}`,
      );
      return { from, to, upserted: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.mark(clubId, 'error', msg);
      this.logger.warn(`Members summary ${clubId}: ${msg}`);
      return { from, to, upserted: 0 };
    }
  }

  private async mark(
    clubId: string,
    status: string,
    error: string | null,
  ) {
    await this.prisma.salesSyncState.update({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      data: {
        lastStatus: status,
        lastError: error,
        lastSuccessAt: status === 'ok' ? new Date() : undefined,
      },
    });
  }
}
