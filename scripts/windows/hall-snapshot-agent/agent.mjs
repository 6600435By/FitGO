/**
 * FitGO hall snapshot agent (LAN → Dahua NVR → FitGO API).
 * Node 20+, no npm deps. Digest auth for Dahua snapshot.cgi.
 *
 * Usage:
 *   node agent.mjs C:\FitGO\hall-cameras.json
 *   set HALL_CAMERAS_CONFIG=C:\FitGO\hall-cameras.json && node agent.mjs
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const POLL_MS = 30_000;

/** @typedef {{ roomTitle: string, mode?: string, url: string, username: string, password: string, label?: string }} Camera */
/** @typedef {{ apiBase: string, agentToken: string, clubId: string, pollMs?: number, cameras: Camera[] }} Config */

function loadConfig() {
  const path =
    process.argv[2] ||
    process.env.HALL_CAMERAS_CONFIG ||
    'hall-cameras.json';
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  /** @type {Config} */
  const cfg = JSON.parse(raw);
  if (!cfg.apiBase || !cfg.agentToken || !cfg.clubId || !cfg.cameras?.length) {
    throw new Error(
      'hall-cameras.json: need apiBase, agentToken, clubId, cameras[]',
    );
  }
  cfg.apiBase = cfg.apiBase.replace(/\/$/, '');
  return { cfg, path };
}

/**
 * @param {string} wwwAuth
 * @param {string} method
 * @param {string} uriPath
 * @param {string} username
 * @param {string} password
 */
