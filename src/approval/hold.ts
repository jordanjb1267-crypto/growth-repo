/**
 * Verification hold — parking content whose product claims cannot yet be
 * checked against a shipped implementation.
 *
 * This exists because `edited` could not do the job. `edited` is a
 * classifier-input state, so an item parked there was swept up by the next
 * scheduled `risk:classify` run and could route straight back to
 * auto-publish. A hold that undoes itself overnight is not a hold.
 *
 * Both operations go through `transition()` and the store, never a raw file
 * move, so the audit trail records actor, previous state, and reason the same
 * way every other state change does.
 */

import { moveItem, readItem } from '../lib/store.ts';
import { transition, TERMINAL_STATES } from '../state/machine.ts';
import type { ContentItem, ContentState } from '../lib/types.ts';

/** States a founder may place on hold. */
export const HOLDABLE_STATES = [
  'drafted',
  'edited',
  'awaiting_founder_approval',
  'auto_publish_ready',
] as const satisfies readonly ContentState[];

export class HoldError extends Error {}

function locate(id: string, allowed: readonly ContentState[], verb: string): ContentItem {
  const item = readItem(id);
  if (!item) throw new HoldError(`No content item with id "${id}".`);

  if (!allowed.includes(item.status)) {
    const terminal = (TERMINAL_STATES as readonly string[]).includes(item.status);
    throw new HoldError(
      `"${id}" is in "${item.status}"${terminal ? ' (terminal)' : ''}, which cannot be ${verb}. ` +
        `Eligible states: ${allowed.join(', ')}.`,
    );
  }
  return item;
}

/**
 * Place an item on verification hold.
 *
 * Classification and approval are cleared: both describe a judgement made
 * about claims now known to be unverified, and leaving them in place would let
 * a later reader — or a later code path — treat the item as still vetted.
 */
export function holdItem(id: string, reason: string): ContentItem {
  const trimmed = reason.trim();
  if (!trimmed) throw new HoldError('A hold requires a non-empty reason.');

  const item = locate(id, HOLDABLE_STATES, 'held');
  const previous = item.status;

  const held = transition(item, 'verification_hold', trimmed, 'founder');
  const persisted: ContentItem = {
    ...held,
    classification: null,
    approval: null,
    founder_note: trimmed,
  };
  moveItem(persisted, previous);
  return persisted;
}

/**
 * Release a held item back to `edited`.
 *
 * `edited` is the only exit toward publication, and its single onward edge is
 * `brand_checked` — so a released item must be re-classified before it can go
 * anywhere. That is the point: the claims that caused the hold get examined
 * again rather than inherited.
 */
export function releaseItem(id: string, reason: string): ContentItem {
  const trimmed = reason.trim();
  if (!trimmed) throw new HoldError('A release requires a non-empty reason.');

  const item = locate(id, ['verification_hold'], 'released');

  const released = transition(item, 'edited', trimmed, 'founder');
  const persisted: ContentItem = {
    ...released,
    classification: null,
    approval: null,
    founder_note: trimmed,
  };
  moveItem(persisted, 'verification_hold');
  return persisted;
}
