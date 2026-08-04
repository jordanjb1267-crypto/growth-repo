#!/usr/bin/env node
/**
 *   npm run reject TL-IG-2026-07-28-001 "Make this softer and less guilt-based."
 */

import { rejectItem } from '../approval/queue.ts';

const [id, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(' ');

if (!id || !note) {
  console.error('Usage: npm run reject <content-id> "reason"');
  console.error('');
  console.error('A reason is required. It feeds the objection bank and the brand-rule updates,');
  console.error('so a rejection without one loses the only signal the rejection carried.');
  process.exit(1);
}

try {
  const item = rejectItem(id, note);
  console.log(`Rejected ${item.id} → ${item.status}`);
  console.log(`  Reason: ${note}`);
  console.log('');
  console.log(`To revise instead of discarding: npm run edit ${item.id}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
