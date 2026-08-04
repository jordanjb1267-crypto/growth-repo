#!/usr/bin/env node
/**
 * Generate the daily content set for both products.
 *
 *   npm run content:generate
 *
 * Items land in content/drafts/ in `drafted` state. Nothing here classifies or
 * routes — run `npm run risk:classify` next.
 *
 * Fail-closed reporting. A product that produces zero items is a FAILURE, not a
 * quiet no-op, and there are two ways to get there:
 *
 *   - generateForProduct throws (unparseable model output, provider error)
 *   - it returns cleanly with an empty set (model returned `items: []`, or
 *     every item was skipped as malformed)
 *
 * The second used to exit 0, which meant a scheduled run logged `done` while
 * half the content operation had silently produced nothing. Both now set a
 * non-zero exit so the scheduler records FAIL, and every run appends a record
 * to logs/generation-runs.jsonl so the outcome is inspectable after the fact
 * rather than only in whatever console output happened to be captured.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateForProduct } from '../content/generate.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { PRODUCTS } from '../lib/types.ts';
import type { Product } from '../lib/types.ts';

const RUN_LOG = join(REPO_ROOT, 'logs', 'generation-runs.jsonl');

interface ProductOutcome {
  product: Product;
  ok: boolean;
  created: number;
  skipped: { kind: string; reason: string }[];
  error: string | null;
}

function recordRun(outcomes: ProductOutcome[]): void {
  mkdirSync(dirname(RUN_LOG), { recursive: true });
  appendFileSync(
    RUN_LOG,
    `${JSON.stringify({
      at: new Date().toISOString(),
      ok: outcomes.every((o) => o.ok),
      products: outcomes.map((o) => ({
        product: o.product,
        ok: o.ok,
        created: o.created,
        skipped: o.skipped.length,
        error: o.error,
      })),
    })}\n`,
    'utf8',
  );
}

async function main(): Promise<void> {
  const outcomes: ProductOutcome[] = [];

  for (const product of PRODUCTS) {
    console.log(`Generating for ${product}…`);
    try {
      const result = await generateForProduct(product);

      for (const item of result.created) {
        const tag = item.template_id ? `template ${item.template_id}` : item.platform;
        console.log(`  ${item.id}  ${tag} · ${item.campaign}`);
      }
      for (const skip of result.skipped) {
        console.log(`  skipped ${skip.kind}: ${skip.reason}`);
      }
      if (result.aso_idea) console.log(`  idea → analytics/daily (ASO/landing)`);

      // Zero items is a failure even though nothing threw: an enabled product
      // that generated nothing is an outage for that product, and reporting it
      // as success is how a broken half of the operation stays invisible.
      if (result.created.length === 0) {
        console.error(
          `  FAILED — ${product} produced 0 items (${result.skipped.length} skipped). The model returned no usable content.`,
        );
        outcomes.push({
          product,
          ok: false,
          created: 0,
          skipped: result.skipped,
          error: 'zero valid items',
        });
      } else if (result.aso_idea_error) {
        // Content drafts survive — they are independently valid and the
        // existing partial-output policy keeps them. The run is still a
        // failure, because an incomplete strategy artifact reported as success
        // is exactly the gap this check exists to close.
        console.error(`  INCOMPLETE — strategy idea rejected: ${result.aso_idea_error}`);
        console.error(`  ${result.created.length} content draft(s) kept; nothing written to analytics/daily for ${product}.`);
        outcomes.push({
          product,
          ok: false,
          created: result.created.length,
          skipped: result.skipped,
          error: `incomplete aso_idea: ${result.aso_idea_error}`,
        });
      } else {
        outcomes.push({ product, ok: true, created: result.created.length, skipped: result.skipped, error: null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED — ${message}`);
      outcomes.push({ product, ok: false, created: 0, skipped: [], error: message });
    }
    console.log('');
  }

  recordRun(outcomes);

  const totalCreated = outcomes.reduce((sum, o) => sum + o.created, 0);
  const failed = outcomes.filter((o) => !o.ok);

  console.log(`Created ${totalCreated} draft(s) across ${outcomes.length} product(s).`);
  for (const outcome of failed) {
    console.error(`FAILED: ${outcome.product} — ${outcome.error}`);
  }

  if (failed.length > 0) {
    console.error(
      `${failed.length} of ${outcomes.length} product(s) did not complete cleanly. This run is a FAILURE; see ${RUN_LOG}.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Next: npm run risk:classify');
}

await main();
