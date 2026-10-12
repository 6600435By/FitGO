import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cryptLoginPassword } from './webkassa-crypto';

const DEFAULT_BASE = 'https://cabinet.webkassa.by/rsCashAppsWeb';
const DEFAULT_REPORT_KIND = '100';

/**
 * Fetches cheque report from cabinet.webkassa.by ЛК.
 *
 * Flow (SPA parity):
 * 1. GET  /rsCashAppsWeb/index → cookies + X-CSRF-TOKEN
 * 2. POST /rsCashAppsWeb/noauth/crypto/salt { value: login }
 * 3. cryptLoginPassword: bcrypt → AES decrypt secret → AES encrypt(bcryptHash)
 * 4. POST /rsCashAppsWeb/login (form-urlencoded: username+password only)
 * 5. POST /rsCashAppsWeb/cashdocs/report/checks/{kind} → xlsx
 */
export class WebkassaFetcher {
  private readonly logger = new Logger(WebkassaFetcher.name);
  private cookie = '';
  private csrf = '';

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

    const base = this.baseUrl();
    const cfgError = explainBadWebkassaConfig(base);
    if (cfgError) throw new Error(cfgError);

    await this.ensureSession(login, password, base);

    const kind =
      this.config.get<string>('WEBKASSA_REPORT_KIND')?.trim() ||
      DEFAULT_REPORT_KIND;
    const exportUrl = `${base}/cashdocs/report/checks/${kind}`;
    const body = {
      sort: { sortList: [] as unknown[] },
      filter: {
        list: [
          {
            oper: 'BETWEEN',
            field: 'docDate',
            values: [from.getTime(), to.getTime()],
            orAnd: 'AND',
          },
        ],
      },
    };

