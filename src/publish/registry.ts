/**
 * Adapter registry — one place that decides which adapter serves each platform.
 *
 * The default social backend is Blotato (founder directive, CLAUDE.md A9).
 * `PUBLISH_BACKEND=direct` switches back to the per-platform adapters and
 * their auth:* bootstraps; everything above the adapter layer — the publish
 * gate, kill switches, approval requirements — is identical either way.
 *
 * Draft-only channels (Reddit, Facebook Groups, X) have no entry here under
 * either backend. Blotato can post to some of them; this registry must never
 * grow those keys.
 */

import { BlogAdapter } from './blog.ts';
import { EmailAdapter } from './email.ts';
import { BlotatoAdapter } from './blotato.ts';
import { LinkedInAdapter } from './linkedin.ts';
import { FacebookPageAdapter } from './facebook-page.ts';
import { InstagramAdapter } from './instagram.ts';
import { YouTubeAdapter } from './youtube.ts';
import { TikTokAdapter } from './tiktok.ts';
import type { Platform } from '../lib/types.ts';
import type { PublisherAdapter } from './adapter.ts';

export type PublishBackendName = 'blotato' | 'direct';

export function publishBackend(env: NodeJS.ProcessEnv = process.env): PublishBackendName {
  return env.PUBLISH_BACKEND === 'direct' ? 'direct' : 'blotato';
}

export function buildAdapters(env: NodeJS.ProcessEnv = process.env): Partial<Record<Platform, PublisherAdapter>> {
  const social: Partial<Record<Platform, PublisherAdapter>> =
    publishBackend(env) === 'direct'
      ? {
          LinkedIn: new LinkedInAdapter(),
          'Facebook Page': new FacebookPageAdapter(),
          'Instagram Reels': new InstagramAdapter(),
          'YouTube Shorts': new YouTubeAdapter(),
          TikTok: new TikTokAdapter(),
        }
      : {
          LinkedIn: new BlotatoAdapter('LinkedIn'),
          'Facebook Page': new BlotatoAdapter('Facebook Page'),
          'Instagram Reels': new BlotatoAdapter('Instagram Reels'),
          'YouTube Shorts': new BlotatoAdapter('YouTube Shorts'),
          TikTok: new BlotatoAdapter('TikTok'),
        };

  return {
    Blog: new BlogAdapter(),
    Email: new EmailAdapter(),
    ...social,
  };
}
