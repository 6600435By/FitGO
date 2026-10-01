/**
 * Prove Dahua hall JPEG. CGI often returns HTTP 200 + 0 bytes on this NVR;
 * then we try RPC2 session cookie, then RTSP via ffmpeg.
 *
 *   node Prove-Snapshot.mjs --pass ***
 *   node Prove-Snapshot.mjs --pass *** --port 8080
 *   node Prove-Snapshot.mjs --pass *** --https --port 443
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return def;
}

const host = arg('--host', '192.168.1.108');
const port = arg('--port', '8080');
const user = arg('--user', 'fitgo-snap');
const pass = arg('--pass', process.env.FITGO_SNAP_PASS || '');
if (!pass) {
  console.error('Usage: node Prove-Snapshot.mjs --pass *** [--port 8080]');
  process.exit(1);
}
const outDir = arg('--out', 'D:\\fitgo-hall-probe');
const useHttps = args.includes('--https');

const base = useHttps
  ? `https://${host}${port === '443' ? '' : ':' + port}`
  : `http://${host}${port === '80' ? '' : ':' + port}`;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function md5(s) {
  return createHash('md5').update(s).digest('hex');
}

function buildDigestHeader(wwwAuth, method, uriPath, username, password) {
  const parts = {};
  for (const m of wwwAuth.matchAll(/(\w+)=(?:"([^"]+)"|([^,\s]+))/g)) {
    parts[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  const realm = parts.realm || '';
  const nonce = parts.nonce || '';
  const qop = (parts.qop || '').split(',')[0]?.trim();
  const opaque = parts.opaque;
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uriPath}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const response =
    qop === 'auth' || qop === 'auth-int'
      ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : md5(`${ha1}:${nonce}:${ha2}`);
  let header =
    `Digest username="${username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uriPath}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) header += `, opaque="${opaque}"`;
  return header;
}

function isJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

async function digestGet(url, extraHeaders = {}) {
  const u = new URL(url);
  const uriPath = u.pathname + u.search;
  const first = await fetch(url, { redirect: 'manual', headers: extraHeaders });
  const www = first.headers.get('www-authenticate');
  if (first.ok) {
    return {
      status: first.status,
      buf: Buffer.from(await first.arrayBuffer()),
      via: 'plain',
    };
  }
  if (!www || !/^digest/i.test(www)) {
    return {
      status: first.status,
      buf: Buffer.from(await first.text().catch(() => '')),
      via: 'no-digest',
    };
  }
  const auth = buildDigestHeader(www, 'GET', uriPath, user, pass);
  const second = await fetch(url, {
    headers: { ...extraHeaders, Authorization: auth },
  });
  return {
    status: second.status,
    buf: Buffer.from(await second.arrayBuffer()),
    via: 'digest',
  };
}

async function rpc2Login() {
  const url = `${base}/RPC2_Login`;
  const r1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      method: 'global.login',
      params: {
        userName: user,
        password: '',
        clientType: 'Web3.0',
        loginType: 'Direct',
      },
      id: 1,
    }),
  });
  const j1 = await r1.json();
  const realm = j1?.params?.realm;
  const random = j1?.params?.random;
  const session = j1?.session;
  if (!realm || !random || session == null) {
    console.log('  RPC2 first login unexpected:', JSON.stringify(j1).slice(0, 300));
    return null;
  }
  const pwd = md5(`${user}:${random}:${md5(`${user}:${realm}:${pass}`)}`);
  const r2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      method: 'global.login',
      params: {
        userName: user,
        password: pwd,
        clientType: 'Web3.0',
        loginType: 'Direct',
        authorityType: 'Default',
      },
      id: 2,
      session,
    }),
  });
  const j2 = await r2.json();
  if (!j2?.result) {
    console.log('  RPC2 login failed:', JSON.stringify(j2).slice(0, 300));
    return null;
  }
  console.log(`  RPC2 login OK session=${j2.session ?? session}`);
  return String(j2.session ?? session);
}

async function tryCgi(channel, cookie) {
  const urls = [
    `${base}/cgi-bin/snapshot.cgi?channel=${channel}`,
    `${base}/cgi-bin/snapshot.cgi?channel=${channel}&subtype=0`,
    `${base}/cgi-bin/snapshot.cgi?channel=${channel}&type=0`,
    `${base}/cgi-bin/snapshot.cgi?channel=${channel}&stream=0`,
  ];
  const headers = cookie
    ? {
        Cookie: `DhWebClientSessionID=${cookie}; DWebClientSessionID=${cookie}`,
      }
    : {};
  for (const url of urls) {
    process.stdout.write(
      `GET ${url}${cookie ? ' (+RPC2 cookie)' : ''}\n`,
    );
    try {
      const { status, buf, via } = await digestGet(url, headers);
      console.log(
        `  HTTP ${status} via=${via} bytes=${buf.length} jpeg=${isJpeg(buf)}`,
      );
      if (isJpeg(buf)) return buf;
    } catch (e) {
      console.log(`  ERR ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function tryRtsp(channel) {
  const paths = [
    `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:554/cam/realmonitor?channel=${channel}&subtype=0`,
    `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:554/cam/realmonitor?channel=${channel}&subtype=1`,
  ];
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (ffmpeg.error || (ffmpeg.status !== 0 && ffmpeg.status !== null)) {
    console.log(
      '  ffmpeg not found — install essentials build, add to PATH, reopen PowerShell',
    );
    console.log('  https://www.gyan.dev/ffmpeg/builds/');
    return null;
  }
  for (const rtsp of paths) {
    const out = join(tmpdir(), `fitgo-rtsp-${channel}-${Date.now()}.jpg`);
    console.log(`RTSP ${rtsp.replace(pass, '***')}`);
    const r = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-rtsp_transport',
        'tcp',
        '-y',
        '-i',
        rtsp,
        '-frames:v',
        '1',
        out,
      ],
      { encoding: 'utf8', timeout: 25000 },
    );
    if (existsSync(out)) {
      const buf = readFileSync(out);
      try {
        unlinkSync(out);
      } catch {
        /* ignore */
      }
      if (isJpeg(buf)) {
        console.log(`  RTSP OK bytes=${buf.length}`);
        return buf;
      }
    }
    console.log(`  RTSP fail: ${(r.stderr || '').toString().slice(-250)}`);
  }
  return null;
}

