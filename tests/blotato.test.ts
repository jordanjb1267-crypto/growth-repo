import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import { BlotatoAdapter } from '../src/publish/blotato.ts';
import { buildAdapters, publishBackend } from '../src/publish/registry.ts';
import { LinkedInAdapter } from '../src/publish/linkedin.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { draftItem } from './helpers.ts';
import type { ContentItem } from '../src/lib/types.ts';

function fakeFetch(script: { status?: number; json?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const step = script.shift() ?? { status: 200, json: {} };
    return new Response(JSON.stringify(step.json ?? {}), {
      status: step.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const ENV_KEYS = [
  'PUBLISH_BACKEND', 'BLOTATO_API_KEY',
  'BLOTATO_LINKEDIN_ACCOUNT_ID', 'BLOTATO_FACEBOOK_ACCOUNT_ID', 'BLOTATO_FACEBOOK_PAGE_ID',
  'BLOTATO_INSTAGRAM_ACCOUNT_ID', 'BLOTATO_YOUTUBE_ACCOUNT_ID', 'BLOTATO_TIKTOK_ACCOUNT_ID',
  'ASSET_BASE_URL', 'YOUTUBE_PRIVACY_STATUS', 'TIKTOK_PRIVACY_LEVEL', 'RIG_RECEIPTS_URL',
];
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// Own fixture file — adapters.test.ts manages its own and test files can run
// concurrently, so the two must not share a path.
const FIXTURE_DIR = join(REPO_ROOT, 'assets', 'rig-receipts', 'videos');
const FIXTURE = join(FIXTURE_DIR, 'test-fixture-blotato.mp4');
mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(FIXTURE, Buffer.alloc(2048, 1));
after(() => rmSync(FIXTURE, { force: true }));

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return draftItem({
    id: 'RR-IG-2026-01-01-001',
    product: 'Rig Receipts',
    status: 'auto_publish_ready',
    hook: 'A hook',
    full_content: 'The body of the post.',
    caption: 'A caption',
    cta: 'A CTA',
    asset_path: 'rig-receipts/videos/test-fixture-blotato.mp4',
    ...overrides,
  });
}

function setBlotatoEnv(): void {
  process.env.BLOTATO_API_KEY = 'test-key';
  process.env.BLOTATO_LINKEDIN_ACCOUNT_ID = 'acc-li';
  process.env.BLOTATO_FACEBOOK_ACCOUNT_ID = 'acc-fb';
  process.env.BLOTATO_FACEBOOK_PAGE_ID = 'page-1';
  process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID = 'acc-ig';
  process.env.BLOTATO_YOUTUBE_ACCOUNT_ID = 'acc-yt';
  process.env.BLOTATO_TIKTOK_ACCOUNT_ID = 'acc-tt';
  process.env.ASSET_BASE_URL = 'https://assets.example.com';
}

describe('Blotato auth validation', () => {
  it('fails without the API key, naming it', async () => {
    const result = await new BlotatoAdapter('LinkedIn').validateAuth({} as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.match(result.detail, /BLOTATO_API_KEY/);
  });

  it('fails without the platform account ID, pointing at blotato:accounts', async () => {
    const result = await new BlotatoAdapter('LinkedIn').validateAuth({ BLOTATO_API_KEY: 'k' } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.match(result.detail, /BLOTATO_LINKEDIN_ACCOUNT_ID/);
    assert.match(result.detail, /blotato:accounts/);
  });

  it('Facebook additionally requires the page ID', async () => {
    const result = await new BlotatoAdapter('Facebook Page').validateAuth({
      BLOTATO_API_KEY: 'k',
      BLOTATO_FACEBOOK_ACCOUNT_ID: 'acc',
    } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.match(result.detail, /BLOTATO_FACEBOOK_PAGE_ID/);
  });

  it('video platforms require ASSET_BASE_URL even with credentials', async () => {
    const result = await new BlotatoAdapter('TikTok').validateAuth({
      BLOTATO_API_KEY: 'k',
      BLOTATO_TIKTOK_ACCOUNT_ID: 'acc',
    } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false);
    assert.match(result.detail, /ASSET_BASE_URL/);
  });
});

describe('Blotato publishing', () => {
  it('posts LinkedIn text with the api-key header and returns blotato:<submission>', async () => {
    setBlotatoEnv();
    const { impl, calls } = fakeFetch([{ json: { postSubmissionId: 'sub-123' } }]);
    const adapter = new BlotatoAdapter('LinkedIn', { fetchImpl: impl });

    const post = item({ platform: 'LinkedIn', asset_path: null });
    assert.ok(adapter.validateContent(post).ok);
    const output = await adapter.publish(post);

    assert.equal(output.platform_post_id, 'blotato:sub-123');
    assert.equal(calls.length, 1, 'text platforms need no media upload');
    const call = calls[0];
    assert.ok(call);
    assert.match(call.url, /backend\.blotato\.com\/v2\/posts$/);
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers['blotato-api-key'], 'test-key');
    const body = JSON.parse(String(call.init?.body)) as {
      post: { accountId: string; content: { platform: string; text: string; mediaUrls: string[] }; target: { targetType: string } };
    };
    assert.equal(body.post.accountId, 'acc-li');
    assert.equal(body.post.content.platform, 'linkedin');
    assert.equal(body.post.target.targetType, 'linkedin');
    assert.match(body.post.content.text, /A hook/);
    assert.deepEqual(body.post.content.mediaUrls, []);
  });

  it('Facebook targets the page and carries the UTM link in the text', async () => {
    setBlotatoEnv();
    process.env.RIG_RECEIPTS_URL = 'https://rigreceipts.example.com';
    const { impl, calls } = fakeFetch([{ json: { postSubmissionId: 'sub-fb' } }]);
    const adapter = new BlotatoAdapter('Facebook Page', { fetchImpl: impl });

    await adapter.publish(item({ platform: 'Facebook Page', asset_path: null }));
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      post: { content: { text: string }; target: { targetType: string; pageId: string } };
    };
    assert.equal(body.post.target.pageId, 'page-1');
    assert.match(body.post.content.text, /utm_campaign=RR-IG-2026-01-01-001/);
  });

  it('video platforms upload media by URL first, then post with the hosted URL', async () => {
    setBlotatoEnv();
    const { impl, calls } = fakeFetch([
      { json: { url: 'https://media.blotato.example/hosted.mp4' } },
      { json: { postSubmissionId: 'sub-tt' } },
    ]);
    const adapter = new BlotatoAdapter('TikTok', { fetchImpl: impl });

    const output = await adapter.publish(item({ platform: 'TikTok' }));
    assert.equal(output.platform_post_id, 'blotato:sub-tt');
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? '', /\/v2\/media$/);
    const mediaBody = JSON.parse(String(calls[0]?.init?.body)) as { url: string };
    assert.match(mediaBody.url, /^https:\/\/assets\.example\.com\/rig-receipts\/videos\/test-fixture-blotato\.mp4$/);
    const postBody = JSON.parse(String(calls[1]?.init?.body)) as {
      post: {
        content: { mediaUrls: string[] };
        target: { targetType: string; privacyLevel: string; isAiGenerated: boolean };
      };
    };
    assert.deepEqual(postBody.post.content.mediaUrls, ['https://media.blotato.example/hosted.mp4']);
    assert.equal(postBody.post.target.privacyLevel, 'PUBLIC_TO_EVERYONE');
    assert.equal(postBody.post.target.isAiGenerated, true, 'AI-generated content is disclosed');
  });

  it('YouTube titles from the hook, defaults public, honours the env override', async () => {
    setBlotatoEnv();
    const { impl, calls } = fakeFetch([
      { json: { url: 'https://media.blotato.example/hosted.mp4' } },
      { json: { postSubmissionId: 'sub-yt' } },
    ]);
    const adapter = new BlotatoAdapter('YouTube Shorts', { fetchImpl: impl });
    await adapter.publish(item({ platform: 'YouTube Shorts' }));
    const body = JSON.parse(String(calls[1]?.init?.body)) as {
      post: { target: { title: string; privacyStatus: string } };
    };
    assert.equal(body.post.target.title, 'A hook');
    assert.equal(body.post.target.privacyStatus, 'public');

    process.env.YOUTUBE_PRIVACY_STATUS = 'unlisted';
    const second = fakeFetch([
      { json: { url: 'https://media.blotato.example/hosted.mp4' } },
      { json: { postSubmissionId: 'sub-yt2' } },
    ]);
    await new BlotatoAdapter('YouTube Shorts', { fetchImpl: second.impl }).publish(item({ platform: 'YouTube Shorts' }));
    const overridden = JSON.parse(String(second.calls[1]?.init?.body)) as { post: { target: { privacyStatus: string } } };
    assert.equal(overridden.post.target.privacyStatus, 'unlisted');
  });

  it('rejects YouTube titles containing angle brackets', () => {
    const adapter = new BlotatoAdapter('YouTube Shorts');
    assert.equal(adapter.validateContent(item({ platform: 'YouTube Shorts', hook: 'Costs < revenue?' })).ok, false);
  });

  it('fails loudly when Blotato returns no submission id', async () => {
    setBlotatoEnv();
    const { impl } = fakeFetch([{ json: {} }]);
    const adapter = new BlotatoAdapter('LinkedIn', { fetchImpl: impl });
    await assert.rejects(() => adapter.publish(item({ platform: 'LinkedIn', asset_path: null })), /postSubmissionId/);
  });
});

describe('adapter registry', () => {
  it('defaults the social set to Blotato with Blog and Email first-party', () => {
    delete process.env.PUBLISH_BACKEND;
    assert.equal(publishBackend(), 'blotato');
    const adapters = buildAdapters();
    assert.ok(adapters.LinkedIn instanceof BlotatoAdapter);
    assert.ok(adapters.TikTok instanceof BlotatoAdapter);
    assert.ok(adapters.Blog, 'Blog stays first-party');
    assert.ok(adapters.Email, 'Email stays first-party');
  });

  it('PUBLISH_BACKEND=direct restores the per-platform adapters', () => {
    process.env.PUBLISH_BACKEND = 'direct';
    const adapters = buildAdapters();
    assert.ok(adapters.LinkedIn instanceof LinkedInAdapter);
  });

  it('never wires draft-only channels under either backend', () => {
    for (const backend of ['blotato', 'direct']) {
      process.env.PUBLISH_BACKEND = backend;
      const adapters = buildAdapters() as Record<string, unknown>;
      for (const platform of ['Reddit', 'Facebook Groups', 'X']) {
        assert.equal(adapters[platform], undefined, `${platform} must have no adapter (backend=${backend})`);
      }
    }
  });
});
