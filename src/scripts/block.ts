#!/usr/bin/env node
/**
 *   npm run block TL-IG-2026-07-28-001 "Religious pressure risk."
 *
 * Blocking is terminal. `blocked` has no outgoing transition, so a blocked item
 * can never move back toward publication. To reuse the idea, draft it fresh.
 */

import { blockItem } from '../approval/queue.ts';

const [id, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(' ');

if (!id || !note) {
  console.error('Usage: npm run block <content-id> "reason"');
  console.error('');
  console.error('A reason is required — it becomes a brand-risk note for future generation.');
  process.exit(1);
}

try {
  const item = blockItem(id, note);
  console.log(`Blocked ${item.id} → ${item.status}`);
  console.log(`  Reason: ${note}`);
  console.log('');
  console.log('This is terminal. The item cannot be approved or revived; draft a new one instead.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