function buildDigestHeader(wwwAuth, method, uriPath, username, password) {
  const parts = {};
  for (const m of wwwAuth.matchAll(/(\w+)=(?:"([^"]+)"|([^,\s]+))/g)) {
    parts[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  const realm = parts.realm || '';
  const nonce = parts.nonce || '';
  const qop = (parts.qop || '').split(',')[0]?.trim();
  const opaque = parts.opaque;
  const algorithm = (parts.algorithm || 'MD5').toUpperCase();
  if (algorithm !== 'MD5' && algorithm !== 'MD5-SESS') {
    throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  }
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uriPath}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  let response;
  if (qop === 'auth' || qop === 'auth-int') {
    const ha1Final =
      algorithm === 'MD5-SESS' ? md5(`${ha1}:${nonce}:${cnonce}`) : ha1;
    response = md5(`${ha1Final}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }
  let header =
    `Digest username="${username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uriPath}", response="${response}"`;
  if (qop) {
    header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  }
  if (opaque) header += `, opaque="${opaque}"`;
  if (parts.algorithm) header += `, algorithm=${parts.algorithm}`;
  return header;
}

function md5(s) {
  return createHash('md5').update(s).digest('hex');
}

/**
 * @param {string} url
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Buffer>}
 */
async function digestGetJpeg(url, username, password) {
  const u = new URL(url);
  const uriPath = u.pathname + u.search;
  const first = await fetch(url, { redirect: 'manual' });
  if (first.ok) {
    const buf = Buffer.from(await first.arrayBuffer());
    if (buf.length > 100) return buf;
  }
  const www = first.headers.get('www-authenticate');
  if (!www || !/^digest/i.test(www)) {
    const body = await first.text().catch(() => '');
    throw new Error(
      `HTTP ${first.status} без Digest: ${body.slice(0, 200)}`,
    );
  }
  const auth = buildDigestHeader(www, 'GET', uriPath, username, password);
  const second = await fetch(url, {
    headers: { Authorization: auth },
  });
  if (!second.ok) {
    const body = await second.text().catch(() => '');
    throw new Error(`Digest GET ${second.status}: ${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await second.arrayBuffer());
  if (buf.length < 100) throw new Error('Ответ слишком короткий для JPEG');
  return buf;
}

/**
 * RTSP fallback via ffmpeg (must be on PATH).
 * @param {string} rtspUrl
 * @returns {Buffer}
 */
function ffmpegOneFrame(rtspUrl) {
  const out = join(tmpdir(), `fitgo-hall-${Date.now()}.jpg`);
  try {
    const r = spawnSync(
      'ffmpeg',
      [
        '-rtsp_transport',
        'tcp',
        '-y',
        '-i',
        rtspUrl,
        '-frames:v',
        '1',
        '-update',
        '1',
        out,
      ],
      { encoding: 'utf8', timeout: 20_000 },
    );
    if (r.status !== 0 || !existsSync(out)) {
      throw new Error(r.stderr?.slice(-400) || 'ffmpeg failed');
    }
    return readFileSync(out);
  } finally {
    try {
      if (existsSync(out)) unlinkSync(out);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {Camera} cam
 * @returns {Promise<Buffer>}
 */
async function capture(cam) {
  const mode = (cam.mode || 'rtsp').toLowerCase();
  if (mode === 'rtsp' || mode === 'dahua-rtsp') {
    return ffmpegOneFrame(cam.url);
  }
  // Legacy: Dahua/Hik HTTP snapshot (often empty on this club NVR — prefer rtsp)
  return digestGetJpeg(cam.url, cam.username, cam.password);
}

/**
 * @param {Config} cfg
 * @param {string} path
 * @param {Record<string, string>} [headers]
 * @param {BodyInit} [body]
 */
async function api(cfg, path, headers = {}, body) {
  const res = await fetch(`${cfg.apiBase}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'X-Hall-Snapshot-Token': cfg.agentToken,
      ...headers,
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${t.slice(0, 300)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

/**
 * @param {Config} cfg
 * @param {import('./agent.mjs').DueItem} slot
 * @param {Camera | undefined} cam
 */
async function handleSlot(cfg, slot, cam) {
  if (!cam) {
    await api(
      cfg,
      `/agent/hall-snapshots/${slot.id}/fail?clubId=${encodeURIComponent(cfg.clubId)}`,
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        errorMessage: `нет камеры для зала «${slot.roomTitle}»`,
      }),
    );
    console.warn(`[fail] ${slot.roomTitle} +${slot.offsetMin}: no camera`);
    return;
  }
  try {
    const jpeg = await capture(cam);
    await api(
      cfg,
      `/agent/hall-snapshots/${slot.id}/upload-json?clubId=${encodeURIComponent(cfg.clubId)}`,
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        jpegBase64: jpeg.toString('base64'),
        cameraLabel: cam.label || cam.roomTitle,
        cameraKey: '',
      }),
    );
    console.log(
      `[ok] ${slot.roomTitle} +${slot.offsetMin}m (${jpeg.length} bytes)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await api(
        cfg,
        `/agent/hall-snapshots/${slot.id}/fail?clubId=${encodeURIComponent(cfg.clubId)}`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ errorMessage: msg.slice(0, 500) }),
      );
    } catch (e2) {
      console.error('[fail-report]', e2);
    }
    console.error(`[fail] ${slot.roomTitle} +${slot.offsetMin}:`, msg);
  }
}

async function tick(cfg) {
  /** @type {Array<{ id: string, roomTitle: string, offsetMin: number }>} */
  const due = await api(
    cfg,
    `/agent/hall-snapshots/due?clubId=${encodeURIComponent(cfg.clubId)}`,
  );
  if (!Array.isArray(due) || due.length === 0) return;
  console.log(`[due] ${due.length} slot(s)`);
  for (const slot of due) {
    const cam = cfg.cameras.find(
      (c) =>
        c.roomTitle.trim().toLowerCase() ===
        String(slot.roomTitle).trim().toLowerCase(),
    );
    await handleSlot(cfg, slot, cam);
  }
}

async function main() {
  const { cfg, path } = loadConfig();
  console.log(
    `FitGO hall agent: config=${path} api=${cfg.apiBase} club=${cfg.clubId} cameras=${cfg.cameras.length}`,
  );
  const poll = cfg.pollMs || POLL_MS;
  const loop = async () => {
    try {
      await tick(cfg);
    } catch (err) {
      console.error('[tick]', err);
    }
  };
  await loop();
  setInterval(() => void loop(), poll);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
