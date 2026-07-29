#!/usr/bin/env node
/**
 * Render the pending approval queue to the terminal.
 *
 *   npm run approval:digest            # terminal only
 *   npm run approval:digest -- --email # also email it to the founder
 *
 * The email path sends the digest to FOUNDER_EMAIL via Resend when
 * RESEND_API_KEY, EMAIL_FROM_ADDRESS, and FOUNDER_EMAIL are all set — it is a
 * notification to the founder themselves, not marketing, so it is not behind
 * the marketing kill switches. With --email but missing config it says so and
 * still prints; the scheduler passes --email unconditionally for this reason.
 */

import { loadEnvFile } from '../lib/env-file.ts';
import { listItemsInState } from '../lib/store.ts';
import { checkPublishAllowed } from '../lib/killswitch.ts';
import type { ContentItem } from '../lib/types.ts';

loadEnvFile();

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

function buildDigest(): { text: string; pendingCount: number } {
  const pending = listItemsInState('awaiting_founder_approval');
  const ready = listItemsInState('auto_publish_ready');
  const blocked = listItemsInState('blocked');
  const lines: string[] = [];

  lines.push(divider('═'));
  lines.push(`APPROVAL DIGEST — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  lines.push(divider('═'));
  lines.push(`  ${pending.length} awaiting approval · ${ready.length} approved and ready · ${blocked.length} blocked`);

  // Surface the publish posture up front. An operator looking at approved
  // content should know immediately whether anything can actually go out.
  const global = process.env.AUTOPUBLISH_ENABLED === 'true';
  lines.push(`  AUTOPUBLISH_ENABLED=${global ? 'true' : 'false (nothing will publish)'}`);

  if (ready.length > 0) {
    const platforms = [...new Set(ready.map((i) => i.platform))];
    for (const platform of platforms) {
      const check = checkPublishAllowed(platform);
      lines.push(`    ${platform}: ${check.allowed ? 'enabled' : `blocked — ${check.reason}`}`);
    }
  }

  if (pending.length === 0) {
    lines.push('');
    lines.push('Nothing awaiting approval.');
  } else {
    for (const item of pending) {
      lines.push('');
      lines.push(renderItem(item));
    }
    lines.push('');
    lines.push(divider());
  }

  return { text: lines.join('\n'), pendingCount: pending.length };
}

async function emailDigest(text: string, pendingCount: number): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  const to = process.env.FOUNDER_EMAIL;
  if (!key || !from || !to) {
    console.log('(--email requested but RESEND_API_KEY / EMAIL_FROM_ADDRESS / FOUNDER_EMAIL are not all set — printed only.)');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Approval digest — ${pendingCount} item(s) waiting`,
      text,
    }),
  });
  console.log(response.ok ? `Digest emailed to FOUNDER_EMAIL.` : `Digest email failed (${response.status}) — printed above regardless.`);
}

async function main(): Promise<void> {
  const digest = buildDigest();
  console.log('');
  console.log(digest.text);
  console.log('');

  if (process.argv.includes('--email')) {
    await emailDigest(digest.text, digest.pendingCount);
  }
}

await main();
