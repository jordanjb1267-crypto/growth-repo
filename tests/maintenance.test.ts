import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { expireItem, findExpired } from '../src/approval/queue.ts';
import { canTransition, STATE_DIRECTORIES } from '../src/state/machine.ts';
import { defaultRawDir, foldAudienceBanks } from '../src/analytics/banks.ts';
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
  /**
   * Fully isolated: research is read from a temp directory and the banks are
   * written to a temp directory. This previously folded against the real
   * analytics/raw/ feed and mutated the real memory banks, so a genuine
   * research file mentioning a seeded phrase changed the appearance count and
   * failed the test — which is exactly what happened on 2026-08-02.
   */
  function isolatedDirs(): { rawDir: string; memoryDir: string } {
    const base = mkdtempSync(join(tmpdir(), 'growth-banks-'));
    tempDirs.push(base);
    const rawDir = join(base, 'raw');
    const memoryDir = join(base, 'memory');
    mkdirSync(rawDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'audience-language-bank.json'), JSON.stringify({ entries: [] }), 'utf8');
    writeFileSync(join(memoryDir, 'objection-bank.json'), JSON.stringify({ objections: [] }), 'utf8');
    return { rawDir, memoryDir };
  }

  function mkResearch(rawDir: string, date: string, phrases: string[], objections: string[]): void {
    writeFileSync(
      join(rawDir, `${date}-research.json`),
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
      'utf8',
    );
  }

  it('promotes on the second independent day, not the first', () => {
    const { rawDir, memoryDir } = isolatedDirs();
    mkResearch(rawDir, '2020-01-01', ['deadhead ate the load', 'TEST-once-only'], ['TEST-too busy to track']);
    mkResearch(rawDir, '2020-01-02', ['Deadhead ate the load'], ['test-too busy to track']);

    const result = foldAudienceBanks({ rawDir, memoryDir });
    assert.ok(result.candidates_waiting >= 1, 'the single-appearance phrase must still be waiting');

    const languageBank = JSON.parse(readFileSync(join(memoryDir, 'audience-language-bank.json'), 'utf8')) as {
      entries: { text: string; appearances: number }[];
    };
    const promoted = languageBank.entries.find((e) => e.text.toLowerCase() === 'deadhead ate the load');
    assert.ok(promoted, 'two-day phrase promoted (case-insensitively deduped)');
    assert.equal(promoted.appearances, 2);
    assert.ok(!languageBank.entries.some((e) => e.text === 'TEST-once-only'), 'one-day phrase not promoted');

    const objectionBank = JSON.parse(readFileSync(join(memoryDir, 'objection-bank.json'), 'utf8')) as {
      objections: { text: string }[];
    };
    assert.ok(objectionBank.objections.some((o) => o.text.toLowerCase() === 'test-too busy to track'));
  });

  it('is unaffected by real research files, and never writes the real banks', () => {
    // Whatever the founder's genuine feed contains — including the very phrase
    // this test seeds — must be invisible to an isolated fold.
    const realRaw = defaultRawDir();
    const realResearch = existsSync(realRaw)
      ? readdirSync(realRaw).filter((f) => /^\d{4}-\d{2}-\d{2}-research\.json$/.test(f))
      : [];
    const realMentions = realResearch.filter((f) =>
      /deadhead ate the load/i.test(readFileSync(join(realRaw, f), 'utf8')),
    );

    const bankFiles = ['audience-language-bank.json', 'objection-bank.json'];
    const realBanksBefore = bankFiles.map((f) => readFileSync(join(paths.memory, f), 'utf8'));

    const { rawDir, memoryDir } = isolatedDirs();
    mkResearch(rawDir, '2020-01-01', ['deadhead ate the load'], []);
    mkResearch(rawDir, '2020-01-02', ['deadhead ate the load'], []);
    foldAudienceBanks({ rawDir, memoryDir });

    const languageBank = JSON.parse(readFileSync(join(memoryDir, 'audience-language-bank.json'), 'utf8')) as {
      entries: { text: string; appearances: number }[];
    };
    const promoted = languageBank.entries.find((e) => e.text.toLowerCase() === 'deadhead ate the load');
    assert.ok(promoted);
    assert.equal(
      promoted.appearances,
      2,
      `must count only the 2 fixture days; the real feed holds ${realResearch.length} research file(s), ` +
        `${realMentions.length} of which mention this phrase and must not leak in`,
    );

    const realBanksAfter = bankFiles.map((f) => readFileSync(join(paths.memory, f), 'utf8'));
    assert.deepEqual(realBanksAfter, realBanksBefore, 'an isolated fold must never write the real memory banks');
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