async function captureChannel(channel) {
  console.log(`\n=== channel ${channel} ===`);
  let buf = await tryCgi(channel, null);
  if (isJpeg(buf)) return { buf, mode: 'dahua-http' };

  console.log('CGI empty — RPC2 login + cookie retry...');
  const session = await rpc2Login();
  if (session) {
    buf = await tryCgi(channel, session);
    if (isJpeg(buf)) return { buf, mode: 'dahua-http+rpc2' };
  }

  console.log('CGI still empty — RTSP/ffmpeg...');
  buf = tryRtsp(channel);
  if (isJpeg(buf)) return { buf, mode: 'rtsp' };
  return { buf: null, mode: null };
}

mkdirSync(outDir, { recursive: true });
console.log(`NVR ${base} user=${user} out=${outDir}`);

const pairs = [
  { ch: 12, file: 'd12-big-hall.jpg' },
  { ch: 6, file: 'd6-small-hall.jpg' },
];

let ok = 0;
const usedModes = new Set();
for (const p of pairs) {
  const { buf, mode } = await captureChannel(p.ch);
  if (isJpeg(buf)) {
    const path = join(outDir, p.file);
    writeFileSync(path, buf);
    console.log(`SAVED ${path} mode=${mode}`);
    ok++;
    usedModes.add(mode);
  } else {
    console.log(`FAIL channel ${p.ch}`);
  }
}

console.log(`\nDone: ${ok}/${pairs.length}`);
if (ok === 0) {
  console.log('Next:');
  console.log('  1) Snapshot Enable on D6 AND D12 + Save');
  console.log('  2) fitgo-snap Monitor rights on 6 and 12');
  console.log('  3) Install ffmpeg; allow TCP 554; retry');
  console.log('  4) Browser: ' + base + '/cgi-bin/snapshot.cgi?channel=12');
  process.exit(1);
}

if (usedModes.has('rtsp')) {
  console.log('');
  console.log('Use RTSP in C:\\FitGO\\hall-cameras.json:');
  console.log('  "mode": "rtsp",');
  console.log(
    `  "url": "rtsp://fitgo-snap:***@${host}:554/cam/realmonitor?channel=12&subtype=0"`,
  );
}
