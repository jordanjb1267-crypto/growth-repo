#!/usr/bin/env node
/**
 * Publish approved content through the adapters that exist.
 *
 *   npm run publish:approved              # publish (kill switches still apply)
 *   npm run publish:approved -- --dry-run # report the gate without publishing
 *
 * All adapters are wired: owned channels (Blog, Email) and the Phase 4 social
 * set (LinkedIn, Facebook Page, Instagram Reels, YouTube Shorts, TikTok).
 * Everything is gated on credentials in .env and on the kill switches, which
 * all fail closed — a wired adapter with no credentials HOLDs with the exact
 * auth command to run, it does not error the batch.
 */

import { loadEnvFile } from '../lib/env-file.ts';
import { listItemsInState } from '../lib/store.ts';
import { checkPublishAllowed } from '../lib/killswitch.ts';
import { publishItem } from '../publish/adapter.ts';
import { BlogAdapter } from '../publish/blog.ts';
import { EmailAdapter } from '../publish/email.ts';
import { LinkedInAdapter } from '../publish/linkedin.ts';
import { FacebookPageAdapter } from '../publish/facebook-page.ts';
import { InstagramAdapter } from '../publish/instagram.ts';
import { YouTubeAdapter } from '../publish/youtube.ts';
import { TikTokAdapter } from '../publish/tiktok.ts';
import type { Platform } from '../lib/types.ts';
import type { PublisherAdapter } from '../publish/adapter.ts';

loadEnvFile();

const dryRun = process.argv.includes('--dry-run');

const ADAPTERS: Partial<Record<Platform, PublisherAdapter>> = {
  Blog: new BlogAdapter(),
  Email: new EmailAdapter(),
  LinkedIn: new LinkedInAdapter(),
  'Facebook Page': new FacebookPageAdapter(),
  'Instagram Reels': new InstagramAdapter(),
  'YouTube Shorts': new YouTubeAdapter(),
  TikTok: new TikTokAdapter(),
};

async function main(): Promise<void> {
  const ready = listItemsInState('auto_publish_ready');

  console.log('');
  console.log(dryRun ? 'PRE-PUBLISH GATE (dry run)' : 'PUBLISH');
  console.log('─'.repeat(72));

  if (ready.length === 0) {
    console.log('Nothing approved and ready.');
    console.log('');
    return;
  }

  let published = 0;
  let held = 0;

  for (const item of ready) {
    const adapter = ADAPTERS[item.platform];

    if (!adapter) {
      console.log(`  ${item.id}  HOLD — no adapter for ${item.platform} (${item.platform} is draft-only; the founder posts manually).`);
      held += 1;
      continue;
    }

    if (dryRun) {
      const switches = checkPublishAllowed(item.platform);
      const auth = await adapter.validateAuth(process.env);
      const content = adapter.validateContent(item);
      const blockers = [
        item.risk_level === 'red' ? 'classified Red' : null,
        item.risk_level === 'yellow' && !item.approval ? 'yellow without approval record' : null,
        item.platform === 'Email' && !item.approval ? 'email requires approval regardless of level' : null,
        switches.allowed ? null : switches.reason,
        auth.ok ? null : `auth: ${auth.detail}`,
        content.ok ? null : `content: ${content.detail}`,
      ].filter((b): b is string => b !== null);

      if (blockers.length === 0) {
        console.log(`  ${item.id}  WOULD PUBLISH → ${item.platform}`);
        published += 1;
      } else {
        console.log(`  ${item.id}  HOLD — ${blockers.join('; ')}`);
        held += 1;
      }
      continue;
    }

    const attempt = await publishItem(item, adapter);
    if (attempt.published) {
      console.log(`  ${item.id}  PUBLISHED → ${item.platform} (${attempt.platform_post_id})`);
      published += 1;
    } else {
      console.log(`  ${item.id}  HOLD — ${attempt.reason}`);
      held += 1;
    }
  }

  console.log('');
  console.log(`${published} ${dryRun ? 'would publish' : 'published'}, ${held} held.`);
  console.log('');
}

await main();
