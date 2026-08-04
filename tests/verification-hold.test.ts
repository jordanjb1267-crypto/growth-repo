import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { canTransition, STATE_DIRECTORIES, TERMINAL_STATES } from '../src/state/machine.ts';
import { holdItem, HOLDABLE_STATES, HoldError, releaseItem } from '../src/approval/hold.ts';
import { parseHoldArgs, usage } from '../src/scripts/content-hold.ts';
import { buildQueue, CLASSIFIER_INPUT_STATES } from '../src/scripts/classify-risk.ts';
import { publishItem } from '../src/publish/adapter.ts';
import { BlogAdapter } from '../src/publish/blog.ts';
import { listItemsInState, readItem, writeItem } from '../src/lib/store.ts';
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

const CLASSIFICATION = {
  level: 'green' as const,
  scores: { brand: 95, platform_safety: 95, strategic_quality: 95 },
  rule_hits: [],
  duplicate_similarity: 0,
  duplicate_of: null,
  template_exemption: null,
  rationale: 'clean',
  classified_at: '2026-08-04T00:00:00.000Z',
};

function fixture(id: string, status: ContentState, extra: Partial<ContentItem> = {}): ContentItem {
  const item = {
    ...draftItem({ id, product: 'Rig Receipts', status }),
    platform: 'Blog' as const,
    ...extra,
  };
  testIds.push(id);
  writeItem(item);
  return item;
}

function transitionsFor(id: string): { from: string; to: string; actor: string; reason: string }[] {
  const log = join(REPO_ROOT, 'logs', 'state-transitions.jsonl');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { content_id: string; from: string; to: string; actor: string; reason: string })
    .filter((d) => d.content_id === id);
}

describe('verification_hold in the state machine', () => {
  it('accepts every approved entry transition', () => {
    for (const from of HOLDABLE_STATES) {
      assert.ok(canTransition(from, 'verification_hold'), `${from} → verification_hold must be legal`);
    }
  });

  it('exits only to edited or rejected', () => {
    assert.ok(canTransition('verification_hold', 'edited'));
    assert.ok(canTransition('verification_hold', 'rejected'));

    for (const forbidden of ['brand_checked', 'risk_classified', 'auto_publish_ready', 'scheduled', 'published'] as const) {
      assert.equal(
        canTransition('verification_hold', forbidden),
        false,
        `releasing a hold must not reach ${forbidden} directly`,
      );
    }
  });

  it('is not terminal, and terminal states neither enter nor leave it', () => {
    assert.ok(!(TERMINAL_STATES as readonly string[]).includes('verification_hold'));
    for (const terminal of TERMINAL_STATES) {
      assert.equal(canTransition(terminal, 'verification_hold'), false, `${terminal} must not enter the hold`);
      assert.equal(canTransition('verification_hold', terminal), terminal === 'blocked' ? false : false);
    }
  });

  it('keeps existing terminal invariants intact', () => {
    for (const terminal of TERMINAL_STATES) {
      for (const to of ['edited', 'drafted', 'published', 'scheduled'] as const) {
        assert.equal(canTransition(terminal, to), false, `${terminal} → ${to} must stay illegal`);
      }
    }
  });

  it('has its own directory, separate from drafts', () => {
    assert.equal(STATE_DIRECTORIES.verification_hold, 'content/verification-hold');
    assert.notEqual(STATE_DIRECTORIES.verification_hold, STATE_DIRECTORIES.drafted);
  });
});

