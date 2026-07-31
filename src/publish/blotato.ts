/**
 * Blotato adapter — all five social channels through one publishing backend.
 *
 * Founder directive (see CLAUDE.md addendum A9): social publishing goes
 * through Blotato rather than per-platform credentials. The founder connects
 * each social account once in the Blotato dashboard; this adapter then posts
 * through Blotato's API with a single `BLOTATO_API_KEY`. The same workspace
 * powers the Blotato MCP connector, so the founder can inspect and control
 * the posting queue conversationally from Claude while this headless path
 * uses the REST API directly.
 *
 * What this changes: no platform apps, no auth:* bootstraps, no Meta App
 * Review, and — because Blotato's platform apps are already audited — YouTube
 * uploads can be PUBLIC and TikTok posts can be PUBLIC_TO_EVERYONE from day
 * one, which the direct adapters could not honestly offer.
 *
 * What this does not change: every publish still runs behind `publishItem()`'s
 * full gate (red refused, yellow needs the founder's approval record, kill
 * switches fail closed, connector pause). Draft-only channels (Reddit,
 * Facebook Groups, X) are never wired through Blotato even though Blotato
 * supports some of them — no adapter exists for them, by design.
 *
 * API notes: media is ingested by URL (POST /v2/media), so video publishing
 * needs ASSET_BASE_URL just like the direct Instagram path did. Post creation
 * returns a `postSubmissionId`, not the platform's own post ID — attribution
 * stores it as `blotato:<id>`, and the Blotato dashboard maps submissions to
 * live posts. Rate limits: 30 posts/min, well above our daily volume.
 */

import { withUtm } from './adapter.ts';
import { assetPublicUrl, checkVideoAsset, VIDEO_CONSTRAINTS } from './assets.ts';
import type { ContentItem, Platform, Product } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const API_BASE = 'https://backend.blotato.com';
const YOUTUBE_TITLE_LIMIT = 100;

export type BlotatoPlatform = 'LinkedIn' | 'Facebook Page' | 'Instagram Reels' | 'YouTube Shorts' | 'TikTok';

const PRODUCT_URL_KEYS: Record<Product, string> = {
  'Rig Receipts': 'RIG_RECEIPTS_URL',
  'Tilawah Lock': 'TILAWAH_LOCK_URL',
};

interface PlatformConfig {
  /** Blotato's platform identifier (content.platform / target.targetType). */
  blotato: string;
  accountIdEnv: string;
  needsVideo: boolean;
  /** Text/caption ceiling; null = no practical cap worth encoding. */
  textLimit: number | null;
  extraEnv: string[];
}

const CONFIG: Record<BlotatoPlatform, PlatformConfig> = {
  LinkedIn: {
    blotato: 'linkedin',
    accountIdEnv: 'BLOTATO_LINKEDIN_ACCOUNT_ID',
    needsVideo: false,
    textLimit: 3000,
    extraEnv: [],
  },
  'Facebook Page': {
    blotato: 'facebook',
    accountIdEnv: 'BLOTATO_FACEBOOK_ACCOUNT_ID',
    needsVideo: false,
    textLimit: null,
    extraEnv: ['BLOTATO_FACEBOOK_PAGE_ID'],
  },
  'Instagram Reels': {
    blotato: 'instagram',
    accountIdEnv: 'BLOTATO_INSTAGRAM_ACCOUNT_ID',
    needsVideo: true,
    textLimit: 2200,
    extraEnv: [],
  },
  'YouTube Shorts': {
    blotato: 'youtube',
    accountIdEnv: 'BLOTATO_YOUTUBE_ACCOUNT_ID',
    needsVideo: true,
    textLimit: 5000,
    extraEnv: [],
  },
  TikTok: {
    blotato: 'tiktok',
    accountIdEnv: 'BLOTATO_TIKTOK_ACCOUNT_ID',
    needsVideo: true,
    textLimit: 2200,
    extraEnv: [],
  },
};

