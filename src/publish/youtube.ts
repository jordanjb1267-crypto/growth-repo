/**
 * YouTube Shorts adapter — resumable upload via the Data API.
 *
 * The honest posture on visibility: API projects created after 2020-07-28
 * that have not passed Google's compliance audit can only upload PRIVATE
 * videos, and the upload SUCCEEDS silently — the video simply is not visible.
 * This adapter therefore defaults privacyStatus to "private" and says so in
 * the publish result, rather than pretending an invisible upload was a public
 * post. Set YOUTUBE_PRIVACY_STATUS=public only after the audit passes.
 */

import { readFileSync } from 'node:fs';
import { checkVideoAsset, VIDEO_CONSTRAINTS } from './assets.ts';
import type { ContentItem } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 5000;

export class YouTubeAdapter implements PublisherAdapter {
  readonly platform = 'YouTube Shorts' as const;
  readonly #fetch: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const missing = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'].filter((k) => !env[k]);
    if (missing.length > 0) {
      return { ok: false, detail: `Missing env: ${missing.join(', ')}. Run: npm run auth:youtube` };
    }
    const privacy = env.YOUTUBE_PRIVACY_STATUS ?? 'private';
    return {
      ok: true,
      detail:
        privacy === 'private'
          ? 'YouTube credentials present. Uploads will be PRIVATE (the default until the compliance audit passes — unaudited projects cannot make public uploads regardless of this setting).'
          : `YouTube credentials present. privacyStatus=${privacy} — only honoured if the project has passed the compliance audit.`,
    };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    const title = buildTitle(item);
    if (!title) return { ok: false, detail: 'No title (hook is empty).' };
    if (/[<>]/.test(title)) return { ok: false, detail: 'YouTube titles cannot contain < or >.' };
    if (title.length > TITLE_LIMIT) return { ok: false, detail: `Title is ${title.length} chars; cap is ${TITLE_LIMIT}.` };

    const description = buildDescription(item);
    if (description.length > DESCRIPTION_LIMIT) {
      return { ok: false, detail: `Description is ${description.length} chars; cap is ${DESCRIPTION_LIMIT}.` };
    }

    const asset = checkVideoAsset(item.asset_path, VIDEO_CONSTRAINTS['YouTube Shorts']);
    if (!asset.ok) return { ok: false, detail: asset.detail };
    return { ok: true, detail: asset.detail };
  }

  async #accessToken(): Promise<string> {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) throw new Error('YouTube credentials missing at publish time.');

    const response = await this.#fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) {
      throw new Error(`Google token refresh returned ${response.status} — if this persists, re-run: npm run auth:youtube`);
    }
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) throw new Error('Google token refresh returned no access_token.');
    return payload.access_token;
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const asset = checkVideoAsset(item.asset_path, VIDEO_CONSTRAINTS['YouTube Shorts']);
    if (!asset.ok || !asset.absolute_path) throw new Error(asset.detail);

    const accessToken = await this.#accessToken();
    const privacy = process.env.YOUTUBE_PRIVACY_STATUS ?? 'private';

    // 1. Open a resumable upload session with the metadata.
    const open = await this.#fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          title: buildTitle(item),
          description: buildDescription(item),
          categoryId: '22',
        },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    });
    if (!open.ok) throw new Error(`Upload session open returned ${open.status}.`);
    const location = open.headers.get('location');
    if (!location) throw new Error('Upload session opened but no Location header returned.');

    // 2. Send the bytes.
    const bytes = readFileSync(asset.absolute_path);
    const upload = await this.#fetch(location, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/*' },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`Video upload returned ${upload.status}.`);

    const video = (await upload.json()) as { id?: string; status?: { privacyStatus?: string } };
    if (!video.id) throw new Error('Upload succeeded but no video id returned.');

    const actualPrivacy = video.status?.privacyStatus ?? privacy;
    if (actualPrivacy !== 'public') {
      // Truthful log line: uploaded is not the same as visible.
      console.log(`    note: video ${video.id} is ${actualPrivacy.toUpperCase()} — it is not visible to the audience (compliance-audit gate).`);
    }

    return { platform_post_id: video.id, url: `https://www.youtube.com/watch?v=${video.id}` };
  }
}

function buildTitle(item: ContentItem): string {
  return item.hook.trim().slice(0, TITLE_LIMIT);
}

function buildDescription(item: ContentItem): string {
  return [item.full_content, '', item.caption, '', item.cta, '', '#Shorts']
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}
