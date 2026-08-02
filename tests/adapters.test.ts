import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import { LinkedInAdapter } from '../src/publish/linkedin.ts';
import { FacebookPageAdapter } from '../src/publish/facebook-page.ts';
import { InstagramAdapter } from '../src/publish/instagram.ts';
import { YouTubeAdapter } from '../src/publish/youtube.ts';
import { TikTokAdapter } from '../src/publish/tiktok.ts';
import { checkVideoAsset, VIDEO_CONSTRAINTS } from '../src/publish/assets.ts';
import { upsertEnv } from '../src/lib/env-file.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { installAssetFixture, removeAssetFixture } from './media-fixtures.ts';
import { draftItem } from './helpers.ts';
import type { ContentItem } from '../src/lib/types.ts';

/** Fake fetch that records every request and replays scripted responses. */
function fakeFetch(script: { status?: number; json?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const step = script.shift() ?? { status: 200, json: {} };
    return new Response(JSON.stringify(step.json ?? {}), {
      status: step.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(step.headers ?? {}) },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const ENV_KEYS = [
  'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_MEMBER_URN',
  'META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID', 'ASSET_BASE_URL',
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_REFRESH_TOKEN',
  'RIG_RECEIPTS_URL',
];
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// Genuine 9:16 media, so the adapters exercise the real ffprobe success path
// rather than the probe-failure branch a filler file would take.
const FIXTURE_RELATIVE = installAssetFixture('validVertical', 'rig-receipts/videos/test-fixture.mp4');
const FIXTURE_BYTES = statSync(join(REPO_ROOT, 'assets', FIXTURE_RELATIVE)).size;
after(() => removeAssetFixture(FIXTURE_RELATIVE));

function videoItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return draftItem({
    id: 'RR-IG-2026-01-01-001',
    product: 'Rig Receipts',
    status: 'auto_publish_ready',
    hook: 'A hook',
    full_content: 'The body of the post.',
    caption: 'A caption',
    cta: 'A CTA',
    asset_path: 'rig-receipts/videos/test-fixture.mp4',
    ...overrides,
  });
}

describe('asset validation', () => {
  it('accepts the fixture and reports its assets-relative path', () => {
    const check = checkVideoAsset('rig-receipts/videos/test-fixture.mp4', VIDEO_CONSTRAINTS.TikTok);
    assert.ok(check.ok, check.detail);
    assert.equal(check.relative_to_assets, 'rig-receipts/videos/test-fixture.mp4');
    // Proof the probe genuinely ran: measured duration and dimensions are
    // reported, which the old filler-byte fixture could never produce.
    assert.match(check.detail, /5s, 144x256 \(ratio 0\.563, vertical\)/);
    assert.equal(check.probe_failure, null);
  });

  it('refuses missing files, traversal, and wrong extensions', () => {
    assert.ok(!checkVideoAsset('rig-receipts/videos/nope.mp4', VIDEO_CONSTRAINTS.TikTok).ok);
    assert.ok(!checkVideoAsset('../CLAUDE.md', VIDEO_CONSTRAINTS.TikTok).ok);
    assert.ok(!checkVideoAsset(null, VIDEO_CONSTRAINTS.TikTok).ok);
  });
});

describe('LinkedIn adapter', () => {
  it('fails auth without credentials, with the auth command in the reason', async () => {
    const adapter = new LinkedInAdapter();
    const result = await adapter.validateAuth({});
    assert.equal(result.ok, false);
    assert.match(result.detail, /auth:linkedin/);
  });

  it('posts with the versioned headers and reads the URN from x-restli-id', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'test-token';
    process.env.LINKEDIN_MEMBER_URN = 'urn:li:person:abc';

    const { impl, calls } = fakeFetch([{ status: 201, json: {}, headers: { 'x-restli-id': 'urn:li:share:123' } }]);
    const adapter = new LinkedInAdapter({ fetchImpl: impl });

    const item = videoItem({ platform: 'LinkedIn', asset_path: null });
    assert.ok(adapter.validateContent(item).ok);

    const output = await adapter.publish(item);
    assert.equal(output.platform_post_id, 'urn:li:share:123');

    const call = calls[0];
    assert.ok(call);
    assert.match(call.url, /api\.linkedin\.com\/rest\/posts/);
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers['X-Restli-Protocol-Version'], '2.0.0');
    assert.ok(headers['LinkedIn-Version']);
    const body = JSON.parse(String(call.init?.body)) as { author: string; lifecycleState: string };
    assert.equal(body.author, 'urn:li:person:abc');
    assert.equal(body.lifecycleState, 'PUBLISHED');
  });

  it('rejects over-limit commentary', () => {
    const adapter = new LinkedInAdapter();
    const item = videoItem({ platform: 'LinkedIn', full_content: 'x'.repeat(3100), asset_path: null });
    assert.equal(adapter.validateContent(item).ok, false);
  });
});

