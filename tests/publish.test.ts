import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { connectorHealth, publishItem, resumeConnector, withUtm, PAUSE_AFTER_FAILURES } from '../src/publish/adapter.ts';
import { BlogAdapter } from '../src/publish/blog.ts';
import { STATE_DIRECTORIES } from '../src/state/machine.ts';
import { writeItem, readItem } from '../src/lib/store.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { draftItem } from './helpers.ts';
import type { ContentItem, Platform } from '../src/lib/types.ts';
import type { PublisherAdapter, PublishOutput } from '../src/publish/adapter.ts';

const ENV_ON: NodeJS.ProcessEnv = {
  AUTOPUBLISH_ENABLED: 'true',
  BLOG_AUTOPUBLISH_ENABLED: 'true',
  EMAIL_AUTOSEND_ENABLED: 'true',
};

const testIds: string[] = [];
const tempDirs: string[] = [];

function cleanup(): void {
  for (const id of testIds) {
    for (const dir of new Set(Object.values(STATE_DIRECTORIES))) {
      const file = join(REPO_ROOT, dir, `${id}.json`);
      if (existsSync(file)) unlinkSync(file);
    }
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  resumeConnector('Blog');

  // publishItem writes real attribution records; strip the test entries so
  // repeated test runs don't accumulate in analytics/attribution.json.
  const attributionFile = join(REPO_ROOT, 'analytics', 'attribution.json');
  if (existsSync(attributionFile)) {
    const map = JSON.parse(readFileSync(attributionFile, 'utf8')) as Record<string, string>;
    const kept = Object.fromEntries(Object.entries(map).filter(([, id]) => !testIds.includes(id)));
    writeFileSync(attributionFile, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
  }
}
after(cleanup);

let seq = 0;
function readyItem(overrides: Partial<ContentItem> = {}): ContentItem {
  seq += 1;
  const item = draftItem({
    id: `TEST-PB-2026-01-01-${String(seq).padStart(3, '0')}`,
    product: 'Rig Receipts',
    platform: 'Blog',
    status: 'auto_publish_ready',
    hook: 'A test post title',
    full_content: 'Body of the post.',
    caption: 'Caption.',
    cta: 'CTA.',
    risk_level: 'green',
    classification: {
      level: 'green',
      rule_hits: [],
      scores: { brand: 90, platform_safety: 90, strategic_quality: 90 },
      duplicate_similarity: 0,
      duplicate_of: null,
      template_exemption: null,
      rationale: 'test',
      classified_at: new Date().toISOString(),
    },
    ...overrides,
  });
  testIds.push(item.id);
  writeItem(item);
  return item;
}

function tempBlogAdapter(): { adapter: BlogAdapter; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'blog-test-'));
  tempDirs.push(dir);
  return { adapter: new BlogAdapter({ postsDir: dir }), dir };
}

function failingAdapter(platform: Platform): PublisherAdapter {
  return {
    platform,
    async validateAuth() {
      return { ok: true, detail: 'ok' };
    },
    validateContent() {
      return { ok: true, detail: 'ok' };
    },
    async publish(): Promise<PublishOutput> {
      throw new Error('simulated outage');
    },
  };
}

describe('publish gate', () => {
  it('publishes a green item through the blog adapter and records everything', async () => {
    const { adapter, dir } = tempBlogAdapter();
    const item = readyItem();

    const attempt = await publishItem(item, adapter, ENV_ON);
    assert.equal(attempt.published, true, attempt.reason);
    assert.ok(attempt.platform_post_id);

    const posts = readdirSync(dir);
    assert.equal(posts.length, 1);
    const post = readFileSync(join(dir, posts[0] ?? ''), 'utf8');
    assert.ok(post.includes(`content_id: ${item.id}`));

    const stored = readItem(item.id);
    assert.equal(stored?.status, 'published');
    assert.equal(stored?.platform_post_id, attempt.platform_post_id);
    assert.ok(stored?.published_at);
  });

  it('refuses with every switch off', async () => {
    const { adapter } = tempBlogAdapter();
    const attempt = await publishItem(readyItem(), adapter, {});
    assert.equal(attempt.published, false);
    assert.match(attempt.reason, /AUTOPUBLISH_ENABLED/);
  });

  it('refuses red content regardless of switches', async () => {
    const { adapter } = tempBlogAdapter();
    const attempt = await publishItem(readyItem({ risk_level: 'red' }), adapter, ENV_ON);
    assert.equal(attempt.published, false);
    assert.match(attempt.reason, /Red/);
  });

  it('refuses yellow content without an approval record, allows it with one', async () => {
    const { adapter } = tempBlogAdapter();

    const unapproved = await publishItem(readyItem({ risk_level: 'yellow' }), adapter, ENV_ON);
    assert.equal(unapproved.published, false);
    assert.match(unapproved.reason, /approval/);

    const approved = await publishItem(
      readyItem({
        risk_level: 'yellow',
        approval: { by: 'founder', at: new Date().toISOString(), note: 'ok' },
      }),
      adapter,
      ENV_ON,
    );
    assert.equal(approved.published, true, approved.reason);
  });

  it('refuses an item that never passed classification', async () => {
    const { adapter } = tempBlogAdapter();
    const attempt = await publishItem(readyItem({ classification: null }), adapter, ENV_ON);
    assert.equal(attempt.published, false);
    assert.match(attempt.reason, /classification/);
  });

  it('moves a failed publish to publish_failed and pauses after repeated failures', async () => {
    resumeConnector('Blog');
    const adapter = failingAdapter('Blog');

    for (let i = 1; i <= PAUSE_AFTER_FAILURES; i += 1) {
      const item = readyItem();
      const attempt = await publishItem(item, adapter, ENV_ON);
      assert.equal(attempt.published, false);
      assert.equal(readItem(item.id)?.status, 'publish_failed');
    }

    assert.equal(connectorHealth('Blog').paused, true, 'connector should pause after repeated failures');

    // While paused, even a healthy adapter refuses.
    const { adapter: healthy } = tempBlogAdapter();
    const held = await publishItem(readyItem(), healthy, ENV_ON);
    assert.equal(held.published, false);
    assert.match(held.reason, /paused/);

    // Founder resume clears it.
    resumeConnector('Blog');
    const after = await publishItem(readyItem(), healthy, ENV_ON);
    assert.equal(after.published, true, after.reason);
  });

  it('tags UTM parameters with the content id', () => {
    const url = withUtm('https://rigreceipts.example.com/?ref=x', 'RR-BLOG-2026-01-01-001', 'blog');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('utm_campaign'), 'RR-BLOG-2026-01-01-001');
    assert.equal(parsed.searchParams.get('utm_source'), 'blog');
    assert.equal(parsed.searchParams.get('ref'), 'x', 'existing query params survive');
  });
});
