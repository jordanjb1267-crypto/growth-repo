import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  buildQueue,
  CLASSIFIER_INPUT_STATES,
  parseClassifyArgs,
  runClassification,
} from '../src/scripts/classify-risk.ts';
import { STATE_DIRECTORIES } from '../src/state/machine.ts';
import { writeItem } from '../src/lib/store.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { draftItem } from './helpers.ts';
import type { ContentItem, ContentState } from '../src/lib/types.ts';

const testIds: string[] = [];
after(() => {
  for (const id of testIds) {
    for (const dir of new Set(Object.values(STATE_DIRECTORIES))) {
      const file = join(REPO_ROOT, dir, `${id}.json`);
      if (existsSync(file)) unlinkSync(file);
    }
  }
});

function fixture(id: string, status: ContentState): ContentItem {
  const item = { ...draftItem({ id, product: 'Rig Receipts', status }), platform: 'Blog' as const };
  testIds.push(id);
  return item;
}

/** In-memory loaders, so selection is tested without touching the content
 *  directories at all. */
function loaders(items: readonly ContentItem[]) {
  return {
    load: (state: ContentState) => items.filter((i) => i.status === state),
    find: (id: string) => items.find((i) => i.id === id) ?? null,
  };
}

describe('argument parsing', () => {
  it('accepts --only in both forms and --no-scoring', () => {
    for (const [argv, only, skip] of [
      [[], null, false],
      [['--only', 'RR-BLOG-2026-01-01-001'], 'RR-BLOG-2026-01-01-001', false],
      [['--only=RR-BLOG-2026-01-01-001'], 'RR-BLOG-2026-01-01-001', false],
      [['--no-scoring'], null, true],
      [['--only', 'X-1', '--no-scoring'], 'X-1', true],
    ] as const) {
      const parsed = parseClassifyArgs([...argv]);
      assert.ok(parsed.ok, `${argv.join(' ') || '(none)'} parses`);
      if (!parsed.ok) return;
      assert.equal(parsed.args.only, only);
      assert.equal(parsed.args.skipScoring, skip);
    }
  });

  it('fails closed on --only with no id', () => {
    for (const argv of [['--only'], ['--only', '--no-scoring'], ['--only=']]) {
      const parsed = parseClassifyArgs(argv);
      assert.equal(parsed.ok, false, `${argv.join(' ')} must fail`);
      if (parsed.ok) return;
      assert.match(parsed.error, /--only requires a content id/);
    }
  });

  it('rejects unknown flags rather than ignoring them', () => {
    const parsed = parseClassifyArgs(['--everything']);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /Unknown argument: --everything/);
  });
});

describe('queue selection', () => {
  const drafted = fixture('TEST-SCOPE-2026-08-04-001', 'drafted');
  const edited = fixture('TEST-SCOPE-2026-08-04-002', 'edited');
  const rejected = fixture('TEST-SCOPE-2026-08-04-003', 'rejected');
  const blocked = fixture('TEST-SCOPE-2026-08-04-004', 'blocked');
  const all = [drafted, edited, rejected, blocked];
  const { load, find } = loaders(all);

  it('selects exactly the requested item and nothing else', () => {
    const result = buildQueue(edited.id, load, find);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(result.queue.map((i) => i.id), [edited.id]);
  });

  it('leaves every other eligible item out of the queue', () => {
    const result = buildQueue(drafted.id, load, find);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.queue.length, 1);
    assert.ok(!result.queue.some((i) => i.id === edited.id), 'the other eligible item is untouched');
  });

  it('fails on an unknown id', () => {
    const result = buildQueue('RR-BLOG-2099-01-01-999', load, find);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /No content item with id/);
  });

  it('fails on a terminal item and names its state', () => {
    const result = buildQueue(blocked.id, load, find);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /is in "blocked" \(terminal\)/);
    assert.match(result.error, /not a classifier input state/);
  });

  it('fails on an ineligible non-terminal item', () => {
    const result = buildQueue(rejected.id, load, find);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /is in "rejected"/);
    assert.doesNotMatch(result.error, /terminal/, 'rejected is ineligible but not terminal');
  });

  it('fails on an ambiguous id rather than guessing', () => {
    const twin = { ...drafted, status: 'brand_checked' as const };
    const ambiguous = buildQueue(drafted.id, loaders([drafted, twin]).load, find);
    assert.equal(ambiguous.ok, false);
    if (ambiguous.ok) return;
    assert.match(ambiguous.error, /Ambiguous/);
  });

  it('unscoped selection still returns the whole eligible queue', () => {
    const result = buildQueue(null, load, find);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(result.queue.map((i) => i.id).sort(), [drafted.id, edited.id].sort());
    assert.ok(!result.queue.some((i) => i.id === rejected.id), 'terminal/ineligible never enter the queue');
  });

  it('never admits a state outside the declared input set', () => {
    assert.deepEqual([...CLASSIFIER_INPUT_STATES], ['drafted', 'edited', 'brand_checked']);
    for (const forbidden of ['published', 'rejected', 'blocked', 'retracted', 'auto_publish_ready'] as const) {
      assert.ok(!(CLASSIFIER_INPUT_STATES as readonly string[]).includes(forbidden), `${forbidden} is not classifiable`);
    }
  });
});

