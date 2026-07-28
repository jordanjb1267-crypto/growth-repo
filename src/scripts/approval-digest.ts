#!/usr/bin/env node
/**
 * Render the pending approval queue to the terminal.
 *
 *   npm run approval:digest
 */

import { listItemsInState } from '../lib/store.ts';
import { checkPublishAllowed } from '../lib/killswitch.ts';
import type { ContentItem } from '../lib/types.ts';

function divider(char = '─'): string {
  return char.repeat(72);
}

function renderItem(item: ContentItem): string {
  const lines: string[] = [];
  const c = item.classification;

  lines.push(divider());
  lines.push(`${item.id}   [${item.risk_level.toUpperCase()}]   ${item.product} · ${item.platform}`);
  lines.push(`Campaign: ${item.campaign}`);
  lines.push('');
  lines.push(`  Hook:    ${item.hook}`);
  lines.push(`  Caption: ${item.caption}`);
  lines.push(`  CTA:     ${item.cta}`);

  if (item.full_content) {
    lines.push('');
    for (const line of item.full_content.split('\n')) lines.push(`  │ ${line}`);
  }

  lines.push('');
  lines.push(`  Why held: ${item.approval_reason}`);

  if (c) {
    if (c.rule_hits.length > 0) {
      lines.push('  Rules fired:');
      for (const hit of c.rule_hits) {
        lines.push(`    · [${hit.level}] ${hit.id} — ${hit.reason}`);
        lines.push(`        matched: ${hit.evidence}`);
      }
    }
    if (c.scores) {
      lines.push(
        `  Scores: brand ${c.scores.brand} · platform-safety ${c.scores.platform_safety} · strategic-quality ${c.scores.strategic_quality}  (threshold 85)`,
      );
    } else {
      lines.push('  Scores: unavailable — held for review rather than assumed safe.');
    }
    if (c.duplicate_of) {
      lines.push(`  Duplicate: ${(c.duplicate_similarity * 100).toFixed(0)}% similar to ${c.duplicate_of}`);
    }
    if (c.template_exemption) {
      lines.push(
        `  Template exemption: ${c.template_exemption.template_id}, approved by ${c.template_exemption.approved_by}`,
      );
    }
  }

  lines.push('');
  lines.push(`  Recommended: ${item.recommended_action}`);
  lines.push('');
  lines.push(`    npm run approve ${item.id}`);
  lines.push(`    npm run reject  ${item.id} "reason"`);
  lines.push(`    npm run block   ${item.id} "reason"`);

  return lines.join('\n');
}

function main(): void {
  const pending = listItemsInState('awaiting_founder_approval');
  const ready = listItemsInState('auto_publish_ready');
  const blocked = listItemsInState('blocked');

  console.log('');
  console.log(divider('═'));
  console.log(`APPROVAL DIGEST — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  console.log(divider('═'));
  console.log(`  ${pending.length} awaiting approval · ${ready.length} approved and ready · ${blocked.length} blocked`);

  // Surface the publish posture up front. An operator looking at approved
  // content should know immediately whether anything can actually go out.
  const global = process.env.AUTOPUBLISH_ENABLED === 'true';
  console.log(`  AUTOPUBLISH_ENABLED=${global ? 'true' : 'false (nothing will publish)'}`);

  if (ready.length > 0) {
    const platforms = [...new Set(ready.map((i) => i.platform))];
    for (const platform of platforms) {
      const check = checkPublishAllowed(platform);
      console.log(`    ${platform}: ${check.allowed ? 'enabled' : `blocked — ${check.reason}`}`);
    }
  }

  if (pending.length === 0) {
    console.log('');
    console.log('Nothing awaiting approval.');
    console.log('');
    return;
  }

  for (const item of pending) {
    console.log('');
    console.log(renderItem(item));
  }

  console.log('');
  console.log(divider());
  console.log('');
}

main();
