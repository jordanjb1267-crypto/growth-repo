#!/usr/bin/env node
/**
 * Run every unclassified draft through brand check and risk classification,
 * then route it to the state its level demands.
 *
 *   npm run risk:classify
 *   npm run risk:classify -- --no-scoring    (deterministic only; fails closed to Yellow)
 *
 * Picks up items in `drafted`, `edited`, and `brand_checked`. Edited items land
 * here because `edited` routes back to `brand_checked` — that is the edge that
 * stops a founder edit from bypassing classification.
 */

import { classify } from '../risk/classify.ts';
import { routeFor } from '../risk/route.ts';
import { deriveExemption } from '../templates/template.ts';
import { listItemsInState, moveItem } from '../lib/store.ts';
import { transition } from '../state/machine.ts';
import type { ContentItem, ContentState, RiskLevel } from '../lib/types.ts';

const skipScoring = process.argv.includes('--no-scoring');

function recommendedAction(level: RiskLevel): string {
  switch (level) {
    case 'green':
      return 'auto-publish eligible';
    case 'yellow':
      return 'approve after founder review';
    case 'red':
      return 'blocked — do not publish';
  }
}

async function processItem(item: ContentItem): Promise<{ id: string; level: RiskLevel; to: ContentState }> {
  let current = item;

  // Advance to brand_checked first so the recorded history shows the item
  // passing through every stage rather than jumping the machine.
  if (current.status === 'drafted' || current.status === 'edited') {
    const previous = current.status;
    current = transition(current, 'brand_checked', 'Entering brand check.');
    moveItem(current, previous);
  }

  // The exemption is re-derived here, never read from a stored record: the
  // template is re-loaded and re-rendered with the item's slot values, and the
  // output compared against the item's actual text. Any drift — template
  // edited, rules evolved, item text changed — silently voids it.
  const exemption = deriveExemption(current);

  const classification = await classify(
    {
      id: current.id,
      product: current.product,
      platform: current.platform,
      campaign: current.campaign,
      hook: current.hook,
      body: current.full_content,
      caption: current.caption,
      cta: current.cta,
      templateExemption: exemption,
    },
    { skipScoring },
  );

  const route = routeFor(classification.level, current.platform);

  const beforeClassified = current.status;
  current = transition(current, 'risk_classified', 'Classification complete.');
  current = {
    ...current,
    classification,
    risk_level: classification.level,
    approval_reason: route.note ? `${classification.rationale} ${route.note}` : classification.rationale,
    recommended_action: route.note ? 'post manually if wanted — this channel never auto-publishes' : recommendedAction(classification.level),
  };
  moveItem(current, beforeClassified);

  const beforeRoute = current.status;
  current = transition(current, route.to, route.note ?? classification.rationale);
  moveItem(current, beforeRoute);

  return { id: current.id, level: classification.level, to: route.to };
}

async function main(): Promise<void> {
  const queue = [
    ...listItemsInState('drafted'),
    ...listItemsInState('edited'),
    ...listItemsInState('brand_checked'),
  ];

  if (queue.length === 0) {
    console.log('Nothing to classify.');
    return;
  }

  if (skipScoring) {
    console.log('Running without rubric scoring — every item will fail closed to Yellow.');
  }

  const counts: Record<RiskLevel, number> = { green: 0, yellow: 0, red: 0 };
  let failures = 0;

  for (const item of queue) {
    try {
      const result = await processItem(item);
      counts[result.level] += 1;
      console.log(`  ${result.id}  ${result.level.padEnd(6)} → ${result.to}`);
    } catch (error) {
      failures += 1;
      // One bad item must not stop the batch, but it must be loud and it must
      // not be counted as classified.
      console.error(`  ${item.id}  FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('');
  console.log(`Classified ${counts.green + counts.yellow + counts.red} item(s): ${counts.green} green, ${counts.yellow} yellow, ${counts.red} red.`);
  if (failures > 0) {
    console.error(`${failures} item(s) failed to classify and remain in their previous state.`);
    process.exitCode = 1;
  }
  if (counts.yellow > 0) console.log('Run `npm run approval:digest` to review the queue.');
}

await main();
