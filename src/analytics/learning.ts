/**
 * Learning core — the deterministic math behind memory updates and the weekly
 * review. No model call anywhere in this layer: what gets scaled, reworked, or
 * killed must be reproducible from the scorecard alone.
 *
 * The load-bearing constraint (CLAUDE.md addendum A5): at this system's volume
 * — 30-60 measurable items a month — acting on single data points is chasing
 * noise. Every classification is gated on minimum sample counts and compared
 * against the account's own rolling medians, never an absolute cutoff or an
 * industry number we cannot verify.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { engagement, median } from './scorecard.ts';
import type { ScorecardEntry } from './scorecard.ts';

export interface LearningThresholds {
  min_impressions_to_classify: number;
  min_instances_to_classify: number;
  min_instances_for_median: number;
  underperformance_window_days: number;
}

const DEFAULTS: LearningThresholds = {
  min_impressions_to_classify: 500,
  min_instances_to_classify: 3,
  min_instances_for_median: 5,
  underperformance_window_days: 14,
};

/** Thresholds live in the memory files so the founder can tune them without
 *  touching code. Missing files or fields fall back to the defaults above. */
export function loadThresholds(): LearningThresholds {
  const out = { ...DEFAULTS };
  try {
    const hookBank = JSON.parse(readFileSync(join(paths.memory, 'hook-bank.json'), 'utf8')) as {
      learning_thresholds?: Partial<LearningThresholds>;
    };
    Object.assign(out, pickNumbers(hookBank.learning_thresholds));
  } catch {
    /* defaults stand */
  }
  try {
    const perf = JSON.parse(readFileSync(join(paths.memory, 'platform-performance.json'), 'utf8')) as {
      learning_thresholds?: Partial<LearningThresholds>;
    };
    Object.assign(out, pickNumbers(perf.learning_thresholds));
  } catch {
    /* defaults stand */
  }
  return out;
}

function pickNumbers(source: Partial<LearningThresholds> | undefined): Partial<LearningThresholds> {
  const out: Partial<LearningThresholds> = {};
  if (!source) return out;
  for (const key of Object.keys(DEFAULTS) as (keyof LearningThresholds)[]) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

export interface PlatformBaseline {
  median_impressions: number;
  median_engagement_rate: number;
  sample_count: number;
}

/** Per-platform rolling medians over every entry that has impressions. */
export function platformBaselines(entries: ScorecardEntry[]): Record<string, PlatformBaseline> {
  const byPlatform = new Map<string, ScorecardEntry[]>();
  for (const entry of entries) {
    if (entry.metrics.impressions === undefined) continue;
    const list = byPlatform.get(entry.platform) ?? [];
    list.push(entry);
    byPlatform.set(entry.platform, list);
  }

  const out: Record<string, PlatformBaseline> = {};
  for (const [platform, list] of byPlatform) {
    const impressions = list.map((e) => e.metrics.impressions ?? 0);
    const rates = list
      .filter((e) => (e.metrics.impressions ?? 0) > 0)
      .map((e) => engagement(e.metrics) / (e.metrics.impressions ?? 1));
    out[platform] = {
      median_impressions: median(impressions),
      median_engagement_rate: median(rates),
      sample_count: list.length,
    };
  }
  return out;
}

export type PerformanceClass = 'SCALE' | 'REWORK' | 'ARCHIVE' | 'KILL' | 'UNCLASSIFIED';

export interface GroupPerformance {
  classification: PerformanceClass;
  reason: string;
  sample_count: number;
  total_impressions: number;
  relative_engagement: number | null;
}

export const SCALE_MULTIPLIER = 1.5;
export const REWORK_MULTIPLIER = 0.5;

/**
 * Classify a group of entries (a hook's instances, or a campaign's items)
 * against its platform baselines. UNCLASSIFIED below the sample thresholds is
 * the honest answer, not a failure.
 *
 * KILL is never produced here — it requires the 14-day underperformance
 * window, which only the weekly review evaluates (see classifyCampaignWindow).
 */
export function classifyGroup(
  entries: ScorecardEntry[],
  baselines: Record<string, PlatformBaseline>,
  thresholds: LearningThresholds,
): GroupPerformance {
  const measured = entries.filter((e) => e.metrics.impressions !== undefined);
  const totalImpressions = measured.reduce((sum, e) => sum + (e.metrics.impressions ?? 0), 0);

  const base: Omit<GroupPerformance, 'classification' | 'reason'> = {
    sample_count: measured.length,
    total_impressions: totalImpressions,
    relative_engagement: null,
  };

  if (measured.length < thresholds.min_instances_to_classify) {
    return {
      ...base,
      classification: 'UNCLASSIFIED',
      reason: `${measured.length} measured instance(s); need ${thresholds.min_instances_to_classify}.`,
    };
  }
  if (totalImpressions < thresholds.min_impressions_to_classify) {
    return {
      ...base,
      classification: 'UNCLASSIFIED',
      reason: `${totalImpressions} total impressions; need ${thresholds.min_impressions_to_classify}.`,
    };
  }

  // Relative engagement: this group's median rate vs its platforms' medians.
  const rates: number[] = [];
  const baselineRates: number[] = [];
  for (const entry of measured) {
    const impressions = entry.metrics.impressions ?? 0;
    if (impressions === 0) continue;
    const baseline = baselines[entry.platform];
    if (!baseline || baseline.sample_count < thresholds.min_instances_for_median) continue;
    rates.push(engagement(entry.metrics) / impressions);
    baselineRates.push(baseline.median_engagement_rate);
  }

  if (rates.length === 0) {
    return {
      ...base,
      classification: 'UNCLASSIFIED',
      reason: `No platform baseline yet (need ${thresholds.min_instances_for_median} measured items per platform for a median).`,
    };
  }

  const groupRate = median(rates);
  const baselineRate = median(baselineRates);
  const relative = baselineRate > 0 ? groupRate / baselineRate : groupRate > 0 ? Number.POSITIVE_INFINITY : 1;
  const result = { ...base, relative_engagement: Number(relative.toFixed(3)) };

  if (relative >= SCALE_MULTIPLIER) {
    return { ...result, classification: 'SCALE', reason: `Engagement ${result.relative_engagement}x the platform median.` };
  }
  if (relative <= REWORK_MULTIPLIER) {
    return { ...result, classification: 'REWORK', reason: `Engagement ${result.relative_engagement}x the platform median.` };
  }
  return { ...result, classification: 'UNCLASSIFIED', reason: `Engagement ${result.relative_engagement}x median — inside the noise band; keep running.` };
}

/**
 * The 14-day underperformance rule — the only path to KILL, and only the
 * weekly review calls it. A campaign whose full window is measured, sampled
 * above threshold, and still under the REWORK line gets KILL; under it with a
 * thinner window gets ARCHIVE (stop, but keep the material).
 */
export function classifyCampaignWindow(
  windowEntries: ScorecardEntry[],
  baselines: Record<string, PlatformBaseline>,
  thresholds: LearningThresholds,
  windowDays: number,
): GroupPerformance {
  const inner = classifyGroup(windowEntries, baselines, thresholds);

  if (inner.classification === 'REWORK' && windowDays >= thresholds.underperformance_window_days) {
    return {
      ...inner,
      classification: 'KILL',
      reason: `Under ${REWORK_MULTIPLIER}x the platform median across a full ${windowDays}-day window (${inner.reason})`,
    };
  }
  return inner;
}

export function readMemoryJson<T>(file: string): T | null {
  const full = join(paths.memory, file);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, 'utf8')) as T;
  } catch {
    return null;
  }
}
