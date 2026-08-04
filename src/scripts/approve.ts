#!/usr/bin/env node
/**
 *   npm run approve TL-IG-2026-07-28-001
 *   npm run approve TL-IG-2026-07-28-001 "Softened the second line first."
 */

import { approveItem } from '../approval/queue.ts';

const [id, ...noteParts] = process.argv.slice(2);

if (!id) {
  console.error('Usage: npm run approve <content-id> ["optional note"]');
  process.exit(1);
}

try {
  const item = approveItem(id, noteParts.join(' ') || undefined);
  console.log(`Approved ${item.id} → ${item.status}`);
  console.log(`  ${item.product} · ${item.platform} · ${item.campaign}`);
  console.log('');
  console.log('It will publish on the next `npm run publish:approved`, provided the kill switches allow it.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
