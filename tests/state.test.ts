import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canTransition,
  IllegalTransitionError,
  legalTransitionsFrom,
  STATE_DIRECTORIES,
  TERMINAL_STATES,
  transition,
} from '../src/state/machine.ts';
import { CONTENT_STATES, type ContentState } from '../src/lib/types.ts';
import { draftItem } from './helpers.ts';

describe('state machine', () => {
  it('advances an item along a legal edge', () => {
    const item = draftItem({ id: 'T-1', product: 'Rig Receipts' });
    const moved = transition(item, 'brand_checked', 'test');
    assert.equal(moved.status, 'brand_checked');
  });

  it('does not mutate the original item', () => {
    const item = draftItem({ id: 'T-2', product: 'Rig Receipts' });
    transition(item, 'brand_checked', 'test');
    assert.equal(item.status, 'drafted', 'transition() must return a new item, not mutate in place');
  });

  it('throws on every illegal edge', () => {
    let illegalChecked = 0;

    for (const from of CONTENT_STATES) {
      for (const to of CONTENT_STATES) {
        if (canTransition(from, to)) continue;
        illegalChecked += 1;

        const item = draftItem({ id: `T-illegal-${from}-${to}`, product: 'Rig Receipts', status: from });
        assert.throws(
          () => transition(item, to, 'test'),
          IllegalTransitionError,
          `expected "${from}" -> "${to}" to be rejected`,
        );
      }
    }

    assert.ok(illegalChecked > 100, 'sanity: the illegal-edge set should be large');
  });

  it('routes a founder edit back into brand checking', () => {
    // This is the edge that stops an edit from bypassing the classifier.
    // `verification_hold` is the only other exit, and it is a parking state
    // whose own exits are `edited` and `rejected` — so neither route lets an
    // edit reach publication without being classified again.
    assert.deepEqual([...legalTransitionsFrom('edited')].sort(), ['brand_checked', 'verification_hold']);
    assert.ok(legalTransitionsFrom('edited').includes('brand_checked'));

    const item = draftItem({ id: 'T-3', product: 'Tilawah Lock', status: 'edited' });
    const moved = transition(item, 'brand_checked', 'test');
    assert.equal(moved.status, 'brand_checked');

    for (const forbidden of ['auto_publish_ready', 'scheduled', 'published'] as ContentState[]) {
      assert.throws(() => transition(item, forbidden, 'test'), IllegalTransitionError);
    }
  });

  it('makes blocked terminal so red content has no route back toward publication', () => {
    assert.deepEqual(legalTransitionsFrom('blocked'), []);

    const item = draftItem({ id: 'T-4', product: 'Tilawah Lock', status: 'blocked' });
    for (const to of CONTENT_STATES) {
      assert.throws(() => transition(item, to, 'test'), IllegalTransitionError);
    }
  });

  it('has no outgoing edges from any terminal state', () => {
    for (const state of TERMINAL_STATES) {
      assert.deepEqual(legalTransitionsFrom(state), [], `${state} should be terminal`);
    }
  });

  it('gives every state a content directory', () => {
    for (const state of CONTENT_STATES) {
      assert.ok(STATE_DIRECTORIES[state], `${state} has no directory mapping`);
    }
  });

  it('reaches published only via scheduled', () => {
    const inbound = CONTENT_STATES.filter((from) => canTransition(from, 'published'));
    assert.deepEqual(inbound, ['scheduled']);
  });

  it('lets a failed publish retry but never skip to published', () => {
    assert.ok(canTransition('publish_failed', 'scheduled'));
    assert.ok(!canTransition('publish_failed', 'published'));
  });
});
