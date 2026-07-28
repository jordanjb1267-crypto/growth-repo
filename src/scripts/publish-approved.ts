#!/usr/bin/env node
/**
 * Publish approved content.
 *
 * Phase 1 has no publisher adapters, so this cannot publish anything. It still
 * runs the full pre-publish gate, because that gate is a Phase 1 deliverable
 * and the founder should be able to see exactly what would and would not go out
 * before any adapter exists.
 *
 *   npm run publish:approved
 */

import { listItemsInState } from '../lib/store.ts';
import { checkPublishAllowed } from '../lib/killswitch.ts';

function main(): void {
  const ready = listItemsInState('auto_publish_ready');

  console.log('');
  console.log('PRE-PUBLISH GATE');
  console.log('─'.repeat(72));

  if (ready.length === 0) {
    console.log('Nothing approved and ready.');
    console.log('');
    return;
  }

  let wouldPublish = 0;
  let wouldHold = 0;

  for (const item of ready) {
    const check = checkPublishAllowed(item.platform);

    // Two independent refusals: the risk level and the kill switches. Neither
    // is sufficient on its own to let something out.
    if (item.risk_level === 'red') {
      console.log(`  ${item.id}  HOLD — classified Red. Red content cannot publish at all.`);
      wouldHold += 1;
      continue;
    }
    if (!check.allowed) {
      console.log(`  ${item.id}  HOLD — ${check.reason}`);
      wouldHold += 1;
      continue;
    }

    console.log(`  ${item.id}  READY — ${item.platform} (${check.reason})`);
    wouldPublish += 1;
  }

  console.log('');
  console.log(`${wouldPublish} item(s) would publish, ${wouldHold} held.`);
  console.log('');
  console.log('No publisher adapters exist yet (Phase 4), so nothing was sent.');
  console.log('See /audit/RISKY_CONNECTORS.md for which platforms are actually reachable');
  console.log('for a single-operator setup before building an adapter for them.');
  console.log('');
}

main();
