#!/usr/bin/env node
/**
 * Generate the daily content set for both products.
 *
 *   npm run content:generate
 *
 * Items land in content/drafts/ in `drafted` state. Nothing here classifies or
 * routes — run `npm run risk:classify` next.
 */

import { generateForProduct } from '../content/generate.ts';
import { PRODUCTS } from '../lib/types.ts';

async function main(): Promise<void> {
  let totalCreated = 0;
  let failures = 0;

  for (const product of PRODUCTS) {
    console.log(`Generating for ${product}…`);
    try {
      const result = await generateForProduct(product);
      totalCreated += result.created.length;

      for (const item of result.created) {
        const tag = item.template_id ? `template ${item.template_id}` : item.platform;
        console.log(`  ${item.id}  ${tag} · ${item.campaign}`);
      }
      for (const skip of result.skipped) {
        console.log(`  skipped ${skip.kind}: ${skip.reason}`);
      }
      if (result.aso_idea) console.log(`  idea → analytics/daily (ASO/landing)`);
    } catch (error) {
      failures += 1;
      console.error(`  FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('');
  }

  console.log(`Created ${totalCreated} draft(s).`);
  if (totalCreated > 0) console.log('Next: npm run risk:classify');
  if (failures > 0) process.exitCode = 1;
}

await main();