describe('held items are invisible to the classifier', () => {
  it('verification_hold is not a classifier input state', () => {
    assert.ok(!(CLASSIFIER_INPUT_STATES as readonly string[]).includes('verification_hold'));
  });

  it('unscoped queue construction ignores held items', () => {
    const held = fixture('TEST-HOLD-2026-08-04-001', 'drafted');
    holdItem(held.id, 'Claims unverified.');

    const result = buildQueue(null);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.ok(!result.queue.some((i) => i.id === held.id), 'held item must not enter the unscoped queue');
  });

  it('--only on a held id fails without mutating it', () => {
    const held = fixture('TEST-HOLD-2026-08-04-002', 'edited');
    holdItem(held.id, 'Claims unverified.');
    const path = join(REPO_ROOT, 'content', 'verification-hold', `${held.id}.json`);
    const before = readFileSync(path, 'utf8');

    const result = buildQueue(held.id);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /is in "verification_hold"/);
    assert.match(result.error, /not a classifier input state/);
    assert.equal(readFileSync(path, 'utf8'), before, 'byte-identical after the failed selection');
  });

  it('leaves a held bystander byte-identical during ordinary unscoped classification', () => {
    const bystander = fixture('TEST-HOLD-2026-08-04-003', 'drafted');
    holdItem(bystander.id, 'Claims unverified.');
    const path = join(REPO_ROOT, 'content', 'verification-hold', `${bystander.id}.json`);
    const before = readFileSync(path, 'utf8');

    // Whatever the unscoped queue contains, the held item is not in it.
    const queue = buildQueue(null);
    assert.ok(queue.ok);
    if (!queue.ok) return;
    assert.ok(!queue.queue.some((i) => i.id === bystander.id));
    assert.equal(readFileSync(path, 'utf8'), before);
  });
});

describe('held items cannot publish or schedule', () => {
  it('refuses to publish even with every switch forced true', async () => {
    const item = fixture('TEST-HOLD-2026-08-04-004', 'auto_publish_ready', { classification: CLASSIFICATION, risk_level: 'green' });
    const held = holdItem(item.id, 'Claims unverified.');

    const attempt = await publishItem(held, new BlogAdapter(), {
      AUTOPUBLISH_ENABLED: 'true',
      BLOG_AUTOPUBLISH_ENABLED: 'true',
    } as NodeJS.ProcessEnv);

    assert.equal(attempt.published, false);
    assert.match(attempt.reason, /not "auto_publish_ready"/);
    assert.equal(readItem(item.id)?.status, 'verification_hold');
  });

  it('cannot be scheduled — no edge exists', () => {
    assert.equal(canTransition('verification_hold', 'scheduled'), false);
    // And nothing in the publishable state list contains it.
    assert.ok(!listItemsInState('auto_publish_ready').some((i) => i.status === 'verification_hold'));
  });
});

