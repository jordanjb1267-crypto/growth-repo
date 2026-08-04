#!/usr/bin/env node
/**
 * Run unclassified drafts through brand check and risk classification, then
 * route each to the state its level demands.
 *
 *   npm run risk:classify                      every eligible item
 *   npm run risk:classify -- --only <id>       exactly one item
 *   npm run risk:classify -- --no-scoring      deterministic only; fails closed to Yellow
 *
 * Picks up items in `drafted`, `edited`, and `brand_checked`. Edited items land
 * here because `edited` routes back to `brand_checked` — that is the edge that
 * stops a founder edit from bypassing classification.
 *
 * `--only` exists because the unscoped command is all-or-nothing over those
 * three states, and items are legitimately parked in `edited` — a founder
 * correction awaiting product verification looks exactly like a fresh draft to
 * the queue builder. Running the plain command then reclassifies the held item
 * and can route it straight back to auto-publish, which is how a deliberate
 * hold gets silently undone. Scoping is the fix; the unscoped form is
 * unchanged for the daily run.
 */

import { classify } from '../risk/classify.ts';
import { routeFor } from '../risk/route.ts';
import { deriveExemption } from '../templates/template.ts';
import { listItemsInState, moveItem, readItem } from '../lib/store.ts';
import { transition, TERMINAL_STATES } from '../state/machine.ts';
import { realpathSync } from 'node:fs';
import type { ContentItem, ContentState, RiskLevel } from '../lib/types.ts';

/**
 * The only states an item may be classified from.
 *
 * Deliberately excludes every post-classification and terminal state. There is
 * no flag that adds to this list: re-running the classifier over `published`,
 * `rejected`, or `blocked` content is never a correct operation, and a
 * published item that needs revisiting has `retracted` for that.
 */
export const CLASSIFIER_INPUT_STATES = ['drafted', 'edited', 'brand_checked'] as const satisfies readonly ContentState[];

export const USAGE = [
  'Usage:',
  '  npm run risk:classify                    classify every eligible item',
  '  npm run risk:classify -- --only <id>     classify exactly one item',
  '  npm run risk:classify -- --no-scoring    deterministic rules only (fails closed to Yellow)',
  '',
  `Eligible states: ${CLASSIFIER_INPUT_STATES.join(', ')}`,
].join('\n');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export interface ClassifyArgs {
  only: string | null;
  skipScoring: boolean;
}

export type ParseResult = { ok: true; args: ClassifyArgs } | { ok: false; error: string };

export function parseClassifyArgs(argv: readonly string[]): ParseResult {
  let only: string | null = null;
  let skipScoring = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-scoring') skipScoring = true;
    else if (arg === '--only') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { ok: false, error: `--only requires a content id.\n\n${USAGE}` };
      only = value;
      i += 1;
    } else if (arg?.startsWith('--only=')) {
      only = arg.slice('--only='.length);
      if (!only) return { ok: false, error: `--only requires a content id.\n\n${USAGE}` };
    } else {
      return { ok: false, error: `Unknown argument: ${arg}\n\n${USAGE}` };
    }
  }

  return { ok: true, args: { only, skipScoring } };
}

// ---------------------------------------------------------------------------
// Queue selection
// ---------------------------------------------------------------------------

export type QueueLoader = (state: ContentState) => ContentItem[];
export type ItemFinder = (id: string) => ContentItem | null;

export type QueueResult = { ok: true; queue: ContentItem[] } | { ok: false; error: string };

/**
 * Build the work list.
 *
 * With `--only`, the item is located strictly within the eligible states. An id
 * that exists elsewhere is reported with its actual state rather than treated
 * as missing, because "it is rejected" and "it does not exist" call for
 * different responses. Nothing outside the returned list is read, moved, or
 * written.
 */
export function buildQueue(
  only: string | null,
  load: QueueLoader = listItemsInState,
  find: ItemFinder = readItem,
): QueueResult {
  const eligible = CLASSIFIER_INPUT_STATES.flatMap((state) => load(state));

  if (only === null) return { ok: true, queue: eligible };

  const matches = eligible.filter((item) => item.id === only);
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Ambiguous: "${only}" matched ${matches.length} items across ${CLASSIFIER_INPUT_STATES.join('/')}. Refusing to guess which one you meant.`,
    };
  }
  if (matches.length === 1) return { ok: true, queue: matches };

  const elsewhere = find(only);
  if (!elsewhere) {
    return { ok: false, error: `No content item with id "${only}".` };
  }
  const terminal = (TERMINAL_STATES as readonly string[]).includes(elsewhere.status);
  return {
    ok: false,
    error:
      `"${only}" is in "${elsewhere.status}"${terminal ? ' (terminal)' : ''}, which is not a classifier input state. ` +
      `Eligible states: ${CLASSIFIER_INPUT_STATES.join(', ')}.`,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

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

export async function processItem(
  item: ContentItem,
  options: { skipScoring?: boolean } = {},
): Promise<{ id: string; level: RiskLevel; to: ContentState }> {
  const { skipScoring = false } = options;
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

export type ItemProcessor = (
  item: ContentItem,
  options: { skipScoring?: boolean },
) => Promise<{ id: string; level: RiskLevel; to: ContentState }>;

export interface RunSummary {
  counts: Record<RiskLevel, number>;
  failures: number;
}

export async function runClassification(
  queue: readonly ContentItem[],
  options: { skipScoring?: boolean; process?: ItemProcessor; log?: (line: string) => void; error?: (line: string) => void } = {},
): Promise<RunSummary> {
  const {
    skipScoring = false,
    process: processor = processItem,
    log = console.log,
    error = console.error,
  } = options;

  const counts: Record<RiskLevel, number> = { green: 0, yellow: 0, red: 0 };
  let failures = 0;

  for (const item of queue) {
    try {
      const result = await processor(item, { skipScoring });
      counts[result.level] += 1;
      log(`  ${result.id}  ${result.level.padEnd(6)} → ${result.to}`);
    } catch (err) {
      failures += 1;
      // One bad item must not stop the batch, but it must be loud and it must
      // not be counted as classified.
      error(`  ${item.id}  FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { counts, failures };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseClassifyArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }
  const { only, skipScoring } = parsed.args;

  const selection = buildQueue(only);
  if (!selection.ok) {
    console.error(selection.error);
    return 1;
  }
  const { queue } = selection;

  if (queue.length === 0) {
    console.log(only ? `Nothing to classify for "${only}".` : 'Nothing to classify.');
    return 0;
  }

  if (only) {
    // Named before anything mutates, so the log shows what was selected and
    // where it started even if classification then fails.
    const item = queue[0]!;
    console.log(`Scoped to ${item.id} (currently "${item.status}", ${item.product} · ${item.platform}).`);
  }
  if (skipScoring) {
    console.log('Running without rubric scoring — every item will fail closed to Yellow.');
  }

  const { counts, failures } = await runClassification(queue, { skipScoring });

  console.log('');
  console.log(`Classified ${counts.green + counts.yellow + counts.red} item(s): ${counts.green} green, ${counts.yellow} yellow, ${counts.red} red.`);
  if (failures > 0) {
    console.error(`${failures} item(s) failed to classify and remain in their previous state.`);
    return 1;
  }
  if (counts.yellow > 0) console.log('Run `npm run approval:digest` to review the queue.');
  return 0;
}

/** Run only when invoked as a command, never on import — the module exports its
 *  selection and classification logic for tests, and importing that must not
 *  classify anything. Same guard as src/scripts/audit-connectors.ts. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(import.meta.filename);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
