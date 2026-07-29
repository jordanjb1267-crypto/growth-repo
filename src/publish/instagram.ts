/**
 * Instagram Reels adapter — the three-step container flow.
 *
 * Two prerequisites that fail loudly here rather than mysteriously later:
 *
 *   1. The Instagram account must be a BUSINESS account linked to the Page.
 *      Creator accounts cannot publish via the API at all — this is the most
 *      common Meta integration blocker and auth:meta checks it.
 *   2. Instagram pulls the video from a URL; it does not accept an upload. The
 *      founder must host the assets/ directory somewhere public and set
 *      ASSET_BASE_URL.
 */

import { assetPublicUrl, checkVideoAsset, VIDEO_CONSTRAINTS } from './assets.ts';
import { graphBase } from './facebook-page.ts';
import type { ContentItem } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const CAPTION_LIMIT = 2200;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InstagramAdapter implements PublisherAdapter {
  readonly platform = 'Instagram Reels' as const;
  readonly #fetch: typeof fetch;
  readonly #pollIntervalMs: number;

  constructor(options: { fetchImpl?: typeof fetch; pollIntervalMs?: number } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const missing = ['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_PAGE_ACCESS_TOKEN'].filter((k) => !env[k]);
    if (missing.length > 0) {
      return { ok: false, detail: `Missing env: ${missing.join(', ')}. Run: npm run auth:meta (requires an Instagram BUSINESS account — Creator accounts cannot publish via API).` };
    }
    if (!env.ASSET_BASE_URL) {
      return { ok: false, detail: 'ASSET_BASE_URL is not set. Instagram pulls video from a public URL — host the assets/ directory and set ASSET_BASE_URL.' };
    }
    return { ok: true, detail: 'Instagram credentials present.' };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    const caption = buildCaption(item);
    if (caption.length > CAPTION_LIMIT) {
      return { ok: false, detail: `Caption is ${caption.length} chars; Instagram caps at ${CAPTION_LIMIT}.` };
    }
    const asset = checkVideoAsset(item.asset_path, VIDEO_CONSTRAINTS['Instagram Reels']);
    if (!asset.ok) return { ok: false, detail: asset.detail };
    return { ok: true, detail: asset.detail };
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!igId || !token) throw new Error('Instagram credentials missing at publish time.');

    const asset = checkVideoAsset(item.asset_path, VIDEO_CONSTRAINTS['Instagram Reels']);
    if (!asset.ok || !asset.relative_to_assets) throw new Error(asset.detail);
    const videoUrl = assetPublicUrl(asset.relative_to_assets);
    if (!videoUrl) throw new Error('ASSET_BASE_URL is not set; cannot construct a public video URL.');

    // 1. Create the media container.
    const createBody = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: buildCaption(item),
      access_token: token,
    });
    const create = await this.#fetch(`${graphBase()}/${igId}/media`, { method: 'POST', body: createBody });
    if (!create.ok) throw new Error(`Container create returned ${create.status}.`);
    const container = (await create.json()) as { id?: string };
    if (!container.id) throw new Error('Container create returned no id.');

    // 2. Poll until Instagram has fetched and processed the video.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const status = await this.#fetch(
        `${graphBase()}/${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      );
      if (!status.ok) throw new Error(`Container status returned ${status.status}.`);
      const payload = (await status.json()) as { status_code?: string };

      if (payload.status_code === 'FINISHED') break;
      if (payload.status_code === 'ERROR') {
        throw new Error(`Instagram could not process the video (container ${container.id}) — check the hosted URL is publicly reachable and the video is 9:16 H.264/HEVC.`);
      }
      if (Date.now() > deadline) {
        throw new Error(`Container ${container.id} still not FINISHED after ${POLL_TIMEOUT_MS / 1000}s.`);
      }
      await sleep(this.#pollIntervalMs);
    }

    // 3. Publish the container.
    const publishBody = new URLSearchParams({ creation_id: container.id, access_token: token });
    const publish = await this.#fetch(`${graphBase()}/${igId}/media_publish`, { method: 'POST', body: publishBody });
    if (!publish.ok) throw new Error(`media_publish returned ${publish.status}.`);
    const media = (await publish.json()) as { id?: string };
    if (!media.id) throw new Error('media_publish returned no id.');

    return { platform_post_id: media.id, url: null };
  }
}

function buildCaption(item: ContentItem): string {
  return [item.caption || item.hook, item.cta].filter(Boolean).join('\n\n');
}
