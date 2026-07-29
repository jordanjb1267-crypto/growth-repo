#!/usr/bin/env node
/**
 * TikTok OAuth bootstrap — authorization code with PKCE, paste-code style.
 *
 * TikTok requires a registered HTTPS redirect URI (no localhost), so instead of
 * running a local server this script prints the authorize URL and you paste
 * back the `code` parameter from wherever the redirect landed. Any registered
 * redirect works, including a page that just displays its own query string.
 *
 *   1. Create an app at https://developers.tiktok.com/ with the Content
 *      Posting API product and the video.publish scope.
 *   2. Register a redirect URI and put it in .env as TIKTOK_REDIRECT_URI,
 *      along with TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.
 *   3. Run: npm run auth:tiktok — open the printed URL, approve, then paste
 *      the code from the redirect's ?code= parameter.
 *
 * Writes TIKTOK_ACCESS_TOKEN and TIKTOK_REFRESH_TOKEN to .env. The adapter
 * refreshes and rotates these automatically on every publish run.
 *
 * Reach reminder: until the client passes TikTok's audit, every post is
 * SELF_ONLY and at most 5 users can post per day.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { loadEnvFile, upsertEnv } from '../lib/env-file.ts';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const SCOPE = 'video.publish';

loadEnvFile();

async function main(): Promise<void> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) {
    console.error('Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI in .env first.');
    process.exit(1);
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_key', clientKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  console.log('');
  console.log('Open this URL and approve:');
  console.log('');
  console.log(`  ${url.toString()}`);
  console.log('');
  console.log(`After approving you land on ${redirectUri} with ?code=… in the address bar.`);

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await readline.question('Paste the code value here: ')).trim();
  readline.close();
  if (!pasted) {
    console.error('No code pasted.');
    process.exit(1);
  }
  // Codes arrive URL-encoded when copied straight from the address bar.
  const code = decodeURIComponent(pasted);

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const payload = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(`Token exchange failed: ${payload.error_description ?? payload.error ?? `HTTP ${tokenResponse.status}`}`);
  }

  const written = upsertEnv({
    TIKTOK_ACCESS_TOKEN: payload.access_token,
    TIKTOK_REFRESH_TOKEN: payload.refresh_token,
  });
  console.log('');
  console.log(`Authorized. Wrote to .env: ${written.join(', ')} (values not shown).`);
  console.log('Reach reminder: posts are SELF_ONLY until the client passes TikTok\'s audit.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
