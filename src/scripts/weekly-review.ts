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
import { readScorecard } from '../analytics/scorecard.ts';
import {
  classifyCampaignWindow,
  loadThresholds,
  platformBaselines,
} from '../analytics/learning.ts';
import type { ScorecardEntry } from '../analytics/scorecard.ts';

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
    ].join('\n'),
    'utf8',
  );

  console.log(`Wrote ${reviewFile}`);
  console.log(`Campaigns reviewed: ${campaignRecords.length} (${campaignRecords.filter((c) => c.classification !== 'UNCLASSIFIED').length} classified).`);
  if (autonomyPct !== null) console.log(`Autonomy this week: ${autonomyPct}% (target 60-70%).`);
}

main();
