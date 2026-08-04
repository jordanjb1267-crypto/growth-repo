#!/usr/bin/env node
/**
 * Weekly review — score the week and classify campaigns.
 *
 *   npm run weekly:review
 *
 * Writes /analytics/weekly/YYYY-WW.md and updates memory/campaign-history.json.
 * Deterministic: everything in the review is reproducible from the scorecard.
 *
 * This is also where the spec's autonomy target is measured — the ratio of
 * autonomously-published green content to founder-approved yellow content,
 * against the 60-70% goal.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { dayId, isoWeekId, isoWeekStart } from '../lib/dates.ts';
import { engagement, median, readScorecard } from '../analytics/scorecard.ts';
import {
  classifyCampaignWindow,
  loadThresholds,
  platformBaselines,
} from '../analytics/learning.ts';
import type { ScorecardEntry } from '../analytics/scorecard.ts';

/**
 * Phase 5 sections — posting-time and platform-allocation observations.
 * Deterministic and threshold-gated like everything else in the review:
 * with too little data the sections say so instead of recommending.
 */
function phase5Sections(entries: ScorecardEntry[], minSamples: number): string[] {
  const measured = entries.filter((e) => (e.metrics.impressions ?? 0) > 0);
  const lines: string[] = ['## Posting-time observations (Phase 5)', ''];

  // Bucket by local-ish posting window using the UTC hour recorded at publish.
  const buckets = new Map<string, number[]>();
  for (const entry of measured) {
    const hour = new Date(entry.published_at).getUTCHours();
    const bucket = `${String(Math.floor(hour / 4) * 4).padStart(2, '0')}:00–${String(Math.floor(hour / 4) * 4 + 4).padStart(2, '0')}:00 UTC`;
    const list = buckets.get(bucket) ?? [];
    list.push(entry.metrics.impressions ?? 0);
    buckets.set(bucket, list);
  }

  const usable = [...buckets.entries()].filter(([, values]) => values.length >= minSamples);
  if (usable.length < 2) {
    lines.push(`Not enough data yet — need at least ${minSamples} measured items in each of two posting windows before a time recommendation means anything.`);
  } else {
    lines.push('| Window | Median impressions | Samples |', '|---|---|---|');
    for (const [bucket, values] of usable.sort((a, b) => median(b[1]) - median(a[1]))) {
      lines.push(`| ${bucket} | ${median(values)} | ${values.length} |`);
    }
    lines.push('', 'Shift publish times toward the leading window one step at a time; re-check after two weeks.');
  }

  lines.push('', '## Platform allocation (Phase 5)', '');
  const byPlatform = new Map<string, ScorecardEntry[]>();
  for (const entry of measured) {
    const list = byPlatform.get(entry.platform) ?? [];
    list.push(entry);
    byPlatform.set(entry.platform, list);
  }
  const ranked = [...byPlatform.entries()]
    .filter(([, list]) => list.length >= minSamples)
    .map(([platform, list]) => ({
      platform,
      rate: median(list.map((e) => engagement(e.metrics) / Math.max(1, e.metrics.impressions ?? 1))),
      samples: list.length,
    }))
    .sort((a, b) => b.rate - a.rate);

  if (ranked.length < 2) {
    lines.push(`Not enough data yet — need ${minSamples}+ measured items on at least two platforms before allocation advice means anything.`);
  } else {
    lines.push('| Platform | Median engagement rate | Samples |', '|---|---|---|');
    for (const row of ranked) lines.push(`| ${row.platform} | ${(row.rate * 100).toFixed(2)}% | ${row.samples} |`);
    lines.push('', `Lean toward ${ranked[0]?.platform} next week; keep the others at baseline rather than abandoning them — platform medians drift.`);
  }
  lines.push('');
  return lines;
}

interface CampaignRecord {
  campaign: string;
  product: string;
  classification: string;
  reason: string;
  sample_count: number;
  total_impressions: number;
  relative_engagement: number | null;
  reviewed_at: string;
  week: string;
}

