#!/usr/bin/env node
/**
 * Weekly plan — next week's campaign allocation, from the latest review.
 *
 *   npm run weekly:plan
 *
 * Deterministic and conservative by construction:
 *   - Total volume stays at the spec's daily targets. The spec is explicit
 *     that volume does not increase until quality and safety metrics justify
 *     it, and "one SCALE classification" is not that justification.
 *   - SCALE campaigns get allocation priority; REWORK campaigns keep running
 *     with a flagged angle; KILL campaigns are dropped from allocation (the
 *     content stays on disk — nothing is deleted).
 *   - Campaigns with no data yet rotate in at baseline. UNCLASSIFIED is not a
 *     penalty.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { dayId, isoWeekId } from '../lib/dates.ts';
import { loadCampaignBriefs } from '../content/context.ts';
import { PRODUCTS } from '../lib/types.ts';

interface CampaignRecord {
  campaign: string;
  product: string;
  classification: string;
  reason: string;
  week: string;
}

function main(): void {
  const week = isoWeekId();
  const historyFile = join(paths.memory, 'campaign-history.json');
  const history = JSON.parse(readFileSync(historyFile, 'utf8')) as { campaigns: CampaignRecord[] };

  // Latest classification per campaign wins.
  const latest = new Map<string, CampaignRecord>();
  for (const record of history.campaigns) {
    const key = `${record.product}::${record.campaign}`;
    const existing = latest.get(key);
    if (!existing || record.week > existing.week) latest.set(key, record);
  }

  const lines: string[] = [
    `# Weekly Plan — ${week}`,
    '',
    `Generated ${dayId()} from memory/campaign-history.json. Total volume stays at the spec's daily targets; this plan moves emphasis between campaigns, never raises output.`,
    '',
  ];

  const machinePlan: Record<string, { lead: string | null; active: string[] }> = {};

  for (const product of PRODUCTS) {
    const briefs = loadCampaignBriefs(product);
    const rows = briefs.map((brief) => {
      const record = latest.get(`${product}::${brief.name}`);
      const classification = record?.classification ?? 'NO DATA';
      const action =
        classification === 'SCALE'
          ? 'Priority — lead the week with this campaign.'
          : classification === 'REWORK'
            ? `Keep running at reduced share; rework the angle first (${record?.reason ?? ''}).`
            : classification === 'KILL'
              ? 'Drop from allocation. Material stays on disk; founder can revive deliberately.'
              : classification === 'ARCHIVE'
                ? 'Pause. Keep the material.'
                : 'Baseline rotation — still gathering data.';
      return { name: brief.name, classification, action };
    });

    const active = rows.filter((r) => !['KILL', 'ARCHIVE'].includes(r.classification));
    machinePlan[product] = {
      lead: rows.find((r) => r.classification === 'SCALE')?.name ?? active[0]?.name ?? null,
      active: active.map((r) => r.name),
    };
    lines.push(
      `## ${product}`,
      '',
      '| Campaign | Standing | Next week |',
      '|---|---|---|',
      ...rows.map((r) => `| ${r.name} | ${r.classification} | ${r.action} |`),
      '',
      `Active allocation: ${active.length} campaign(s) sharing the daily target. Lead: ${
        rows.find((r) => r.classification === 'SCALE')?.name ?? active[0]?.name ?? 'none'
      }.`,
      '',
    );
  }

  lines.push(
    '## Standing constraints',
    '',
    '- Approval-gated-in-full campaigns (Community Rate Board, Quran Before Phone) stay approval-gated regardless of performance.',
    '- Performance never relaxes a brand rule. A well-performing angle that trips a rule still goes to the founder.',
    '',
  );

  const planFile = join(paths.analytics, 'weekly', `${week}-plan.md`);
  mkdirSync(join(paths.analytics, 'weekly'), { recursive: true });
  writeFileSync(planFile, lines.join('\n'), 'utf8');

  // Machine-readable twin — content generation reads this so the week's
  // allocation actually steers what gets drafted, closing the learning loop.
  const latestFile = join(paths.analytics, 'weekly', 'latest-plan.json');
  writeFileSync(
    latestFile,
    `${JSON.stringify({ $schema_version: 1, week, generated_at: new Date().toISOString(), products: machinePlan }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Wrote ${planFile}`);
  console.log(`Wrote ${latestFile}`);
}

main();