describe('run outcome', () => {
  it('reports a failure count when the selected item throws', async () => {
    const item = fixture('TEST-SCOPE-2026-08-04-005', 'drafted');
    const summary = await runClassification([item], {
      process: async () => {
        throw new Error('classifier exploded');
      },
      log: () => {},
      error: () => {},
    });

    assert.equal(summary.failures, 1, 'drives the non-zero exit');
    assert.deepEqual(summary.counts, { green: 0, yellow: 0, red: 0 });
  });

  it('counts levels when processing succeeds', async () => {
    const item = fixture('TEST-SCOPE-2026-08-04-006', 'drafted');
    const summary = await runClassification([item], {
      process: async (i) => ({ id: i.id, level: 'yellow' as const, to: 'awaiting_founder_approval' as const }),
      log: () => {},
      error: () => {},
    });

    assert.equal(summary.failures, 0);
    assert.equal(summary.counts.yellow, 1);
  });
});

describe('command-level scoping', () => {
  const script = join(REPO_ROOT, 'src', 'scripts', 'classify-risk.ts');

  const run = (args: string[]) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120_000 }),
      };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  it('classifies exactly the named item and leaves its neighbour byte-identical', () => {
    // Two eligible fixtures. Only one is named; the other must not move.
    const target = fixture('TEST-CMD-2026-08-04-001', 'drafted');
    const bystander = fixture('TEST-CMD-2026-08-04-002', 'drafted');
    writeItem(target);
    writeItem(bystander);

    const bystanderPath = join(REPO_ROOT, 'content', 'drafts', `${bystander.id}.json`);
    const before = readFileSync(bystanderPath, 'utf8');

    // --no-scoring keeps this deterministic and makes no model call.
    const { code, out } = run(['--only', target.id, '--no-scoring']);

    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`Scoped to ${target.id} \\(currently "drafted"`), 'announces selection before mutating');
    assert.match(out, /Classified 1 item/);

    assert.equal(readFileSync(bystanderPath, 'utf8'), before, 'bystander byte-identical');
    assert.ok(existsSync(bystanderPath), 'bystander still in content/drafts');
    assert.ok(!existsSync(join(REPO_ROOT, 'content', 'drafts', `${target.id}.json`)), 'target moved on');
  });

  it('exits non-zero on an unknown id without mutating anything', () => {
    const bystander = fixture('TEST-CMD-2026-08-04-003', 'drafted');
    writeItem(bystander);
    const path = join(REPO_ROOT, 'content', 'drafts', `${bystander.id}.json`);
    const before = readFileSync(path, 'utf8');

    const { code, out } = run(['--only', 'RR-BLOG-2099-01-01-999', '--no-scoring']);

    assert.equal(code, 1);
    assert.match(out, /No content item with id/);
    assert.equal(readFileSync(path, 'utf8'), before, 'nothing mutated on a failed selection');
  });

  it('exits non-zero on --only with no id, before reading any item', () => {
    const { code, out } = run(['--only']);
    assert.equal(code, 1);
    assert.match(out, /--only requires a content id/);
  });

  it('writes only the selected item into the transition log', () => {
    const target = fixture('TEST-CMD-2026-08-04-004', 'drafted');
    const bystander = fixture('TEST-CMD-2026-08-04-005', 'drafted');
    writeItem(target);
    writeItem(bystander);

    const log = join(REPO_ROOT, 'logs', 'state-transitions.jsonl');
    const linesBefore = existsSync(log) ? readFileSync(log, 'utf8').split('\n').length : 0;

    const { code } = run(['--only', target.id, '--no-scoring']);
    assert.equal(code, 0);

    const added = readFileSync(log, 'utf8')
      .split('\n')
      .slice(Math.max(0, linesBefore - 1))
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { content_id: string });

    // The transition log is process-global and other test files run
    // concurrently against it, so this asserts over the two ids this test
    // owns rather than over the whole tail — which is the actual guarantee
    // scoping provides.
    const mine = added.filter((e) => e.content_id === target.id || e.content_id === bystander.id);
    assert.ok(mine.length > 0, 'the selected item was logged');
    assert.ok(
      mine.every((entry) => entry.content_id === target.id),
      `the bystander must never be logged; saw ${[...new Set(mine.map((e) => e.content_id))].join(', ')}`,
    );
  });
});
