import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** LAN hall agent auth via shared secret (not JWT). */
@Injectable()
export class HallSnapshotAgentGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('HALL_SNAPSHOT_AGENT_TOKEN')?.trim();
    if (!expected) {
      throw new UnauthorizedException(
        'HALL_SNAPSHOT_AGENT_TOKEN не задан на API',
      );
    }
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const raw =
      req.headers['x-hall-snapshot-token'] ??
      req.headers['authorization'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) throw new UnauthorizedException('Нет токена агента');
    const token = value.startsWith('Bearer ')
      ? value.slice(7).trim()
      : value.trim();
    if (token !== expected) {
      throw new UnauthorizedException('Неверный токен агента');
    }
    return true;
  }
}
