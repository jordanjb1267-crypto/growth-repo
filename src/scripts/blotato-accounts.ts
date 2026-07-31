#!/usr/bin/env node
/**
 * List the social accounts connected in the Blotato dashboard, with the env
 * key each one fills. This replaces the per-platform auth:* bootstraps in the
 * standup path: connect accounts in the Blotato dashboard, run this, copy the
 * IDs into .env.
 *
 *   npm run blotato:accounts
 *
 * Account IDs are identifiers, not credentials — printing them is safe. The
 * API key itself is never printed.
 */

import { loadEnvFile } from '../lib/env-file.ts';
import { listBlotatoAccounts } from '../publish/blotato.ts';

loadEnvFile();

const ENV_KEY_BY_PLATFORM: Record<string, string> = {
  linkedin: 'BLOTATO_LINKEDIN_ACCOUNT_ID',
  facebook: 'BLOTATO_FACEBOOK_ACCOUNT_ID',
  instagram: 'BLOTATO_INSTAGRAM_ACCOUNT_ID',
  youtube: 'BLOTATO_YOUTUBE_ACCOUNT_ID',
  tiktok: 'BLOTATO_TIKTOK_ACCOUNT_ID',
};

async function main(): Promise<void> {
  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    console.error('BLOTATO_API_KEY is not set. Create the key in the Blotato dashboard (Settings → API) and add it to .env.');
    process.exitCode = 1;
    return;
  }

  const accounts = await listBlotatoAccounts(apiKey);

  console.log('');
  console.log('BLOTATO CONNECTED ACCOUNTS');
  console.log('─'.repeat(72));

  if (accounts.length === 0) {
    console.log('No accounts connected yet — connect each social account in the Blotato dashboard first.');
    console.log('');
    return;
  }

  for (const account of accounts) {
    const envKey = ENV_KEY_BY_PLATFORM[account.platform.toLowerCase()];
    const who = account.username || account.fullname || '';
    console.log(`  ${account.platform.padEnd(12)} ${String(account.id).padEnd(12)} ${who}`);
    if (envKey) console.log(`  ${''.padEnd(12)} → .env: ${envKey}=${account.id}`);
  }

  console.log('');
  console.log('Copy the IDs above into .env (Facebook also needs BLOTATO_FACEBOOK_PAGE_ID,');
  console.log('shown in the Blotato dashboard under the connected Facebook account).');
  console.log('Platforms Blotato supports but this system treats as draft-only (Reddit,');
  console.log('X/Twitter, and any others) are intentionally not wired — do not add them.');
  console.log('');
}

await main();
