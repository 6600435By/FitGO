#!/usr/bin/env node
/**
 * Local stand-in for 1C FitGOIntegration HTTP API (dev only).
 * Real WS2016 publish: fitgo-probe docs → Apache :8445 + extension (RDP).
 *
 * FORMA_FITGO_URL=http://127.0.0.1:3045/fitgo/v1
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.FITGO_STUB_PORT ?? 3045);
const API_KEY = process.env.FORMA_API_KEY ?? '';
const BASIC = process.env.FORMA_BASIC_AUTH ?? '';

const TEST_PHONE = '375296600435';
const CLIENT = {
  externalId: '1c-client-001',
  firstName: 'Алексей',
  lastName: 'Иванов',
  phone: TEST_PHONE,
  email: 'client@demo.fitgo',
};

const MEMBERSHIP = {
  id: 'membership-stub-001',
  name: 'Безлимит (stub / pending real FitGOIntegration)',
  status: 'ACTIVE',
  visitsRemaining: undefined,
  visitsTotal: undefined,
  validFrom: '2025-06-01',
  validUntil: '2026-12-01',
  services: [
    { name: 'Групповые программы', unlimited: true },
    { name: 'Массаж классический', remaining: 2, total: 4 },
  ],
  accountBalance: 45.5,
  debtAmount: 0,
  currency: 'BYN',
  freezeAllowed: true,
  freezeDaysRemaining: 14,
  freezeDaysTotal: 14,
};

const CARD = {
  id: 'card-stub-001',
  barcode: 'FG2026001234567',
  clientName: `${CLIENT.firstName} ${CLIENT.lastName}`,
  clubName: 'Форма',
};

const VISITS = [
  {
    id: 'visit-stub-1',
    date: '2026-09-01',
    checkIn: '10:05',
    checkOut: '11:10',
    clubName: 'Форма',
    title: 'Pilates',
  },
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, { error: { code: 401, message: 'Unauthorized' } });
}

function authorize(req) {
  if (!API_KEY || !BASIC) return true; // open stub if env not loaded
  const key = req.headers.apikey;
  const auth = req.headers.authorization ?? '';
  const basicOk =
    auth === `Basic ${BASIC}` || auth === BASIC || auth === `Basic ${BASIC}`.trim();
  return key === API_KEY && basicOk;
}

function resolveClient(url) {
  const phone = (url.searchParams.get('phone') ?? '').replace(/\D/g, '');
  const externalId = url.searchParams.get('externalId') ?? '';
  if (externalId && externalId === CLIENT.externalId) return CLIENT;
  if (phone && phone.endsWith(TEST_PHONE.slice(-9))) return CLIENT;
  if (phone === TEST_PHONE) return CLIENT;
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'GET' && (path === '/fitgo/v1/health' || path === '/health')) {
    return json(res, 200, { data: { status: 'ok', stub: true } });
  }

  if (!authorize(req)) return unauthorized(res);

  const client = resolveClient(url);

  if (req.method === 'GET' && (path === '/fitgo/v1/client' || path === '/client')) {
    if (!url.searchParams.get('phone') && !url.searchParams.get('externalId')) {
      return json(res, 400, { error: { code: 400, message: 'phone or externalId required' } });
    }
    if (!client) return json(res, 404, { error: { code: 404, message: 'Client not found' } });
    return json(res, 200, { data: client });
  }

  if (req.method === 'GET' && (path === '/fitgo/v1/membership' || path === '/membership')) {
    if (!client) return json(res, 404, { error: { code: 404, message: 'Client not found' } });
    return json(res, 200, { data: MEMBERSHIP });
  }

  if (
    req.method === 'POST' &&
    (path === '/fitgo/v1/membership/freeze' || path === '/membership/freeze')
  ) {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: { code: 400, message: 'Invalid JSON body' } });
    }
    const externalId = String(body.externalId ?? '');
    const phone = String(body.phone ?? '').replace(/\D/g, '');
    const days = Number(body.days);
    const fromDate = String(body.fromDate ?? new Date().toISOString().slice(0, 10));
    const resolved =
      (externalId && externalId === CLIENT.externalId && CLIENT) ||
      (phone && (phone === TEST_PHONE || phone.endsWith(TEST_PHONE.slice(-9))) && CLIENT) ||
      null;
    if (!resolved) {
      return json(res, 404, { error: { code: 404, message: 'Client not found' } });
    }
    if (!MEMBERSHIP.freezeAllowed) {
      return json(res, 409, {
        error: { code: 409, message: 'Freeze is not available for this membership' },
      });
    }
    if (!Number.isFinite(days) || days < 1) {
      return json(res, 400, { error: { code: 400, message: 'days must be >= 1' } });
    }
    if (days > MEMBERSHIP.freezeDaysRemaining) {
      return json(res, 400, {
        error: { code: 400, message: 'days exceed freezeDaysRemaining' },
      });
    }
    if (MEMBERSHIP.status === 'FROZEN') {
      return json(res, 409, {
        error: { code: 409, message: 'Membership is already frozen' },
      });
    }
    MEMBERSHIP.freezeDaysRemaining -= days;
    MEMBERSHIP.status = 'FROZEN';
    MEMBERSHIP.frozenUntil = addDaysIso(fromDate, days);
    MEMBERSHIP.validUntil = addDaysIso(MEMBERSHIP.validUntil, days);
    return json(res, 200, { data: { ...MEMBERSHIP } });
  }

  if (req.method === 'GET' && (path === '/fitgo/v1/visits' || path === '/visits')) {
    if (!client) return json(res, 404, { error: { code: 404, message: 'Client not found' } });
    return json(res, 200, { data: VISITS });
  }

  if (req.method === 'GET' && (path === '/fitgo/v1/card' || path === '/card')) {
    if (!client) return json(res, 404, { error: { code: 404, message: 'Client not found' } });
    return json(res, 200, { data: CARD });
  }

  json(res, 404, { error: { code: 404, message: `Not found: ${path}` } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `FitGOIntegration DEV stub on http://127.0.0.1:${PORT}/fitgo/v1/health (replace with WS2016 :8445 after RDP publish)`,
  );
});
