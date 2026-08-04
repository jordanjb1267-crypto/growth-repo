import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { canTransition, STATE_DIRECTORIES, TERMINAL_STATES } from '../src/state/machine.ts';
import { editItem } from '../src/approval/queue.ts';
import { publishItem } from '../src/publish/adapter.ts';
import { readItem, writeItem } from '../src/lib/store.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { BlogAdapter } from '../src/publish/blog.ts';
import { draftItem } from './helpers.ts';

const testIds: string[] = [];
after(() => {
  for (const id of testIds) {
    for (const dir of new Set(Object.values(STATE_DIRECTORIES))) {
      const file = join(REPO_ROOT, dir, `${id}.json`);
      if (existsSync(file)) unlinkSync(file);
    }
  }
});

/** A green item sitting where publish:approved would find it. */
function greenReadyItem(id: string) {
  const item = {
    ...draftItem({ id, product: 'Rig Receipts', status: 'auto_publish_ready' }),
    platform: 'Blog' as const,
    risk_level: 'green' as const,
    classification: {
      level: 'green' as const,
      scores: { brand: 95, platform_safety: 95, strategic_quality: 95 },
      rule_hits: [],
      duplicate_similarity: 0,
      duplicate_of: null,
      template_exemption: null,
      rationale: 'clean',
      classified_at: new Date().toISOString(),
    },
  };
  testIds.push(id);
  writeItem(item);
  return item;
}

describe('correction path from auto_publish_ready', () => {
  it('permits auto_publish_ready → edited', () => {
    // Without this edge, green content found to carry a factual error before
    // scheduling could only be blocked (terminal) or expired (a false reason).
    assert.ok(canTransition('auto_publish_ready', 'edited'));
  });

  it('still routes edited back through brand check only', () => {
    assert.deepEqual([...(['brand_checked'] as const)].filter((s) => canTransition('edited', s)), ['brand_checked']);
    for (const forbidden of ['auto_publish_ready', 'scheduled', 'published', 'awaiting_founder_approval'] as const) {
      assert.equal(canTransition('edited', forbidden), false, `edited must not reach ${forbidden}`);
    }
  });

  it('leaves terminal states sealed', () => {
    for (const terminal of TERMINAL_STATES) {
      assert.equal(canTransition(terminal, 'edited'), false, `${terminal} must not gain an edit edge`);
    }
    assert.equal(canTransition('published', 'edited'), false, 'published is not correctable in place');
  });

  it('finds an item stored in content/approved and clears its classification', () => {
    const item = greenReadyItem('TEST-CORR-2026-08-04-001');
    assert.ok(existsSync(join(REPO_ROOT, 'content', 'approved', `${item.id}.json`)), 'fixture is in content/approved');

    const edited = editItem(item.id, { caption: 'corrected caption' }, 'Product capability unverified.');

    assert.equal(edited.status, 'edited');
    assert.equal(edited.classification, null, 'stale Green must not survive the edit');
    assert.equal(edited.approval, null);
    assert.equal(edited.caption, 'corrected caption');
    assert.equal(edited.founder_note, 'Product capability unverified.');
  });

  it('records the transition as a founder correction', () => {
    const item = greenReadyItem('TEST-CORR-2026-08-04-002');
    editItem(item.id, { caption: 'x' }, 'Claims need verification.');

    const log = join(REPO_ROOT, 'logs', 'state-transitions.jsonl');
    const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').slice(-12) : [];
    const entry = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((d) => d.content_id === item.id && d.to === 'edited');

    assert.ok(entry, 'transition was logged');
    assert.equal(entry.from, 'auto_publish_ready');
    assert.equal(entry.actor, 'founder');
    assert.equal(entry.reason, 'Claims need verification.');
  });

  it('refuses to publish an edited item until it is reclassified', async () => {
    const item = greenReadyItem('TEST-CORR-2026-08-04-003');
    const edited = editItem(item.id, { caption: 'y' }, 'Correction.');

    const attempt = await publishItem(edited, new BlogAdapter(), {
      AUTOPUBLISH_ENABLED: 'true',
      BLOG_AUTOPUBLISH_ENABLED: 'true',
    } as NodeJS.ProcessEnv);

    assert.equal(attempt.published, false, 'an edited item must not publish even with switches on');
    assert.match(attempt.reason, /not "auto_publish_ready"/);
    assert.equal(readItem(item.id)?.status, 'edited', 'still parked in edited');
  });
});
