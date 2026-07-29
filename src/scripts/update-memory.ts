#!/usr/bin/env node
/**
 * Fold collected analytics into the memory banks.
 *
 *   npm run learning:update
 *
 * Deterministic — no model call. Updates platform baselines and the hook bank,
 * then advances collected items analytics_collected → learned_from →
 * memory_updated so the lifecycle record shows the learning actually ran.
 *
 * Nothing here relaxes a brand constraint. A hook that performs well but was
 * blocked stays blocked; performance informs allocation, never safety.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { listAllItems, moveItem } from '../lib/store.ts';
import { transition } from '../state/machine.ts';
import { readScorecard } from '../analytics/scorecard.ts';
import { classifyGroup, loadThresholds, platformBaselines } from '../analytics/learning.ts';
import type { ScorecardEntry } from '../analytics/scorecard.ts';

interface HookRecord {
  hook: string;
  product: string;
  campaigns: string[];
  content_ids: string[];
  classification: string;
  reason: string;
  sample_count: number;
  total_impressions: number;
  updated_at: string;
}

function main(): void {
  const scorecard = readScorecard();
  const entries = Object.values(scorecard.items);

  if (entries.length === 0) {
    console.log('Scorecard is empty — nothing to learn from yet.');
    return;
  }

  const thresholds = loadThresholds();
  const baselines = platformBaselines(entries);
  const now = new Date().toISOString();

  // --- Platform baselines ---------------------------------------------------
  const perfFile = join(paths.memory, 'platform-performance.json');
  const perf = JSON.parse(readFileSync(perfFile, 'utf8')) as Record<string, unknown> & {
    platforms: Record<string, unknown>;
  };
  perf.platforms = Object.fromEntries(
    Object.entries(baselines).map(([platform, baseline]) => [
      platform,
      { ...baseline, updated_at: now },
    ]),
  );
  writeFileSync(perfFile, `${JSON.stringify(perf, null, 2)}\n`, 'utf8');

  // --- Hook bank ------------------------------------------------------------
  const byHook = new Map<string, ScorecardEntry[]>();
  for (const entry of entries) {
    const key = `${entry.product}::${entry.hook}`;
    const list = byHook.get(key) ?? [];
    list.push(entry);
    byHook.set(key, list);
  }

  const hookFile = join(paths.memory, 'hook-bank.json');
  const hookBank = JSON.parse(readFileSync(hookFile, 'utf8')) as Record<string, unknown> & {
    hooks: HookRecord[];
  };

  const records: HookRecord[] = [];
  for (const [key, group] of byHook) {
    const [product, hook] = key.split('::') as [string, string];
    const performance = classifyGroup(group, baselines, thresholds);
    records.push({
      hook,
      product,
      campaigns: [...new Set(group.map((e) => e.campaign))],
      content_ids: group.map((e) => e.content_id),
      classification: performance.classification,
      reason: performance.reason,
      sample_count: performance.sample_count,
      total_impressions: performance.total_impressions,
      updated_at: now,
    });
  }
  hookBank.hooks = records.sort((a, b) => a.hook.localeCompare(b.hook));
  writeFileSync(hookFile, `${JSON.stringify(hookBank, null, 2)}\n`, 'utf8');

  // --- Lifecycle ------------------------------------------------------------
  let advanced = 0;
  for (const item of listAllItems()) {
    if (item.status !== 'analytics_collected') continue;
    let current = transition(item, 'learned_from', 'Folded into platform baselines and hook bank.');
    moveItem(current, item.status);
    const done = transition(current, 'memory_updated', 'Memory banks written.');
    moveItem(done, current.status);
    advanced += 1;
  }

  console.log(`Baselines updated for ${Object.keys(baselines).length} platform(s).`);
  console.log(`Hook bank: ${records.length} hook(s), ${records.filter((r) => r.classification !== 'UNCLASSIFIED').length} classified (thresholds: ${thresholds.min_instances_to_classify} instances / ${thresholds.min_impressions_to_classify} impressions).`);
  console.log(`${advanced} item(s) advanced to memory_updated.`);
}

main();
