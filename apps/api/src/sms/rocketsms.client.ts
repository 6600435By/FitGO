import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type RocketSmsSendResult =
  | { ok: true; id: string; status?: string }
  | { ok: false; error: string };

@Injectable()
export class RocketSmsClient {
  private readonly logger = new Logger(RocketSmsClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('ROCKETSMS_USERNAME')?.trim() &&
        this.config.get<string>('ROCKETSMS_PASSWORD')?.trim(),
    );
  }

  /**
   * POST api.rocketsms.by/simple/send (form-urlencoded).
   * Password is MD5 of cabinet password per RocketSMS docs v1.5.
   */
  async send(params: {
    phoneNormalized: string;
    text: string;
    priority?: boolean;
  }): Promise<RocketSmsSendResult> {
    const username = this.config.get<string>('ROCKETSMS_USERNAME')?.trim();
    const passwordPlain = this.config.get<string>('ROCKETSMS_PASSWORD')?.trim();
    if (!username || !passwordPlain) {
      return { ok: false, error: 'ROCKETSMS_NOT_CONFIGURED' };
    }

    const base =
      this.config.get<string>('ROCKETSMS_API_BASE')?.replace(/\/$/, '') ||
      'https://api.rocketsms.by';
    const sender = this.config.get<string>('ROCKETSMS_SENDER')?.trim();

    const body = new URLSearchParams();
    body.set('username', username);
    body.set(
      'password',
      createHash('md5').update(passwordPlain, 'utf8').digest('hex'),
    );
    body.set('phone', params.phoneNormalized.replace(/\D/g, ''));
    body.set('text', params.text);
    if (sender) body.set('sender', sender);
    if (params.priority) body.set('priority', 'true');

    try {
      const res = await fetch(`${base}/simple/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const json = (await res.json()) as {
        id?: number | string;
        status?: string;
        error?: string | number;
      };
      if (json.id != null) {
        return {
          ok: true,
          id: String(json.id),
          status: json.status ? String(json.status) : undefined,
        };
      }
      const err = json.error != null ? String(json.error) : `HTTP_${res.status}`;
      this.logger.warn(`RocketSMS send failed: ${err}`);
      return { ok: false, error: err };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'NETWORK_ERROR';
      this.logger.warn(`RocketSMS network error: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async balance(): Promise<{ credits?: number; balance?: number } | null> {
    const username = this.config.get<string>('ROCKETSMS_USERNAME')?.trim();
    const passwordPlain = this.config.get<string>('ROCKETSMS_PASSWORD')?.trim();
    if (!username || !passwordPlain) return null;
    const base =
      this.config.get<string>('ROCKETSMS_API_BASE')?.replace(/\/$/, '') ||
      'https://api.rocketsms.by';
    const qs = new URLSearchParams({
      username,
      password: createHash('md5').update(passwordPlain, 'utf8').digest('hex'),
    });
    try {
      const res = await fetch(`${base}/simple/balance?${qs.toString()}`);
      return (await res.json()) as { credits?: number; balance?: number };
    } catch {
      return null;
    }
  }
}
