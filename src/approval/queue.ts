/**
 * Approval queue operations.
 *
 * Every operation here routes through `transition()`, so no path in this module
 * can move an item into a state the machine forbids. The one that matters most
 * is `editItem`: it sends the item to `edited`, whose only outgoing edge is back
 * to `brand_checked`. A founder cannot edit content into a publishable state.
 */

import { moveItem, readItem } from '../lib/store.ts';
import { transition } from '../state/machine.ts';
import type { ContentItem } from '../lib/types.ts';

export class ItemNotFoundError extends Error {
  constructor(id: string) {
    super(`No content item found with ID "${id}".`);
    this.name = 'ItemNotFoundError';
  }
}

function load(id: string): ContentItem {
  const item = readItem(id);
  if (!item) throw new ItemNotFoundError(id);
  return item;
}

function persist(item: ContentItem, previousStatus: ContentItem['status']): ContentItem {
  moveItem(item, previousStatus);
  return item;
}

/**
 * Approve a queued item.
 *
 * Approval moves it to `auto_publish_ready` — the same state Green content
 * reaches — because from here the two are genuinely equivalent: both still have
 * to clear the kill switches at publish time.
 */
export function approveItem(id: string, note?: string): ContentItem {
  const item = load(id);
  const previous = item.status;

  if (item.risk_level === 'red') {
    // Belt and braces: the state machine already forbids blocked -> anything,
    // but Red content that somehow reached the queue must not be approvable.
    throw new Error(
      `Item ${id} is classified Red and cannot be approved. Red content cannot publish at all. Rules fired: ${
        item.classification?.rule_hits.filter((h) => h.level === 'red').map((h) => h.id).join(', ') ?? 'unknown'
      }`,
    );
  }

  const approved = transition(item, 'auto_publish_ready', note ?? 'Founder approved.', 'founder');
  return persist(
    {
      ...approved,
      founder_note: note ?? null,
      approval: { by: 'founder', at: new Date().toISOString(), note: note ?? null },
    },
    previous,
  );
}

export function rejectItem(id: string, note: string): ContentItem {
  const item = load(id);
  const previous = item.status;
  const rejected = transition(item, 'rejected', note, 'founder');
  return persist({ ...rejected, founder_note: note }, previous);
}

export function blockItem(id: string, note: string): ContentItem {
  const item = load(id);
  const previous = item.status;
  const blocked = transition(item, 'blocked', note, 'founder');
  return persist({ ...blocked, risk_level: 'red', founder_note: note }, previous);
}

/**
 * Apply a founder edit.
 *
 * Returns the item in `edited`, from which the only legal move is
 * `brand_checked`. The caller is expected to re-run classification; nothing here
 * can shortcut to approval.
 */
export function editItem(
  id: string,
  changes: Partial<Pick<ContentItem, 'hook' | 'full_content' | 'caption' | 'cta'>>,
  note?: string,
): ContentItem {
  const item = load(id);
  const previous = item.status;

  const edited = transition(
    item,
    'edited',
    note ?? 'Founder edited; re-entering brand check and classification.',
    'founder',
  );

  return persist(
    {
      ...edited,
      ...changes,
      // The old classification and approval described different text. Clearing
      // both prevents a stale Green — or a stale approval — being read as
      // covering the new content.
      classification: null,
      approval: null,
      founder_note: note ?? null,
    },
    previous,
  );
}

/** Items whose approval request has aged past `maxAgeHours`. */
export function findExpired(items: ContentItem[], maxAgeHours: number, now = Date.now()): ContentItem[] {
  const cutoff = now - maxAgeHours * 3_600_000;
  return items.filter((item) => Date.parse(item.updated_at) < cutoff);
}

export function expireItem(id: string, maxAgeHours: number): ContentItem {
  const item = load(id);
  const previous = item.status;
  const expired = transition(
    item,
    'expired',
    `No founder decision within ${maxAgeHours}h; expired rather than left publishable.`,
  );
  return persist(expired, previous);
}