    let res = await this.postJson(exportUrl, body);
    if (res.status === 401 || res.status === 302 || res.status === 303) {
      this.resetSession();
      await this.ensureSession(login, password, base);
      res = await this.postJson(exportUrl, body);
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

  private baseUrl(): string {
    const fromEnv = this.config.get<string>('WEBKASSA_BASE_URL')?.trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return DEFAULT_BASE;
  }

  private resetSession() {
    this.cookie = '';
    this.csrf = '';
  }

  private async ensureSession(
    login: string,
    password: string,
    base: string,
  ) {
    if (this.cookie && this.csrf) return;

    await this.bootstrap(base);
    const salt = await this.fetchSalt(base, login);
    const encryptedPassword = cryptLoginPassword(salt, password);
    await this.login(base, login, encryptedPassword);
  }

  private async bootstrap(base: string) {
    const res = await fetch(`${base}/index`, {
      method: 'GET',
      headers: { Accept: 'text/html,application/json,*/*' },
      redirect: 'manual',
    });
    this.ingestCookies(res);
    this.ingestCsrf(res);
    if (!this.csrf) {
      const html = await res.text().catch(() => '');
      this.csrfFromHtml(html);
    }
    if (!this.csrf) {
      throw new Error(
        'Webkassa: не получен X-CSRF-TOKEN. Проверьте доступ к cabinet.webkassa.by',
      );
    }
  }

  private async fetchSalt(base: string, login: string): Promise<string> {
    const res = await fetch(`${base}/noauth/crypto/salt`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ value: login }),
      redirect: 'manual',
    });
    this.ingestCookies(res);
    this.ingestCsrf(res);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Webkassa salt failed (HTTP ${res.status}): ${text.slice(0, 120)}`,
      );
    }
    const json = (await res.json()) as { value?: string };
    if (!json.value || json.value.length < 30) {
      throw new Error('Webkassa salt: пустой ответ');
    }
    return json.value;
  }

  private async login(
    base: string,
    username: string,
    encryptedPassword: string,
  ) {
    // SPA: only username+password in body; CSRF only as X-CSRF-TOKEN header.
    const body = new URLSearchParams({
      username,
      password: encryptedPassword,
    }).toString();
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        Cookie: this.cookie,
        ...(this.csrf ? { 'X-CSRF-TOKEN': this.csrf } : {}),
      },
      body,
      redirect: 'manual',
    });
    this.ingestCookies(res);
    this.ingestCsrf(res);

    const loc = res.headers.get('location') || '';
    const text = await res.text().catch(() => '');

    // SPA treats status>=400 as login error with JSON errMessForClient.
    if (res.status >= 400) {
      throw new Error(
        formatWebkassaHttpError(res.status, text) ||
          'Webkassa: отказ входа (проверьте WEBKASSA_LOGIN / WEBKASSA_PASSWORD)',
      );
    }
    if (/login.*error|error=true|\/login\/?$/i.test(loc)) {
      throw new Error(
        'Webkassa: отказ входа (проверьте WEBKASSA_LOGIN / WEBKASSA_PASSWORD)',
      );
    }
    if (/Please sign in|name=["']username["']/i.test(text)) {
      throw new Error(
        'Webkassa: отказ входа (проверьте WEBKASSA_LOGIN / WEBKASSA_PASSWORD)',
      );
    }
    // JSON error body even on 200 (defensive)
    const loginErr = parseWebkassaErrorMessage(text);
    if (loginErr) throw new Error(loginErr);
    if (!this.cookie) {
      throw new Error(
        `${formatWebkassaHttpError(res.status, text)} Войдите на https://cabinet.webkassa.by/login, скачайте отчёт и нажмите «Загрузить xlsx».`,
      );
    }

    // Refresh CSRF after login redirect (rare for SPA; success is usually 200).
    if ((res.status === 302 || res.status === 303) && loc) {
      const nextUrl = loc.startsWith('http')
        ? loc
        : new URL(loc, base).toString();
      const follow = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          Cookie: this.cookie,
          Accept: 'text/html,application/json,*/*',
          ...(this.csrf ? { 'X-CSRF-TOKEN': this.csrf } : {}),
        },
        redirect: 'manual',
      });
      this.ingestCookies(follow);
      this.ingestCsrf(follow);
      if (!this.csrf) {
        const html = await follow.text().catch(() => '');
        this.csrfFromHtml(html);
      }
    } else if (!this.csrf) {
      this.csrfFromHtml(text);
    }
  }

  private async postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  }

  private jsonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json,application/octet-stream,*/*',
      Cookie: this.cookie,
      ...(this.csrf ? { 'X-CSRF-TOKEN': this.csrf } : {}),
    };
  }

  private ingestCookies(res: Response) {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const single = res.headers.get('set-cookie');
    const headers = setCookie.length ? setCookie : single ? [single] : [];
    if (!headers.length) return;

    const map = new Map<string, string>();
    for (const part of this.cookie.split('; ').filter(Boolean)) {
      const i = part.indexOf('=');
      if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
    }
    for (const header of headers) {
      const first = header.split(';')[0]?.trim();
      if (!first) continue;
      const i = first.indexOf('=');
      if (i <= 0) continue;
      map.set(first.slice(0, i), first.slice(i + 1));
    }
    this.cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private ingestCsrf(res: Response) {
    const fromHeader =
      res.headers.get('X-CSRF-TOKEN') ||
      res.headers.get('x-csrf-token') ||
      res.headers.get('X-Csrf-Token');
    if (fromHeader?.trim()) this.csrf = fromHeader.trim();
  }

  private csrfFromHtml(html: string) {
    const meta =
      html.match(
        /<meta[^>]+name=["']_?csrf["'][^>]+content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']_?csrf["']/i,
      ) ||
      html.match(
        /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
      );
    if (meta?.[1]) {
      this.csrf = meta[1];
      return;
    }
    const input = html.match(
      /name=["']_csrf["'][^>]*value=["']([^"']+)["']/i,
    );
    if (input?.[1]) this.csrf = input[1];
  }
}

/**
 * Detect env mistakes: 1C paths instead of cabinet.
 */
export function explainBadWebkassaConfig(baseUrl: string): string | null {
  if (/forma\/hs|fitgo\/hs/i.test(baseUrl)) {
    return 'WEBKASSA_BASE_URL указывает на 1С, а не на кабинет Webkassa.';
  }
  return null;
}

function parseWebkassaErrorMessage(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const nested =
      j.error && typeof j.error === 'object'
        ? (j.error as Record<string, unknown>)
        : null;
    const msg = [
      nested?.errMessForClient,
      nested?.errMessageForClient,
      j.errMessForClient,
      j.errMessageForClient,
      j.message,
      typeof j.error === 'string' ? j.error : null,
    ].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return msg ? msg.slice(0, 180) : null;
  } catch {
    return null;
  }
}

function formatWebkassaHttpError(status: number, text: string): string {
  const msg = parseWebkassaErrorMessage(text);
  if (msg && /не существует|cashdocs|GET не существует/i.test(msg)) {
    return 'Адрес выгрузки Webkassa неверный (нужен POST отчёта из ЛК).';
  }
  if (msg) return msg;
  if (status === 404 || status === 405) {
    return 'Адрес выгрузки Webkassa неверный.';
  }
  if (status === 401 || status === 403) {
    return 'Webkassa: сессия истекла или нет доступа к отчёту.';
  }
  return `Выгрузка Webkassa не удалась (HTTP ${status}).`;
}
