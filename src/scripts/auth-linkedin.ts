#!/usr/bin/env node
/**
 * LinkedIn OAuth bootstrap.
 *
 *   1. Create an app at https://developer.linkedin.com/ and add the
 *      self-serve "Share on LinkedIn" and "Sign In with LinkedIn using
 *      OpenID Connect" products.
 *   2. Add http://localhost:8976/callback as an authorized redirect URL.
 *   3. Put LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env.
 *   4. Run: npm run auth:linkedin  — it prints a URL, you open it, approve,
 *      and the script catches the redirect locally.
 *
 * Writes LINKEDIN_ACCESS_TOKEN and LINKEDIN_MEMBER_URN into .env (mode 600).
 * Tokens are never printed. Self-serve tokens last ~60 days; re-run this when
 * the adapter reports 401.
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { loadEnvFile, upsertEnv } from '../lib/env-file.ts';

const PORT = 8976;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'openid profile w_member_social';

loadEnvFile();

async function main(): Promise<void> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env first (from your app at developer.linkedin.com).');
    process.exit(1);
  }

  const state = randomBytes(16).toString('hex');
  const authorizeUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', SCOPE);

  console.log('');
  console.log('Open this URL in a browser and approve:');
  console.log('');
  console.log(`  ${authorizeUrl.toString()}`);
  console.log('');
  console.log(`Waiting for the redirect on ${REDIRECT_URI} …`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      const returnedState = url.searchParams.get('state');
      const returnedCode = url.searchParams.get('code');

      if (error || returnedState !== state || !returnedCode) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Authorization failed — check the terminal.');
        server.close();
        reject(new Error(error ?? 'state mismatch or missing code'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Authorized. You can close this tab.');
      server.close();
      resolve(returnedCode);
    });
    server.listen(PORT);
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 5 minutes waiting for the redirect.'));
    }, 300_000).unref();
  });

  const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Token exchange returned ${tokenResponse.status}.`);
  const token = (await tokenResponse.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error('Token exchange returned no access_token.');

  // Member URN from OpenID userinfo.
  const userinfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userinfoResponse.ok) throw new Error(`userinfo returned ${userinfoResponse.status}.`);
  const userinfo = (await userinfoResponse.json()) as { sub?: string; name?: string };
  if (!userinfo.sub) throw new Error('userinfo returned no sub.');

  const written = upsertEnv({
    LINKEDIN_ACCESS_TOKEN: token.access_token,
    LINKEDIN_MEMBER_URN: `urn:li:person:${userinfo.sub}`,
  });

  const days = token.expires_in ? Math.round(token.expires_in / 86_400) : 60;
  console.log('');
  console.log(`Authorized as ${userinfo.name ?? 'unknown'}. Wrote to .env: ${written.join(', ')} (values not shown).`);
  console.log(`Token lifetime ≈ ${days} days — re-run this command when the LinkedIn adapter reports 401.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
