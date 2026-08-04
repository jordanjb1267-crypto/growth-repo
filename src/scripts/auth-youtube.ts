#!/usr/bin/env node
/**
 * YouTube OAuth bootstrap — Google device flow, the most headless-friendly
 * option: no redirect URL, no local server, works over SSH. You get a short
 * code to type into google.com/device on any device.
 *
 *   1. In Google Cloud Console: create a project, enable "YouTube Data API v3",
 *      configure the OAuth consent screen, and create an OAuth client of type
 *      "TVs and Limited Input devices" (that type is what enables device flow).
 *   2. Put YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env.
 *   3. Run: npm run auth:youtube
 *
 * Writes YOUTUBE_REFRESH_TOKEN to .env. Refresh tokens do not expire in
 * normal use (they die if unused ~6 months or if access is revoked).
 *
 * Visibility reminder: until the project passes Google's compliance audit,
 * uploads land PRIVATE regardless of any setting.
 */

import { loadEnvFile, upsertEnv } from '../lib/env-file.ts';

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

loadEnvFile();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.');
    console.error('The OAuth client must be type "TVs and Limited Input devices" for device flow.');
    process.exit(1);
  }

  const deviceResponse = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
  });
  if (!deviceResponse.ok) {
    throw new Error(`Device code request returned ${deviceResponse.status} — is the OAuth client type "TVs and Limited Input devices"?`);
  }
  const device = (await deviceResponse.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    interval?: number;
    expires_in: number;
  };

  console.log('');
  console.log(`On any device, open:  ${device.verification_url}`);
  console.log(`and enter the code:   ${device.user_code}`);
  console.log('');
  console.log('Waiting for approval…');

  const intervalMs = (device.interval ?? 5) * 1000;
  const deadline = Date.now() + device.expires_in * 1000;

  for (;;) {
    if (Date.now() > deadline) throw new Error('The device code expired before approval. Re-run.');
    await sleep(intervalMs);

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const payload = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };

    if (payload.error === 'authorization_pending') continue;
    if (payload.error === 'slow_down') {
      await sleep(intervalMs);
      continue;
    }
    if (payload.error) throw new Error(`Token polling returned: ${payload.error}`);
    if (!payload.refresh_token) throw new Error('Approved, but no refresh_token returned — revoke the app at myaccount.google.com/permissions and re-run.');

    const written = upsertEnv({ YOUTUBE_REFRESH_TOKEN: payload.refresh_token });
    console.log('');
    console.log(`Authorized. Wrote to .env: ${written.join(', ')} (value not shown).`);
    console.log('Reminder: uploads are PRIVATE until the project passes the YouTube compliance audit.');
    return;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