describe('Facebook Page adapter', () => {
  it('posts to /{page}/feed with a UTM link', async () => {
    process.env.META_PAGE_ID = 'page123';
    process.env.META_PAGE_ACCESS_TOKEN = 'page-token';
    process.env.RIG_RECEIPTS_URL = 'https://rigreceipts.example.com';

    const { impl, calls } = fakeFetch([{ json: { id: 'page123_456' } }]);
    const adapter = new FacebookPageAdapter({ fetchImpl: impl });
    const output = await adapter.publish(videoItem({ platform: 'Facebook Page', asset_path: null }));

    assert.equal(output.platform_post_id, 'page123_456');
    const call = calls[0];
    assert.ok(call);
    assert.match(call.url, /graph\.facebook\.com\/v\d+\.\d+\/page123\/feed/);
    const body = call.init?.body as URLSearchParams;
    assert.match(body.get('link') ?? '', /utm_campaign=RR-IG-2026-01-01-001/);
  });
});

describe('Instagram adapter', () => {
  it('fails auth without ASSET_BASE_URL even with credentials', async () => {
    const adapter = new InstagramAdapter();
    const result = await adapter.validateAuth({
      INSTAGRAM_BUSINESS_ACCOUNT_ID: 'ig1',
      META_PAGE_ACCESS_TOKEN: 't',
    } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.match(result.detail, /ASSET_BASE_URL/);
  });

  it('runs the container flow: create, poll to FINISHED, publish', async () => {
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = 'ig1';
    process.env.META_PAGE_ACCESS_TOKEN = 'page-token';
    process.env.ASSET_BASE_URL = 'https://assets.example.com';

    const { impl, calls } = fakeFetch([
      { json: { id: 'container1' } },
      { json: { status_code: 'IN_PROGRESS' } },
      { json: { status_code: 'FINISHED' } },
      { json: { id: 'media9' } },
    ]);
    const adapter = new InstagramAdapter({ fetchImpl: impl, pollIntervalMs: 1 });
    const output = await adapter.publish(videoItem());

    assert.equal(output.platform_post_id, 'media9');
    assert.equal(calls.length, 4);
    assert.match(calls[0]?.url ?? '', /\/ig1\/media$/);
    const createBody = calls[0]?.init?.body as URLSearchParams;
    assert.equal(createBody.get('media_type'), 'REELS');
    assert.match(createBody.get('video_url') ?? '', /^https:\/\/assets\.example\.com\/rig-receipts\/videos\/test-fixture\.mp4$/);
    assert.match(calls[3]?.url ?? '', /media_publish$/);
  });

  it('surfaces a processing error with the container id', async () => {
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = 'ig1';
    process.env.META_PAGE_ACCESS_TOKEN = 'page-token';
    process.env.ASSET_BASE_URL = 'https://assets.example.com';

    const { impl } = fakeFetch([{ json: { id: 'container1' } }, { json: { status_code: 'ERROR' } }]);
    const adapter = new InstagramAdapter({ fetchImpl: impl, pollIntervalMs: 1 });
    await assert.rejects(() => adapter.publish(videoItem()), /container container1/);
  });
});

describe('YouTube adapter', () => {
  it('defaults to private and says so in auth detail', async () => {
    const adapter = new YouTubeAdapter();
    const result = await adapter.validateAuth({
      YOUTUBE_CLIENT_ID: 'a',
      YOUTUBE_CLIENT_SECRET: 'b',
      YOUTUBE_REFRESH_TOKEN: 'c',
    } as NodeJS.ProcessEnv);
    assert.ok(result.ok);
    assert.match(result.detail, /PRIVATE/);
  });

  it('refreshes the token, opens a resumable session, uploads', async () => {
    process.env.YOUTUBE_CLIENT_ID = 'cid';
    process.env.YOUTUBE_CLIENT_SECRET = 'sec';
    process.env.YOUTUBE_REFRESH_TOKEN = 'ref';

    const { impl, calls } = fakeFetch([
      { json: { access_token: 'at' } },
      { status: 200, json: {}, headers: { location: 'https://upload.example/session1' } },
      { json: { id: 'vid42', status: { privacyStatus: 'private' } } },
    ]);
    const adapter = new YouTubeAdapter({ fetchImpl: impl });
    const output = await adapter.publish(videoItem({ platform: 'YouTube Shorts' }));

    assert.equal(output.platform_post_id, 'vid42');
    assert.match(calls[0]?.url ?? '', /oauth2\.googleapis\.com\/token/);
    assert.match(calls[1]?.url ?? '', /upload\/youtube\/v3\/videos\?uploadType=resumable/);
    assert.equal(calls[2]?.url, 'https://upload.example/session1');
    const metadata = JSON.parse(String(calls[1]?.init?.body)) as { status: { privacyStatus: string } };
    assert.equal(metadata.status.privacyStatus, 'private');
  });

  it('rejects titles containing angle brackets', () => {
    const adapter = new YouTubeAdapter();
    const item = videoItem({ platform: 'YouTube Shorts', hook: 'Costs < revenue?' });
    assert.equal(adapter.validateContent(item).ok, false);
  });
});

describe('TikTok adapter', () => {
  it('defaults to SELF_ONLY and says so in auth detail', async () => {
    const adapter = new TikTokAdapter();
    const result = await adapter.validateAuth({
      TIKTOK_CLIENT_KEY: 'a',
      TIKTOK_CLIENT_SECRET: 'b',
      TIKTOK_ACCESS_TOKEN: 'c',
      TIKTOK_REFRESH_TOKEN: 'd',
    } as NodeJS.ProcessEnv);
    assert.ok(result.ok);
    assert.match(result.detail, /SELF_ONLY/);
  });

  it('refreshes, inits with SELF_ONLY, uploads the single chunk, polls to complete', async () => {
    process.env.TIKTOK_CLIENT_KEY = 'ck';
    process.env.TIKTOK_CLIENT_SECRET = 'cs';
    process.env.TIKTOK_ACCESS_TOKEN = 'at';
    process.env.TIKTOK_REFRESH_TOKEN = 'rt';

    const { impl, calls } = fakeFetch([
      { json: { access_token: 'fresh', refresh_token: 'rt' } },
      { json: { data: { publish_id: 'pub1', upload_url: 'https://upload.tiktok.example/u1' } } },
      { status: 201, json: {} },
      { json: { data: { status: 'PROCESSING' } } },
      { json: { data: { status: 'PUBLISH_COMPLETE' } } },
    ]);
    const adapter = new TikTokAdapter({ fetchImpl: impl, pollIntervalMs: 1 });
    const output = await adapter.publish(videoItem({ platform: 'TikTok' }));

    assert.equal(output.platform_post_id, 'pub1');
    const initBody = JSON.parse(String(calls[1]?.init?.body)) as {
      post_info: { privacy_level: string };
      source_info: { source: string; total_chunk_count: number };
    };
    assert.equal(initBody.post_info.privacy_level, 'SELF_ONLY');
    assert.equal(initBody.source_info.source, 'FILE_UPLOAD');
    assert.equal(initBody.source_info.total_chunk_count, 1);
    const uploadHeaders = calls[2]?.init?.headers as Record<string, string>;
    assert.equal(uploadHeaders['Content-Range'], `bytes 0-${FIXTURE_BYTES - 1}/${FIXTURE_BYTES}`);
  });
});

describe('env upsert', () => {
  it('refuses malformed keys and multi-line values', () => {
    assert.throws(() => upsertEnv({ 'bad-key': 'x' }));
    assert.throws(() => upsertEnv({ GOOD_KEY: 'line1\nline2' }));
  });
});
