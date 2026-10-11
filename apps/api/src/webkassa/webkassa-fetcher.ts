import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fetches cheque_report from cabinet.webkassa.by.
 *
 * Prefer HTTP cookie session (login form → export URL). If WEBКASSA_EXPORT_URL
 * template is set, builds `cheque_report_{fromMs}_{toMs}` style download.
 * Falls back to throwing with a clear message when credentials are missing —
 * UI still supports manual xlsx upload.
 */
export class WebkassaFetcher {
  private readonly logger = new Logger(WebkassaFetcher.name);
  private cookie = '';

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return Boolean(
      this.config.get<string>('WEBKASSA_LOGIN')?.trim() &&
        this.config.get<string>('WEBKASSA_PASSWORD')?.trim(),
    );
  }

  async fetchReport(from: Date, to: Date): Promise<Buffer> {
    const login = this.config.get<string>('WEBKASSA_LOGIN')?.trim();
    const password = this.config.get<string>('WEBKASSA_PASSWORD')?.trim();
    if (!login || !password) {
      throw new Error(
        'WEBKASSA_LOGIN / WEBKASSA_PASSWORD не заданы — загрузите xlsx вручную',
      );
    }

    const fromMs = from.getTime();
    const toMs = to.getTime();

    const exportTemplate =
      this.config.get<string>('WEBKASSA_EXPORT_URL')?.trim() ||
      'https://cabinet.webkassa.by/api/reports/cheque_report?from={fromMs}&to={toMs}';
    const exportUrl = exportTemplate
      .replace('{fromMs}', String(fromMs))
      .replace('{toMs}', String(toMs));

    await this.ensureSession(login, password);

    let res = await fetch(exportUrl, {
      headers: { Cookie: this.cookie, Accept: '*/*' },
      redirect: 'manual',
    });
    if (res.status === 401 || res.status === 302 || res.status === 303) {
      this.cookie = '';
      await this.ensureSession(login, password);
      res = await fetch(exportUrl, {
        headers: { Cookie: this.cookie, Accept: '*/*' },
        redirect: 'manual',
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Webkassa export HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) {
      throw new Error('Webkassa вернула пустой отчёт');
    }
    this.logger.log(`Webkassa report downloaded (${buf.length} bytes)`);
    return buf;
  }

  private async ensureSession(login: string, password: string) {
    if (this.cookie) return;
    const loginUrl =
      this.config.get<string>('WEBKASSA_LOGIN_URL')?.trim() ||
      'https://cabinet.webkassa.by/api/auth/login';

    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        login,
        email: login,
        username: login,
        password,
      }),
      redirect: 'manual',
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    const single = res.headers.get('set-cookie');
    const cookies = setCookie.length
      ? setCookie
      : single
        ? [single]
        : [];
    this.cookie = cookies
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');

    if (!this.cookie && !res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Webkassa login failed HTTP ${res.status}: ${text.slice(0, 200)}. ` +
          'Уточните WEBKASSA_LOGIN_URL / WEBKASSA_EXPORT_URL по Network в кабинете.',
      );
    }
  }
}