function main(): void {
  const scorecard = readScorecard();
  const entries = Object.values(scorecard.items);
  const week = isoWeekId();
  const thresholds = loadThresholds();

  // Baselines come from the whole corpus; classification windows are scoped.
  const baselines = platformBaselines(entries);

  const weekStart = isoWeekStart();
  const thisWeek = entries.filter((e) => Date.parse(e.published_at) >= weekStart.getTime());

  // Campaign windows use the underperformance window, not just this week —
  // the 14-day KILL rule needs 14 days of evidence.
  const windowMs = thresholds.underperformance_window_days * 86_400_000;
  const windowStart = Date.now() - windowMs;
  const inWindow = entries.filter((e) => Date.parse(e.published_at) >= windowStart);

  const byCampaign = new Map<string, ScorecardEntry[]>();
  for (const entry of inWindow) {
    const key = `${entry.product}::${entry.campaign}`;
    const list = byCampaign.get(key) ?? [];
    list.push(entry);
    byCampaign.set(key, list);
  }

  const now = new Date().toISOString();
  const campaignRecords: CampaignRecord[] = [];
  for (const [key, group] of byCampaign) {
    const [product, campaign] = key.split('::') as [string, string];
    const oldest = Math.min(...group.map((e) => Date.parse(e.published_at)));
    const observedDays = Math.floor((Date.now() - oldest) / 86_400_000);
    const performance = classifyCampaignWindow(group, baselines, thresholds, observedDays);
    campaignRecords.push({
      campaign,
      product,
      classification: performance.classification,
      reason: performance.reason,
      sample_count: performance.sample_count,
      total_impressions: performance.total_impressions,
      relative_engagement: performance.relative_engagement,
      reviewed_at: now,
      week,
    });
  }

  // Autonomy measurement.
  const green = thisWeek.filter((e) => e.autonomy === 'green').length;
  const approvedCount = thisWeek.filter((e) => e.autonomy === 'approved').length;
  const total = green + approvedCount;
  const autonomyPct = total > 0 ? Math.round((green / total) * 100) : null;

  // Persist campaign history (append-only per week).
  const historyFile = join(paths.memory, 'campaign-history.json');
  const history = JSON.parse(readFileSync(historyFile, 'utf8')) as Record<string, unknown> & {
    campaigns: CampaignRecord[];
  };
  history.campaigns = [...history.campaigns.filter((c) => c.week !== week), ...campaignRecords];
  writeFileSync(historyFile, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

  // The review document.
  const reviewFile = join(paths.analytics, 'weekly', `${week}.md`);
  mkdirSync(join(paths.analytics, 'weekly'), { recursive: true });
  writeFileSync(
    reviewFile,
    [
      `# Weekly Review — ${week}`,
      '',
      `Generated ${dayId()}. Deterministic; reproducible from analytics/content-scorecard.json.`,
      '',
      '## Volume and autonomy',
      '',
      `- Published this week: ${thisWeek.length}`,
      `- Autonomous (green): ${green} · Founder-approved (yellow): ${approvedCount}`,
      autonomyPct === null
        ? '- Autonomy ratio: n/a (nothing published this week)'
        : `- Autonomy ratio: ${autonomyPct}% autonomous — target band is 60-70% (spec). ${
            autonomyPct < 60
              ? 'Below band: consider approving more templates rather than loosening rules.'
              : autonomyPct > 70
                ? 'Above band: check that yellow triggers are actually catching what they should.'
                : 'Inside band.'
          }`,
      '',
      '## Platform baselines (rolling medians, full corpus)',
      '',
      '| Platform | Median impressions | Median engagement rate | Samples |',
      '|---|---|---|---|',
      ...Object.entries(baselines).map(
        ([platform, b]) =>
          `| ${platform} | ${b.median_impressions} | ${(b.median_engagement_rate * 100).toFixed(2)}% | ${b.sample_count} |`,
      ),
      '',
      `## Campaigns (${thresholds.underperformance_window_days}-day window)`,
      '',
      '| Campaign | Product | Classification | Why | n | Impressions |',
      '|---|---|---|---|---|---|',
      ...campaignRecords.map(
        (c) => `| ${c.campaign} | ${c.product} | **${c.classification}** | ${c.reason} | ${c.sample_count} | ${c.total_impressions} |`,
      ),
      '',
      '`UNCLASSIFIED` means below the sample thresholds — that is the honest state, not a failure. `KILL` requires a full',
      `${thresholds.underperformance_window_days}-day underperforming window and is a recommendation to the founder: allocation drops in the weekly plan, but no content is deleted automatically.`,
      '',
      ...phase5Sections(entries, thresholds.min_instances_for_median),
    ].join('\n'),
    'utf8',
  );

  console.log(`Wrote ${reviewFile}`);
  console.log(`Campaigns reviewed: ${campaignRecords.length} (${campaignRecords.filter((c) => c.classification !== 'UNCLASSIFIED').length} classified).`);
  if (autonomyPct !== null) console.log(`Autonomy this week: ${autonomyPct}% (target 60-70%).`);
}

main();
