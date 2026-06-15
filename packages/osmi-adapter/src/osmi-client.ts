import DigestFetch from 'digest-fetch';
import type { OsmiHttpConfig } from './types';

type AuthMode = 'token' | 'digest';

function trimSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function resolveAuthMode(baseUrl: string, explicit?: string): AuthMode {
  if (explicit === 'token' || explicit === 'digest') return explicit;
  return baseUrl.includes('/v2t') ? 'token' : 'digest';
}

function digestBaseUrl(baseUrl: string): string {
  const trimmed = trimSlash(baseUrl);
  if (trimmed.endsWith('/v2t')) return trimmed.replace(/\/v2t$/, '/v2');
  if (trimmed.endsWith('/v2')) return trimmed;
  return `${trimmed}/v2`;
}

function tokenBaseUrl(baseUrl: string): string {
  const trimmed = trimSlash(baseUrl);
  if (trimmed.endsWith('/v2')) return trimmed.replace(/\/v2$/, '/v2t');
  if (trimmed.endsWith('/v2t')) return trimmed;
  return `${trimmed}/v2t`;
}

export class OsmiApiClient {
  private readonly authMode: AuthMode;
  private readonly digestBase: string;
  private readonly tokenBase: string;
  private readonly digestClient: DigestFetch;
  private token: string | null = null;

  constructor(private readonly config: OsmiHttpConfig) {
    this.authMode = resolveAuthMode(config.baseUrl, config.auth);
    this.digestBase = digestBaseUrl(config.baseUrl);
    this.tokenBase = tokenBaseUrl(config.baseUrl);
    this.digestClient = new DigestFetch(config.apiId, config.apiKey);
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const response = await fetch(`${this.tokenBase}/getToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiId: this.config.apiId,
        apiKey: this.config.apiKey,
      }),
    });

    const body = await this.readJson(response);
    if (!response.ok) {
      throw new Error(this.errorMessage(body, response.status));
    }

    const record = body as { token?: string; accessToken?: string };
    const token = record.token ?? record.accessToken ?? '';

    if (!token) {
      throw new Error('OSMI API: пустой токен доступа');
    }

    this.token = token;
    return token;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`OSMI API invalid JSON (${response.status})`);
    }
  }

  private errorMessage(body: unknown, status: number): string {
    if (body && typeof body === 'object') {
      const record = body as { RMESSAGE?: string; message?: string; error?: string };
      if (record.RMESSAGE) return record.RMESSAGE;
      if (record.message) return record.message;
      if (record.error) return record.error;
    }
    return `OSMI API error ${status}`;
  }

  async request(path: string, init?: RequestInit): Promise<unknown> {
    const url = path.startsWith('http')
      ? path
      : `${this.authMode === 'token' ? this.tokenBase : this.digestBase}${path.startsWith('/') ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    };

    if (this.authMode === 'token') {
      headers.Authorization = `Bearer ${await this.ensureToken()}`;
    }

    const response =
      this.authMode === 'digest'
        ? await this.digestClient.fetch(url, { ...init, headers })
        : await fetch(url, { ...init, headers });

    const body = await this.readJson(response);
    if (!response.ok) {
      throw new Error(this.errorMessage(body, response.status));
    }

    return body;
  }
}
