#!/usr/bin/env node
/**
 * Retract published content — the platform-warning path.
 *
 *   npm run retract RR-BLOG-2026-07-29-001 "Platform flagged the post."
 *
 * Does three things, per the spec's platform-warning rule:
 *   1. Moves the item to `retracted` (terminal — it never re-publishes).
 *   2. PAUSES the platform's connector, so nothing else goes out on that
 *      channel until the founder investigates and runs connector:resume.
 *   3. Records the reason as a founder note for the learning layer.
 *
 * What it cannot do: delete the post on the platform itself. Take the content
 * down there first (or confirm the platform already removed it) — this command
 * records that reality in our system, it does not create it.
 */

import { readItem, moveItem } from '../lib/store.ts';
import { transition } from '../state/machine.ts';
import { pauseConnector } from '../publish/adapter.ts';

const [id, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(' ');

if (!id || !note) {
  console.error('Usage: npm run retract <content-id> "reason (e.g. the platform warning text)"');
  console.error('');
  console.error('A reason is required — it pauses the connector and feeds the brand-risk record.');
  process.exit(1);
}

const item = readItem(id);
if (!item) {
  console.error(`No content item found with ID "${id}".`);
  process.exit(1);
}
if (item.published_at === null) {
  console.error(`${id} was never published (status: ${item.status}). Use reject or block for unpublished content.`);
  process.exit(1);
}

try {
  const previous = item.status;
  const retracted = transition(item, 'retracted', note, 'founder');
  moveItem({ ...retracted, founder_note: note }, previous);
  pauseConnector(item.platform, `Retraction of ${id}: ${note}`);

  console.log(`Retracted ${id} (was ${previous}).`);
  console.log(`Connector PAUSED: ${item.platform} — nothing publishes there until npm run connector:resume ${item.platform}`);
  console.log('');
  console.log('Reminder: this records the retraction on our side. If the post is still live on the');
  console.log('platform, take it down there too.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
