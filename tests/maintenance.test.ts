import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { expireItem, findExpired } from '../src/approval/queue.ts';
import { canTransition, STATE_DIRECTORIES } from '../src/state/machine.ts';
import { foldAudienceBanks } from '../src/analytics/banks.ts';
import { buildSite, parsePost, renderMarkdown } from '../src/site/build.ts';
import { writeItem, readItem } from '../src/lib/store.ts';
import { REPO_ROOT, paths } from '../src/lib/paths.ts';
import { draftItem } from './helpers.ts';

const testIds: string[] = [];
const testFiles: string[] = [];
const tempDirs: string[] = [];

function cleanup(): void {
  for (const id of testIds) {
    for (const dir of new Set(Object.values(STATE_DIRECTORIES))) {
      const file = join(REPO_ROOT, dir, `${id}.json`);
      if (existsSync(file)) unlinkSync(file);
    }
  }
  for (const file of testFiles) if (existsSync(file)) unlinkSync(file);
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}
after(cleanup);

describe('approval expiry', () => {
  it('expires only items older than the window, into content/rejected', () => {
    const fresh = draftItem({
      id: 'TEST-EXP-2026-01-01-001',
      product: 'Rig Receipts',
      status: 'awaiting_founder_approval',
    });
    const stale = {
      ...draftItem({
        id: 'TEST-EXP-2026-01-01-002',
        product: 'Rig Receipts',
        status: 'awaiting_founder_approval',
      }),
      updated_at: new Date(Date.now() - 200 * 3_600_000).toISOString(),
    };
    testIds.push(fresh.id, stale.id);
    writeItem(fresh);
    writeItem(stale);

    const found = findExpired([fresh, stale], 168);
    assert.deepEqual(found.map((i) => i.id), [stale.id]);

    expireItem(stale.id, 168);
    const stored = readItem(stale.id);
    assert.equal(stored?.status, 'expired');
    assert.ok(existsSync(join(REPO_ROOT, 'content', 'rejected', `${stale.id}.json`)));
  });
});

describe('late retraction edges', () => {
  it('allows retraction from every post-publication state', () => {
    for (const from of ['published', 'analytics_collected', 'learned_from', 'memory_updated'] as const) {
      assert.ok(canTransition(from, 'retracted'), `${from} -> retracted must be legal`);
    }
    assert.ok(!canTransition('retracted', 'published'), 'retracted stays terminal');
  });
});

describe('audience bank folding', () => {
  it('promotes on the second independent day, not the first', () => {
    const rawDir = join(paths.analytics, 'raw');
    mkdirSync(rawDir, { recursive: true });

    const mkResearch = (date: string, phrases: string[], objections: string[]) => {
      const file = join(rawDir, `${date}-research.json`);
      testFiles.push(file);
      writeFileSync(
        file,
        JSON.stringify({
          $schema_version: 1,
          generated_at: `${date}T07:00:00Z`,
          topics: [
            {
              product: 'Rig Receipts',
              topic: 'test',
              audience_language: phrases,
              objections,
              content_angle: 'test',
              sources: 'model-prior',
            },
          ],
        }),
      );
    };

    mkResearch('2020-01-01', ['deadhead ate the load', 'TEST-once-only'], ['TEST-too busy to track']);
    mkResearch('2020-01-02', ['Deadhead ate the load'], ['test-too busy to track']);

    const result = foldAudienceBanks();
    assert.ok(result.candidates_waiting >= 1, 'the single-appearance phrase must still be waiting');

    const languageBank = JSON.parse(
      readFileSync(join(paths.memory, 'audience-language-bank.json'), 'utf8'),
    ) as { entries: { text: string; appearances: number }[] };
    const promoted = languageBank.entries.find((e) => e.text.toLowerCase() === 'deadhead ate the load');
    assert.ok(promoted, 'two-day phrase promoted (case-insensitively deduped)');
    assert.equal(promoted.appearances, 2);
    assert.ok(!languageBank.entries.some((e) => e.text === 'TEST-once-only'), 'one-day phrase not promoted');

    const objectionBank = JSON.parse(readFileSync(join(paths.memory, 'objection-bank.json'), 'utf8')) as {
      objections: { text: string }[];
    };
    assert.ok(objectionBank.objections.some((o) => o.text.toLowerCase() === 'test-too busy to track'));

    // Restore the seeded banks so the repo stays clean.
    testFiles.push(); // no-op; bank restoration below
    const restore = (file: string, key: string) => {
      const full = join(paths.memory, file);
      const bank = JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown>;
      bank[key] = (bank[key] as { text: string }[]).filter((e) => !/deadhead ate the load|test-/i.test(e.text));
      writeFileSync(full, `${JSON.stringify(bank, null, 2)}\n`);
    };
    restore('audience-language-bank.json', 'entries');
    restore('objection-bank.json', 'objections');
  });
});

describe('site builder', () => {
  it('parses frontmatter, escapes HTML, renders our markdown subset', () => {
    const post = parsePost('2026-07-29-test.md', [
      '---',
      'title: "A <scripty> title"',
      'date: 2026-07-29T00:00:00Z',
      'product: "Rig Receipts"',
      'campaign: "Test"',
      'content_id: RR-BLOG-2026-07-29-001',
      '---',
      '',
      'A paragraph with **bold** and a [link](https://example.com/x).',
      '',
      '<script>alert(1)</script>',
    ].join('\n'));

    assert.ok(post);
    assert.equal(post.title, 'A <scripty> title');

    const html = renderMarkdown(post.body);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<a href="https:\/\/example\.com\/x">link<\/a>/);
    assert.ok(!html.includes('<script>'), 'raw HTML must be escaped');
    assert.match(html, /&lt;script&gt;/);
  });

  it('builds an index and post pages into the output directory', () => {
    const base = join(REPO_ROOT, 'site', 'test-tmp');
    tempDirs.push(base);
    const postsDir = join(base, 'posts-src');
    const outDir = join(base, 'dist');
    const assetsDir = join(base, 'assets-src');
    mkdirSync(postsDir, { recursive: true });
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'x.txt'), 'asset');
    writeFileSync(
      join(postsDir, '2026-07-29-t1.md'),
      '---\ntitle: "First"\ndate: 2026-07-29T00:00:00Z\nproduct: "Rig Receipts"\ncampaign: "C"\ncontent_id: X\n---\n\nBody text.',
    );

    const result = buildSite(postsDir, outDir, assetsDir);
    assert.equal(result.posts, 1);
    assert.ok(existsSync(join(outDir, 'index.html')));
    assert.ok(existsSync(join(outDir, 'posts', '2026-07-29-t1.html')));
    assert.ok(existsSync(join(outDir, 'assets', 'x.txt')), 'assets mirrored for ASSET_BASE_URL hosting');
    assert.match(readFileSync(join(outDir, 'index.html'), 'utf8'), /First/);
  });
});
