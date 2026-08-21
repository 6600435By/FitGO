#!/usr/bin/env node
/**
 * Smoke test 1C FitGO HTTP services (client + analytics).
 * Env: FORMA_FITGO_URL, FORMA_ANALYTICS_URL, FORMA_API_KEY, FORMA_BASIC_AUTH
 * Optional: FORMA_TEST_PHONE (default 375296600435)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FitgoHttpProvider } from '../src/fitgo-http-provider.js';
import { FitgoAnalyticsHttpProvider } from '../src/analytics-http-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiEnv = resolve(__dirname, '../../../apps/api/.env');
if (existsSync(apiEnv)) {
  for (const line of readFileSync(apiEnv, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

const phone = process.env.FORMA_TEST_PHONE ?? '375296600435';
const apiKey = process.env.FORMA_API_KEY ?? '';
const basicAuth = process.env.FORMA_BASIC_AUTH ?? '';
const fitgoUrl = process.env.FORMA_FITGO_URL ?? '';
const analyticsUrl = process.env.FORMA_ANALYTICS_URL ?? '';

if (!apiKey || !basicAuth) {
  console.error('Set FORMA_API_KEY and FORMA_BASIC_AUTH');
  process.exit(1);
}

const cfg = { apiKey, basicAuth };

async function check(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    return ok;
  } catch (e) {
    console.log(`ERR   ${name}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

let passed = 0;
let total = 0;

async function run() {
  if (fitgoUrl) {
    const client = new FitgoHttpProvider({ baseUrl: fitgoUrl, ...cfg });
    total++;
    if (await check('FitGOIntegration /health', () => client.healthCheck())) passed++;

    total++;
    if (
      await check(`FitGOIntegration /client?phone=${phone}`, async () => {
        const data = await client.getClientByPhone(phone);
        return Boolean(data?.phone);
      })
    ) {
      passed++;
    }
  } else {
    console.log('SKIP  FORMA_FITGO_URL not set');
  }

  if (analyticsUrl) {
    const analytics = new FitgoAnalyticsHttpProvider({ baseUrl: analyticsUrl, ...cfg });
    total++;
    if (await check('FitGOAnalytics /health', () => analytics.healthCheck())) passed++;
  } else {
    console.log('SKIP  FORMA_ANALYTICS_URL not set');
  }

  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total && total > 0 ? 0 : 1);
}

run();