export class BlotatoAdapter implements PublisherAdapter {
  readonly platform: Platform;
  readonly #config: PlatformConfig;
  readonly #fetch: typeof fetch;

  constructor(platform: BlotatoPlatform, options: { fetchImpl?: typeof fetch } = {}) {
    this.platform = platform;
    this.#config = CONFIG[platform];
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    if (!env.BLOTATO_API_KEY) {
      return {
        ok: false,
        detail: 'Missing env: BLOTATO_API_KEY. Create the key in the Blotato dashboard (Settings → API) and add it to .env.',
      };
    }
    const missing = [this.#config.accountIdEnv, ...this.#config.extraEnv].filter((k) => !env[k]);
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `Missing env: ${missing.join(', ')}. Connect the account in the Blotato dashboard, then run: npm run blotato:accounts`,
      };
    }
    if (this.#config.needsVideo && !env.ASSET_BASE_URL) {
      return {
        ok: false,
        detail: 'ASSET_BASE_URL is not set. Blotato ingests media by URL — host the assets/ directory (npm run site:build) and set ASSET_BASE_URL.',
      };
    }
    return { ok: true, detail: `Blotato credentials present for ${this.platform}.` };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    const text = buildText(this.platform, item);
    if (!text.trim()) return { ok: false, detail: 'Post is empty.' };
    if (this.#config.textLimit !== null && text.length > this.#config.textLimit) {
      return { ok: false, detail: `Post is ${text.length} chars; ${this.platform} caps at ${this.#config.textLimit}.` };
    }

    if (this.platform === 'YouTube Shorts') {
      const title = buildYouTubeTitle(item);
      if (!title) return { ok: false, detail: 'No title (hook is empty).' };
      if (/[<>]/.test(title)) return { ok: false, detail: 'YouTube titles cannot contain < or >.' };
    }

    if (this.#config.needsVideo) {
      const constraints = VIDEO_CONSTRAINTS[this.platform as keyof typeof VIDEO_CONSTRAINTS];
      const asset = checkVideoAsset(item.asset_path, constraints);
      if (!asset.ok) return { ok: false, detail: asset.detail };
      return { ok: true, detail: asset.detail };
    }
    return { ok: true, detail: 'ok' };
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const apiKey = process.env.BLOTATO_API_KEY;
    const accountId = process.env[this.#config.accountIdEnv];
    if (!apiKey || !accountId) throw new Error('Blotato credentials missing at publish time.');

    const mediaUrls: string[] = [];
    if (this.#config.needsVideo) {
      const constraints = VIDEO_CONSTRAINTS[this.platform as keyof typeof VIDEO_CONSTRAINTS];
      const asset = checkVideoAsset(item.asset_path, constraints);
      if (!asset.ok || !asset.relative_to_assets) throw new Error(asset.detail);
      const publicUrl = assetPublicUrl(asset.relative_to_assets);
      if (!publicUrl) throw new Error('ASSET_BASE_URL is not set; cannot construct a public video URL.');
      mediaUrls.push(await this.#uploadMedia(apiKey, publicUrl));
    }

    const body = {
      post: {
        accountId,
        content: {
          text: buildText(this.platform, item),
          platform: this.#config.blotato,
          mediaUrls,
        },
        target: this.#buildTarget(item),
      },
    };

    const response = await this.#fetch(`${API_BASE}/v2/posts`, {
      method: 'POST',
      headers: { 'blotato-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Blotato returned ${response.status} — check BLOTATO_API_KEY and that the ${this.platform} account is still connected in the dashboard.`);
    }
    if (!response.ok) throw new Error(`Blotato /v2/posts returned ${response.status}.`);

    const payload = (await response.json()) as { postSubmissionId?: string };
    if (!payload.postSubmissionId) throw new Error('Blotato accepted the post but returned no postSubmissionId.');

    this.#logVisibility();

    // Blotato returns its own submission ID, not the platform's post ID; the
    // dashboard maps submissions to live posts. Attribution keys on this.
    return { platform_post_id: `blotato:${payload.postSubmissionId}`, url: null };
  }

  async #uploadMedia(apiKey: string, url: string): Promise<string> {
    const response = await this.#fetch(`${API_BASE}/v2/media`, {
      method: 'POST',
      headers: { 'blotato-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      throw new Error(`Blotato /v2/media returned ${response.status} — check the asset URL is publicly reachable (${url}).`);
    }
    const payload = (await response.json()) as { url?: string };
    if (!payload.url) throw new Error('Blotato media upload returned no hosted URL.');
    return payload.url;
  }

