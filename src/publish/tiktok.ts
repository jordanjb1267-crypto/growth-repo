/**
 * TikTok adapter — Content Posting API, direct post with FILE_UPLOAD.
 *
 * The honest posture: unaudited API clients are locked to SELF_ONLY viewership
 * (posts visible to nobody but the creator) and capped at 5 posting users per
 * day. This adapter defaults privacy_level to SELF_ONLY and says so in the
 * publish result. Set TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE only after
 * TikTok's audit passes — before then the API rejects it anyway.
 *
 * Single-chunk FILE_UPLOAD keeps this simple, which caps videos at 64MB (the
 * asset validator enforces it). Chunked upload can come later if a real video
 * ever exceeds that.
 */

import { readFileSync } from 'node:fs';
import { checkVideoAsset, VIDEO_CONSTRAINTS } from './assets.ts';
import { upsertEnv } from '../lib/env-file.ts';
import type { ContentItem } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const API = 'https://open.tiktokapis.com/v2';
const TITLE_LIMIT = 2200;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TikTokAdapter implements PublisherAdapter {
  readonly platform = 'TikTok' as const;
  readonly #fetch: typeof fetch;
  readonly #pollIntervalMs: number;

  constructor(options: { fetchImpl?: typeof fetch; pollIntervalMs?: number } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const missing = ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_REFRESH_TOKEN'].filter(
      (k) => !env[k],
    );
    if (missing.length > 0) {
      return { ok: false, detail: `Missing env: ${missing.join(', ')}. Run: npm run auth:tiktok` };
    }
    const privacy = env.TIKTOK_PRIVACY_LEVEL ?? 'SELF_ONLY';
    return {
      ok: true,
      detail:
        privacy === 'SELF_ONLY'
          ? 'TikTok credentials present. Posts will be SELF_ONLY (the forced level until the client audit passes — visible to nobody but the account).'
          : `TikTok credentials present. privacy_level=${privacy} — rejected by TikTok unless the client audit has passed.`,
    };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    const title = buildTitle(item);
    if (title.length > TITLE_LIMIT) return { ok: false, detail: `Caption is ${title.length} chars; cap is ${TITLE_LIMIT}.` };
    const asset = checkVideoAsset(item.asset_path, VIDEO_CONSTRAINTS.TikTok);
    if (!asset.ok) return { ok: false, detail: asset.detail };
    return { ok: true, detail: asset.detail };
  }

  /** TikTok access tokens live 24h; refresh on every publish run and persist
   *  the rotated refresh token (TikTok rotates it on each refresh). */
  async #accessToken(): Promise<string> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;
    if (!clientKey || !clientSecret || !refreshToken) throw new Error('TikTok credentials missing at publish time.');

    const response = await this.#fetch(`${API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      throw new Error(`TikTok token refresh returned ${response.status} — if this persists, re-run: npm run auth:tiktok`);
    }
    const payload = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!payload.access_token) throw new Error('TikTok token refresh returned no access_token.');

    if (payload.refresh_token && payload.refresh_token !== refreshToken) {
      upsertEnv({ TIKTOK_REFRESH_TOKEN: payload.refresh_token, TIKTOK_ACCESS_TOKEN: payload.access_token });
      process.env.TIKTOK_REFRESH_TOKEN = payload.refresh_token;
    }
    return payload.access_token;
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const asset = checkVideoAsset(item.asset_path, VIDEO_CONSTRAINTS.TikTok);
    if (!asset.ok || !asset.absolute_path) throw new Error(asset.detail);

    const accessToken = await this.#accessToken();
    const bytes = readFileSync(asset.absolute_path);
    const privacy = process.env.TIKTOK_PRIVACY_LEVEL ?? 'SELF_ONLY';

    // 1. Initialise the direct post.
    const init = await this.#fetch(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: {
          title: buildTitle(item),
          privacy_level: privacy,
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: bytes.byteLength,
          chunk_size: bytes.byteLength,
          total_chunk_count: 1,
        },
      }),
    });
    if (!init.ok) throw new Error(`TikTok post init returned ${init.status}.`);
    const initPayload = (await init.json()) as { data?: { publish_id?: string; upload_url?: string } };
    const publishId = initPayload.data?.publish_id;
    const uploadUrl = initPayload.data?.upload_url;
    if (!publishId || !uploadUrl) throw new Error('TikTok post init returned no publish_id/upload_url.');

    // 2. Upload the single chunk.
    const upload = await this.#fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
      },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`TikTok chunk upload returned ${upload.status}.`);

    // 3. Poll until processed.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const status = await this.#fetch(`${API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
      });
      if (!status.ok) throw new Error(`TikTok status fetch returned ${status.status}.`);
      const payload = (await status.json()) as { data?: { status?: string; fail_reason?: string } };

      if (payload.data?.status === 'PUBLISH_COMPLETE') break;
      if (payload.data?.status === 'FAILED') {
        throw new Error(`TikTok publish failed: ${payload.data.fail_reason ?? 'unknown reason'}.`);
      }
      if (Date.now() > deadline) throw new Error(`TikTok publish ${publishId} still processing after ${POLL_TIMEOUT_MS / 1000}s.`);
      await sleep(this.#pollIntervalMs);
    }

    if (privacy === 'SELF_ONLY') {
      console.log(`    note: TikTok post ${publishId} is SELF_ONLY — visible to nobody but the account (client-audit gate).`);
    }

    return { platform_post_id: publishId, url: null };
  }
}

function buildTitle(item: ContentItem): string {
  return [item.caption || item.hook, item.cta].filter(Boolean).join(' ').slice(0, TITLE_LIMIT);
}
