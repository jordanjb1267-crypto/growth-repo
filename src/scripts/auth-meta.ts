#!/usr/bin/env node
/**
 * Meta (Facebook Page + Instagram) credential bootstrap.
 *
 * Standard Access covers assets you administer, so no App Review is needed for
 * your own Page — but the token chain is fiddly. This script does the chain:
 *
 *   short-lived user token  →  long-lived user token  →  Page token
 *                                                     →  IG business account id
 *
 *   1. Create an app at https://developers.facebook.com/ (type: Business).
 *   2. Put META_APP_ID and META_APP_SECRET in .env.
 *   3. Get a short-lived USER token from Graph API Explorer
 *      (https://developers.facebook.com/tools/explorer/) with permissions:
 *      pages_show_list, pages_manage_posts, pages_read_engagement,
 *      instagram_basic, instagram_content_publish.
 *   4. Run: npm run auth:meta -- <short-lived-user-token>
 *
 * Writes META_PAGE_ID, META_PAGE_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID.
 * Page tokens derived from long-lived user tokens do not expire in normal use.
 */

import { loadEnvFile, upsertEnv } from '../lib/env-file.ts';
import { graphBase } from '../publish/facebook-page.ts';

loadEnvFile();

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${graphBase()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok || payload.error) {
    throw new Error(`Graph API ${path}: ${payload.error?.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

async function main(): Promise<void> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const shortToken = process.argv[2];

  if (!appId || !appSecret) {
    console.error('Set META_APP_ID and META_APP_SECRET in .env first (from your app at developers.facebook.com).');
    process.exit(1);
  }
  if (!shortToken) {
    console.error('Usage: npm run auth:meta -- <short-lived-user-token>');
    console.error('Get the token from Graph API Explorer with: pages_show_list, pages_manage_posts,');
    console.error('pages_read_engagement, instagram_basic, instagram_content_publish.');
    process.exit(1);
  }

  // 1. Exchange for a long-lived user token (~60 days).
  console.log('Exchanging for a long-lived user token…');
  const longLived = await graphGet<{ access_token: string }>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  // 2. List Pages the user administers; their tokens ride along.
  const pages = await graphGet<{ data: { id: string; name: string; access_token: string }[] }>('me/accounts', {
    access_token: longLived.access_token,
  });
  if (pages.data.length === 0) {
    throw new Error('No Pages found — the token user must administer the product Page, and pages_show_list must be granted.');
  }

  // Non-interactive selection: exactly one page, or META_PAGE_NAME to choose.
  const wanted = process.env.META_PAGE_NAME;
  const page =
    pages.data.length === 1
      ? pages.data[0]
      : pages.data.find((p) => p.name.toLowerCase() === wanted?.toLowerCase());
  if (!page) {
    console.error(`Found ${pages.data.length} Pages: ${pages.data.map((p) => p.name).join(' · ')}`);
    console.error('Set META_PAGE_NAME in .env to the one to use, then re-run.');
    process.exit(1);
  }
  console.log(`Using Page: ${page.name}`);

  // 3. The linked Instagram business account, if any.
  const igLookup = await graphGet<{ instagram_business_account?: { id: string } }>(page.id, {
    fields: 'instagram_business_account',
    access_token: page.access_token,
  });
  const igId = igLookup.instagram_business_account?.id;

  const values: Record<string, string> = {
    META_PAGE_ID: page.id,
    META_PAGE_ACCESS_TOKEN: page.access_token,
  };
  if (igId) values.INSTAGRAM_BUSINESS_ACCOUNT_ID = igId;

  const written = upsertEnv(values);
  console.log('');
  console.log(`Wrote to .env: ${written.join(', ')} (values not shown).`);
  if (igId) {
    console.log('Instagram business account linked and recorded.');
  } else {
    console.log('NOTE: no Instagram business account is linked to this Page. Instagram Reels publishing needs');
    console.log('a BUSINESS (not Creator) Instagram account linked to the Page — link it, then re-run this.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