  #buildTarget(item: ContentItem): Record<string, unknown> {
    switch (this.platform) {
      case 'Facebook Page':
        return { targetType: 'facebook', pageId: process.env.BLOTATO_FACEBOOK_PAGE_ID };
      case 'YouTube Shorts':
        return {
          targetType: 'youtube',
          title: buildYouTubeTitle(item),
          privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS ?? 'public',
          shouldNotifySubscribers: false,
        };
      case 'TikTok':
        return {
          targetType: 'tiktok',
          privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL ?? 'PUBLIC_TO_EVERYONE',
          disabledComments: false,
          disabledDuet: false,
          disabledStitch: false,
          isBrandedContent: false,
          isYourBrand: false,
          // Honest disclosure: this content is model-generated.
          isAiGenerated: true,
        };
      default:
        return { targetType: this.#config.blotato };
    }
  }

  #logVisibility(): void {
    if (this.platform === 'YouTube Shorts') {
      const privacy = process.env.YOUTUBE_PRIVACY_STATUS ?? 'public';
      if (privacy !== 'public') {
        console.log(`    note: YOUTUBE_PRIVACY_STATUS=${privacy} — the upload is not visible to the audience.`);
      }
    }
    if (this.platform === 'TikTok') {
      const privacy = process.env.TIKTOK_PRIVACY_LEVEL ?? 'PUBLIC_TO_EVERYONE';
      if (privacy !== 'PUBLIC_TO_EVERYONE') {
        console.log(`    note: TIKTOK_PRIVACY_LEVEL=${privacy} — the post is not visible to the audience.`);
      }
    }
  }
}

/** Text composition mirrors the direct adapters so a backend switch does not
 *  change what the audience reads. */
function buildText(platform: Platform, item: ContentItem): string {
  const joinBlocks = (lines: (string | null)[]): string =>
    lines
      .filter((l): l is string => l !== null)
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');

  switch (platform) {
    case 'LinkedIn':
      return joinBlocks([item.hook, '', item.full_content, '', item.cta]);
    case 'Facebook Page': {
      const productUrl = process.env[PRODUCT_URL_KEYS[item.product]];
      return joinBlocks([
        item.hook,
        '',
        item.full_content,
        '',
        item.cta,
        productUrl ? '' : null,
        productUrl ? withUtm(productUrl, item.id, 'facebook') : null,
      ]);
    }
    case 'YouTube Shorts':
      return joinBlocks([item.full_content, '', item.caption, '', item.cta, '', '#Shorts']);
    default:
      // Instagram Reels and TikTok: caption-style.
      return [item.caption || item.hook, item.cta].filter(Boolean).join('\n\n');
  }
}

export function buildYouTubeTitle(item: ContentItem): string {
  return item.hook.trim().slice(0, YOUTUBE_TITLE_LIMIT);
}

export interface BlotatoAccount {
  id: string;
  platform: string;
  username?: string;
  fullname?: string;
}

/** List the accounts connected in the Blotato dashboard — the source of the
 *  BLOTATO_*_ACCOUNT_ID values. Account IDs are identifiers, not secrets. */
export async function listBlotatoAccounts(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BlotatoAccount[]> {
  const response = await fetchImpl(`${API_BASE}/v2/users/me/accounts`, {
    headers: { 'blotato-api-key': apiKey },
  });
  if (!response.ok) throw new Error(`Blotato /v2/users/me/accounts returned ${response.status}.`);
  const payload = (await response.json()) as { items?: BlotatoAccount[] };
  return payload.items ?? [];
}
