/**
 * Content state machine.
 *
 * `transition()` is the ONLY function in this codebase permitted to write
 * `ContentItem.status`. Everything else must route through it. That constraint
 * is what makes the spec's Acceptance Criterion 3 — "every content item goes
 * through the state machine" — actually enforceable rather than aspirational.
 *
 * Every transition is appended to logs/state-transitions.jsonl before the item
 * is written, so the audit trail survives a crash mid-write.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from '../lib/paths.ts';
import type { ContentItem, ContentState, TransitionRecord } from '../lib/types.ts';

/**
 * Legal transitions. An edge that is not listed here throws.
 *
 * Two properties are load-bearing for safety:
 *
 *   1. `edited` routes back to `brand_checked`, never forward to an approval
 *      or publish state. A founder editing a queued item cannot thereby skip
 *      re-classification.
 *   2. `blocked` is terminal. The spec says Red content cannot publish at all;
 *      giving `blocked` any outgoing edge would create a route back toward
 *      publication. To resurrect blocked content, create a new item.
 */
const LEGAL: Record<ContentState, readonly ContentState[]> = {
  drafted: ['brand_checked', 'blocked'],
  brand_checked: ['risk_classified', 'blocked'],
  risk_classified: ['auto_publish_ready', 'awaiting_founder_approval', 'blocked'],

  auto_publish_ready: ['scheduled', 'blocked', 'expired'],
  awaiting_founder_approval: [
    'auto_publish_ready',
    'rejected',
    'blocked',
    'edited',
    'expired',
  ],

  // Re-enters classification. This is the edge that stops founder edits from
  // bypassing the risk classifier.
  edited: ['brand_checked'],

  scheduled: ['published', 'publish_failed', 'blocked'],
  publish_failed: ['scheduled', 'blocked'],
  published: ['analytics_collected', 'retracted'],
  // A platform warning can arrive at any point after publication — including
  // long after learning completed — so every post-publication state keeps a
  // path to `retracted`.
  analytics_collected: ['learned_from', 'retracted'],
  learned_from: ['memory_updated', 'retracted'],
  memory_updated: ['retracted'],

  rejected: ['edited'],
  expired: ['edited', 'rejected'],
  retracted: [],
  blocked: [],
};

/** States from which no further transition is possible. */
export const TERMINAL_STATES: readonly ContentState[] = ['blocked', 'retracted'];

/**
 * On-disk home for each state. Items are moved between these directories as
 * they transition, so the filesystem itself reflects the queue.
 */
export const STATE_DIRECTORIES: Record<ContentState, string> = {
  drafted: 'content/drafts',
  brand_checked: 'content/drafts',
  risk_classified: 'content/drafts',
  auto_publish_ready: 'content/approved',
  awaiting_founder_approval: 'content/approval-queue',
  edited: 'content/drafts',
  scheduled: 'content/scheduled',
  published: 'content/published',
  publish_failed: 'content/scheduled',
  analytics_collected: 'content/published',
  learned_from: 'content/published',
  memory_updated: 'content/published',
  rejected: 'content/rejected',
  expired: 'content/rejected',
  retracted: 'content/blocked',
  blocked: 'content/blocked',
};

export class IllegalTransitionError extends Error {
  readonly from: ContentState;
  readonly to: ContentState;

  constructor(from: ContentState, to: ContentState) {
    const allowed = LEGAL[from];
    const detail =
      allowed.length === 0
        ? `"${from}" is a terminal state and has no legal transitions`
        : `legal transitions from "${from}" are: ${allowed.join(', ')}`;
    super(`Illegal state transition "${from}" -> "${to}": ${detail}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: ContentState, to: ContentState): boolean {
  return LEGAL[from].includes(to);
}

export function legalTransitionsFrom(from: ContentState): readonly ContentState[] {
  return LEGAL[from];
}

const TRANSITION_LOG = join(REPO_ROOT, 'logs', 'state-transitions.jsonl');

function appendTransitionLog(record: TransitionRecord): void {
  mkdirSync(dirname(TRANSITION_LOG), { recursive: true });
  appendFileSync(TRANSITION_LOG, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Move an item to a new state.
 *
 * Returns a new item rather than mutating, so a caller that fails to persist
 * cannot leave a half-applied status in memory. Throws IllegalTransitionError
 * on any edge not in the table above.
 */
export function transition(
  item: ContentItem,
  to: ContentState,
  reason: string,
  actor: 'system' | 'founder' = 'system',
): ContentItem {
  if (!canTransition(item.status, to)) {
    throw new IllegalTransitionError(item.status, to);
  }

  const at = new Date().toISOString();

  // Log before returning: an audit record for a transition the caller then
  // fails to persist is recoverable; a persisted transition with no audit
  // record is not.
  appendTransitionLog({
    content_id: item.id,
    from: item.status,
    to,
    reason,
    actor,
    at,
  });

  return { ...item, status: to, updated_at: at };
}
