import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fetches cheque report from cabinet.webkassa.by.
 *
 * Real ЛК login is NOT a plain JSON POST: the SPA at
 * https://cabinet.webkassa.by/login gets CSRF from GET /rsCashAppsWeb/index,
 * salt from POST /rsCashAppsWeb/noauth/crypto/salt, transforms the password,
 * then POSTs form-urlencoded to /rsCashAppsWeb/login.
 * Excel is POST /rsCashAppsWeb/cashdocs/report/checks/{kind} with a period body.
 *
 * Until that full flow is implemented here, credentials alone are not enough —
 * use «Загрузить xlsx» from the cabinet report.
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

    const loginUrl =
      this.config.get<string>('WEBKASSA_LOGIN_URL')?.trim() ||
      'https://cabinet.webkassa.by/api/auth/login';
    const exportTemplate =
      this.config.get<string>('WEBKASSA_EXPORT_URL')?.trim() ||
      'https://cabinet.webkassa.by/api/reports/cheque_report?from={fromMs}&to={toMs}';

    const cfgError = explainBadWebkassaConfig(loginUrl, exportTemplate);
    if (cfgError) throw new Error(cfgError);

    const fromMs = from.getTime();
    const toMs = to.getTime();
    const exportUrl = exportTemplate
      .replace('{fromMs}', String(fromMs))
      .replace('{toMs}', String(toMs));

    await this.ensureSession(login, password, loginUrl);

    let res = await fetch(exportUrl, {
      headers: { Cookie: this.cookie, Accept: '*/*' },
      redirect: 'manual',
    });
    if (res.status === 401 || res.status === 302 || res.status === 303) {
      this.cookie = '';
      await this.ensureSession(login, password, loginUrl);
      res = await fetch(exportUrl, {
        headers: { Cookie: this.cookie, Accept: '*/*' },
        redirect: 'manual',
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(formatWebkassaHttpError(res.status, text));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) {
      throw new Error('Webkassa вернула пустой отчёт');
    }
    this.logger.log(`Webkassa report downloaded (${buf.length} bytes)`);
    return buf;
  }

  private async ensureSession(
    login: string,
    password: string,
    loginUrl: string,
  ) {
    if (this.cookie) return;

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
    const cookies = setCookie.length ? setCookie : single ? [single] : [];
    this.cookie = cookies
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');

    if (!this.cookie && !res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `${formatWebkassaHttpError(res.status, text)} Войдите на https://cabinet.webkassa.by/login, скачайте отчёт и нажмите «Загрузить xlsx».`,
      );
    }
  }
}

/**
 * Detect env mistakes: Spring form page, 1C paths, GET-only cashdocs URL.
 */
export function explainBadWebkassaConfig(
  loginUrl: string,
  exportUrl: string,
): string | null {
  if (/forma\/hs|fitgo\/hs/i.test(loginUrl) || /forma\/hs|fitgo\/hs/i.test(exportUrl)) {
    return 'WEBKASSA_* URL указывает на 1С, а не на кабинет Webkassa. Загрузите xlsx вручную.';
  }

  // Spring Security HTML form — not the ЛК SPA. Password there must be crypto-transformed.
  if (/\/rsCashAppsWeb\/login\/?$/i.test(loginUrl.replace(/\?.*$/, ''))) {
    return [
      'WEBKASSA_LOGIN_URL — это форма Spring (/rsCashAppsWeb/login), не вход в ЛК.',
      'Пароль FitGO там не подойдёт: кабинет сначала шифрует его через salt.',
      'Войдите на https://cabinet.webkassa.by/login, скачайте отчёт по чекам и нажмите «Загрузить xlsx».',
    ].join(' ');
  }

  // Real export is POST /rsCashAppsWeb/cashdocs/report/checks/{kind} with body — not bare GET.
  if (/\/cashdocs\/report\/checks\/\d+\/?$/i.test(exportUrl.replace(/\?.*$/, ''))) {
    return [
      'WEBKASSA_EXPORT_URL — это POST API отчёта кабинета (не прямая ссылка на файл).',
      'GET по этому адресу даёт 500 «метод GET не существует».',
      'Пока автовыгрузка не доведена: скачайте cheque_report_*.xls в ЛК и «Загрузить xlsx».',
    ].join(' ');
  }

  return null;
}

function formatWebkassaHttpError(status: number, text: string): string {
  const raw = text.trim();
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const msg = [j.errMessForClient, j.errMessageForClient, j.message, j.error].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    if (msg && /не существует|cashdocs|GET не существует/i.test(msg)) {
      return 'Адрес выгрузки Webkassa неверный (нужен POST отчёта из ЛК). Загрузите xlsx вручную.';
    }
    if (msg) return msg.slice(0, 180);
  } catch {
    /* not JSON */
  }
  if (status === 404 || status === 405) {
    return 'Адрес выгрузки Webkassa неверный. Загрузите xlsx вручную.';
  }
  return `Выгрузка Webkassa не удалась (HTTP ${status}). Загрузите xlsx вручную.`;
}
