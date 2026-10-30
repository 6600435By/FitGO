import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { PhoneOtpPurpose, SmsPurpose } from '@prisma/client';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { RocketSmsClient } from './rocketsms.client';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rocketsms: RocketSmsClient,
    private readonly config: ConfigService,
  ) {}

  private hashCode(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }

  private clubName(): string {
    return this.config.get<string>('SMS_CLUB_NAME')?.trim() || 'Forma';
  }

  private clientLkUrl(): string {
    return (
      this.config.get<string>('CLIENT_WEB_URL')?.replace(/\/$/, '') ||
      'https://lk.ffs.by'
    );
  }

  /** Dev/pilot: log OTP instead of sending when RocketSMS is off or SMS_OTP_DEV_LOG=1. */
  private otpDevLog(): boolean {
    if (this.config.get('SMS_OTP_DEV_LOG') === '1') return true;
    if (this.config.get('NODE_ENV') !== 'production' && !this.rocketsms.isConfigured()) {
      return true;
    }
    return false;
  }

  async sendOtp(phoneRaw: string, purpose: PhoneOtpPurpose) {
    const phoneNormalized = normalizePhone(phoneRaw);
    if (phoneNormalized.length < 11) {
      throw new BadRequestException('Некорректный номер телефона');
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.phoneVerificationCode.count({
      where: {
        phoneNormalized,
        purpose,
        createdAt: { gte: hourAgo },
      },
    });
    if (recentCount >= OTP_MAX_PER_HOUR) {
      throw new HttpException(
        'Слишком много кодов. Попробуйте через час.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const last = await this.prisma.phoneVerificationCode.findFirst({
      where: { phoneNormalized, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_MS) {
      const waitSec = Math.ceil(
        (OTP_RESEND_MS - (Date.now() - last.createdAt.getTime())) / 1000,
      );
      throw new HttpException(
        `Подождите ${waitSec} с перед повторной отправкой`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.prisma.phoneVerificationCode.create({
      data: {
        phoneNormalized,
        codeHash: this.hashCode(code),
        purpose,
        expiresAt,
      },
    });

    const text = `${this.clubName()}: код ${code}. Действует 10 мин.`;

    if (this.otpDevLog()) {
      this.logger.warn(
        `[SMS_OTP_DEV] phone=${phoneNormalized} purpose=${purpose} code=${code}`,
      );
      await this.prisma.smsMessageLog.create({
        data: {
          phoneNormalized,
          purpose: SmsPurpose.OTP,
          status: 'DEV_LOG',
        },
      });
      return { ok: true as const, phoneNormalized, expiresInSec: 600 };
    }

    if (!this.rocketsms.isConfigured()) {
      throw new ServiceUnavailableException(
        'SMS временно недоступна. Обратитесь на ресепшен.',
      );
    }

    const result = await this.rocketsms.send({
      phoneNormalized,
      text,
      priority: true,
    });
    await this.prisma.smsMessageLog.create({
      data: {
        phoneNormalized,
        purpose: SmsPurpose.OTP,
        providerId: result.ok ? result.id : undefined,
        status: result.ok ? result.status ?? 'SENT' : 'FAILED',
        error: result.ok ? undefined : result.error,
      },
    });
    if (!result.ok) {
      throw new ServiceUnavailableException(
        'Не удалось отправить SMS. Попробуйте позже или обратитесь на ресепшен.',
      );
    }
    return { ok: true as const, phoneNormalized, expiresInSec: 600 };
  }

  async verifyOtp(
    phoneRaw: string,
    purpose: PhoneOtpPurpose,
    codeRaw: string,
  ): Promise<{ phoneNormalized: string }> {
    const phoneNormalized = normalizePhone(phoneRaw);
    const code = codeRaw.trim();
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Введите 6-значный код');
    }

    const row = await this.prisma.phoneVerificationCode.findFirst({
      where: {
        phoneNormalized,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new BadRequestException('Код истёк или не запрошен');
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpException(
        'Слишком много попыток. Запросите новый код.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const match = row.codeHash === this.hashCode(code);
    await this.prisma.phoneVerificationCode.update({
      where: { id: row.id },
      data: {
        attempts: { increment: 1 },
        ...(match ? { consumedAt: new Date() } : {}),
      },
    });
    if (!match) {
      throw new BadRequestException('Неверный код');
    }
    return { phoneNormalized };
  }

  /**
   * Club message SMS (not OTP). Returns null when skipped (opt-out / no phone).
   */
  async sendClubMessageSms(params: {
    phoneNormalized: string | null | undefined;
    userId: string;
    body: string;
  }): Promise<{ sent: boolean; providerId?: string; error?: string; skipped?: string }> {
    const phone = params.phoneNormalized
      ? normalizePhone(params.phoneNormalized)
      : '';
    if (!phone || phone.length < 11) {
      return { sent: false, skipped: 'NO_PHONE' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { smsClubOptOutAt: true },
    });
    if (user?.smsClubOptOutAt) {
      return { sent: false, skipped: 'OPT_OUT' };
    }

    if (!this.rocketsms.isConfigured()) {
      return { sent: false, error: 'ROCKETSMS_NOT_CONFIGURED' };
    }

    const lk = this.clientLkUrl();
    const short =
      params.body.length <= 60
        ? params.body
        : `${params.body.slice(0, 57)}…`;
    const text = `${this.clubName()}: ${short} ${lk}`;

    const result = await this.rocketsms.send({
      phoneNormalized: phone,
      text,
      priority: false,
    });
    await this.prisma.smsMessageLog.create({
      data: {
        phoneNormalized: phone,
        purpose: SmsPurpose.CLUB_MESSAGE,
        providerId: result.ok ? result.id : undefined,
        status: result.ok ? result.status ?? 'SENT' : 'FAILED',
        error: result.ok ? undefined : result.error,
        userId: params.userId,
      },
    });
    if (!result.ok) {
      return { sent: false, error: result.error };
    }
    return { sent: true, providerId: result.id };
  }
}
