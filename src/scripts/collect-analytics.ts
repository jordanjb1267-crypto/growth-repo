#!/usr/bin/env node
/**
 * Collect analytics for published content and fold them into the scorecard.
 *
 *   npm run analytics:collect
 *
 * Sources, in order:
 *   1. Manual metrics drops — analytics/raw/manual-metrics-*.json. This is how
 *      social-platform numbers arrive before Phase 4 adapters exist (founder
 *      posts manually, reads the platform's own analytics, drops the numbers).
 *   2. PostHog funnel events, attributed via utm_campaign = content ID.
 *
 * Every metric records its source. Nothing is estimated: a platform that
 * reported nothing shows nothing.
 *
 * Items collected for the first time advance published → analytics_collected.
 * Metrics keep refreshing on later runs regardless of state — the scorecard is
 * keyed by content ID, not lifecycle state.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listAllItems, moveItem } from '../lib/store.ts';
import { transition } from '../state/machine.ts';
import { paths } from '../lib/paths.ts';
import { dayId } from '../lib/dates.ts';
import { collectFunnel } from '../analytics/posthog.ts';
import { readManualMetrics, readScorecard, writeScorecard } from '../analytics/scorecard.ts';
import type { ScorecardEntry } from '../analytics/scorecard.ts';

async function main(): Promise<void> {
  const published = listAllItems().filter((i) => i.published_at !== null && i.platform_post_id !== null);

  if (published.length === 0) {
    console.log('Nothing published yet — nothing to collect.');
    return;
  }

  const scorecard = readScorecard();
  const manual = readManualMetrics();
  const funnel = await collectFunnel(published.map((i) => i.id));
  const now = new Date().toISOString();

  let updated = 0;
  const unknownManualIds = new Set(Object.keys(manual.byId));

  for (const item of published) {
    const entry: ScorecardEntry = scorecard.items[item.id] ?? {
      content_id: item.id,
      product: item.product,
      platform: item.platform,
      campaign: item.campaign,
      hook: item.hook,
      published_at: item.published_at ?? now,
      autonomy: item.approval ? 'approved' : 'green',
      risk_level: item.risk_level,
      metrics: {},
      funnel: {},
      sources: {},
    };

    const manualMetrics = manual.byId[item.id];
    if (manualMetrics) {
      entry.metrics = { ...entry.metrics, ...manualMetrics };
      entry.sources.metrics = `manual drop @ ${now}`;
      unknownManualIds.delete(item.id);
      updated += 1;
    }

    const funnelMetrics = funnel.byId[item.id];
    if (funnelMetrics) {
      entry.funnel = { ...entry.funnel, ...funnelMetrics };
      entry.sources.funnel = `posthog @ ${now}`;
      updated += 1;
    }

    scorecard.items[item.id] = entry;

    // First collection advances the lifecycle. Later collections only refresh.
    if (item.status === 'published') {
      const advanced = transition(item, 'analytics_collected', 'Included in the scorecard.');
      moveItem(advanced, item.status);
    }
  }

  writeScorecard(scorecard);

  // Daily rollup.
  const dailyFile = join(paths.analytics, 'daily', `${dayId()}.md`);
  mkdirSync(join(paths.analytics, 'daily'), { recursive: true });
  const entries = Object.values(scorecard.items);
  writeFileSync(
    dailyFile,
    [
      `# Daily Analytics — ${dayId()}`,
      '',
      `- Published items tracked: ${entries.length}`,
      `- Autonomous (green): ${entries.filter((e) => e.autonomy === 'green').length} · Founder-approved: ${entries.filter((e) => e.autonomy === 'approved').length}`,
      `- Manual metric files read: ${manual.files.length > 0 ? manual.files.join(', ') : 'none'}`,
      `- PostHog: ${funnel.detail}`,
      '',
      '| Content | Platform | Impressions | Engagement | Funnel events |',
      '|---|---|---|---|---|',
      ...entries.map((e) => {
        const eng = (e.metrics.likes ?? 0) + (e.metrics.comments ?? 0) + (e.metrics.saves ?? 0) + (e.metrics.shares ?? 0);
        const funnelTotal = Object.values(e.funnel).reduce((a, b) => a + (b ?? 0), 0);
        return `| ${e.content_id} | ${e.platform} | ${e.metrics.impressions ?? '—'} | ${eng || '—'} | ${funnelTotal || '—'} |`;
      }),
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`Scorecard: ${entries.length} item(s) tracked, ${updated} metric update(s) applied.`);
  console.log(`PostHog: ${funnel.detail}`);
  if (unknownManualIds.size > 0) {
    console.error(`Manual metrics referenced unknown content IDs (check for typos): ${[...unknownManualIds].join(', ')}`);
  }
  console.log(`Wrote ${dailyFile}`);
}

await main();
