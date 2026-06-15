/**
 * Quick OSMI connectivity check.
 * Usage: OSMI_API_KEY=secret node scripts/osmi-smoke.mjs
 */
import { createOsmiProvider } from '@fitgo/osmi-adapter';

const apiId = process.env.OSMI_API_ID ?? 'SIKZTFJ7JXN1675HKSHD';
const apiKey = process.env.OSMI_API_KEY ?? '';
const baseUrl = process.env.OSMI_API_BASE_URL ?? 'https://api6.osmicards.com/v2';
const auth = process.env.OSMI_AUTH;
const phone = process.env.OSMI_TEST_PHONE ?? '79998887766';

if (!apiKey) {
  console.error('Set OSMI_API_KEY to run this smoke test.');
  process.exit(1);
}

const provider = createOsmiProvider('http', {
  baseUrl,
  apiId,
  apiKey,
  programId: process.env.OSMI_PROGRAM_ID ?? '36006XCR7EE4TR',
  auth: auth === 'token' || auth === 'digest' ? auth : undefined,
  campaignName: process.env.OSMI_CAMPAIGN_NAME,
  regGroup: process.env.OSMI_REG_GROUP,
  templateName: process.env.OSMI_TEMPLATE_NAME,
});

const context = {
  firstName: process.env.OSMI_TEST_FIRST_NAME,
  lastName: process.env.OSMI_TEST_LAST_NAME,
};

console.log('OSMI smoke test', { baseUrl, apiId, auth: auth ?? 'auto', regGroup: process.env.OSMI_REG_GROUP });

try {
  const card = await provider.findCardByPhone(phone, process.env.OSMI_PROGRAM_ID ?? '', context);
  if (card) {
    console.log('Found card:', card);
  } else {
    console.log('No card for phone', phone);
  }
} catch (err) {
  console.error('OSMI error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