describe('hold and release semantics', () => {
  it('clears classification and approval, and records the reason', () => {
    const item = fixture('TEST-HOLD-2026-08-04-005', 'auto_publish_ready', {
      classification: CLASSIFICATION,
      risk_level: 'green',
      approval: { by: 'founder', at: '2026-08-04T00:00:00.000Z', note: 'ok' },
    });

    const held = holdItem(item.id, 'Allow-list unsupported.');

    assert.equal(held.status, 'verification_hold');
    assert.equal(held.classification, null, 'a stale Green must not survive the hold');
    assert.equal(held.approval, null);
    assert.equal(held.founder_note, 'Allow-list unsupported.');
  });

  it('preserves the item content byte-for-byte through hold and release', () => {
    const item = fixture('TEST-HOLD-2026-08-04-006', 'edited', { hook: 'A hook', full_content: 'Body text.', caption: 'Cap', cta: 'CTA' });

    const held = holdItem(item.id, 'Unverified.');
    assert.equal(held.hook, 'A hook');
    assert.equal(held.full_content, 'Body text.');

    const released = releaseItem(item.id, 'Platform behaviour confirmed.');
    assert.equal(released.full_content, 'Body text.');
    assert.equal(released.caption, 'Cap');
  });

  it('releases only to edited, with classification and approval cleared', () => {
    const item = fixture('TEST-HOLD-2026-08-04-007', 'awaiting_founder_approval');
    holdItem(item.id, 'Unverified.');

    const released = releaseItem(item.id, 'Verified against the shipped app.');

    assert.equal(released.status, 'edited');
    assert.equal(released.classification, null);
    assert.equal(released.approval, null);
    assert.equal(readItem(item.id)?.status, 'edited');
  });

  it('logs founder actor and the exact hold and release reasons', () => {
    const item = fixture('TEST-HOLD-2026-08-04-008', 'drafted');
    holdItem(item.id, 'HOLD REASON EXACT.');
    releaseItem(item.id, 'RELEASE REASON EXACT.');

    const log = transitionsFor(item.id);
    const hold = log.find((t) => t.to === 'verification_hold');
    const release = log.find((t) => t.from === 'verification_hold' && t.to === 'edited');

    assert.ok(hold, 'hold logged');
    assert.equal(hold.from, 'drafted');
    assert.equal(hold.actor, 'founder');
    assert.equal(hold.reason, 'HOLD REASON EXACT.');

    assert.ok(release, 'release logged');
    assert.equal(release.actor, 'founder');
    assert.equal(release.reason, 'RELEASE REASON EXACT.');
  });

  it('refuses an unknown id without mutation', () => {
    assert.throws(() => holdItem('RR-BLOG-2099-01-01-999', 'x'), HoldError);
    assert.throws(() => releaseItem('RR-BLOG-2099-01-01-999', 'x'), /No content item/);
  });

  it('refuses a terminal or otherwise ineligible item', () => {
    const blocked = fixture('TEST-HOLD-2026-08-04-009', 'blocked');
    assert.throws(() => holdItem(blocked.id, 'x'), /is in "blocked" \(terminal\)/);
    assert.equal(readItem(blocked.id)?.status, 'blocked', 'unchanged');

    const rejected = fixture('TEST-HOLD-2026-08-04-010', 'rejected');
    assert.throws(() => holdItem(rejected.id, 'x'), /is in "rejected"/);

    const notHeld = fixture('TEST-HOLD-2026-08-04-011', 'drafted');
    assert.throws(() => releaseItem(notHeld.id, 'x'), /cannot be released/);
    assert.equal(readItem(notHeld.id)?.status, 'drafted', 'unchanged');
  });

  it('requires a non-empty reason', () => {
    const item = fixture('TEST-HOLD-2026-08-04-012', 'drafted');
    for (const empty of ['', '   ']) {
      assert.throws(() => holdItem(item.id, empty), /non-empty reason/);
    }
    assert.equal(readItem(item.id)?.status, 'drafted', 'unchanged by the rejected calls');
  });
});

describe('hold command arguments', () => {
  it('requires both an id and a reason', () => {
    for (const argv of [[], ['--only', 'X-1'], ['--reason', 'because'], ['--only', 'X-1', '--reason', '   ']]) {
      const parsed = parseHoldArgs(argv, 'hold');
      assert.equal(parsed.ok, false, `${argv.join(' ') || '(none)'} must fail`);
    }
  });

  it('accepts both flag forms', () => {
    for (const argv of [
      ['--only', 'X-1', '--reason', 'because'],
      ['--only=X-1', '--reason=because'],
    ]) {
      const parsed = parseHoldArgs(argv, 'hold');
      assert.ok(parsed.ok, argv.join(' '));
      if (!parsed.ok) return;
      assert.equal(parsed.args.only, 'X-1');
      assert.equal(parsed.args.reason, 'because');
    }
  });

  it('rejects unknown flags and never advertises an all-items form', () => {
    const parsed = parseHoldArgs(['--all'], 'hold');
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /Unknown argument: --all/);

    // The usage block must document only the two required flags — a command
    // that could hold the whole queue by omission is one that eventually will.
    assert.deepEqual(
      [...usage('hold').matchAll(/--[a-z-]+/g)].map((m) => m[0]).filter((f) => f !== '--'),
      ['--only', '--reason'],
    );
  });
});
