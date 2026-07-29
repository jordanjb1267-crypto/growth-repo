import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCampaignWindow,
  classifyGroup,
  platformBaselines,
  loadThresholds,
} from '../src/analytics/learning.ts';
import { median } from '../src/analytics/scorecard.ts';
import type { ScorecardEntry } from '../src/analytics/scorecard.ts';

function entry(overrides: {
  id: string;
  impressions?: number;
  likes?: number;
  saves?: number;
  shares?: number;
  platform?: ScorecardEntry['platform'];
  published_at?: string;
}): ScorecardEntry {
  return {
    content_id: overrides.id,
    product: 'Rig Receipts',
    platform: overrides.platform ?? 'Instagram Reels',
    campaign: 'Test',
    hook: 'hook',
    published_at: overrides.published_at ?? new Date().toISOString(),
    autonomy: 'green',
    risk_level: 'green',
    metrics: {
      ...(overrides.impressions !== undefined ? { impressions: overrides.impressions } : {}),
      likes: overrides.likes ?? 0,
      saves: overrides.saves ?? 0,
      shares: overrides.shares ?? 0,
    },
    funnel: {},
    sources: {},
  };
}

/** A baseline population: 6 items at 1000 impressions, ~2% engagement. */
function baselinePopulation(): ScorecardEntry[] {
  return Array.from({ length: 6 }, (_, i) =>
    entry({ id: `BASE-${i}`, impressions: 1000, likes: 15, saves: 3, shares: 2 }),
  );
}

const thresholds = loadThresholds();

describe('learning math', () => {
  it('computes medians', () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), 0);
  });

  it('builds platform baselines only from measured entries', () => {
    const entries = [...baselinePopulation(), entry({ id: 'UNMEASURED' })];
    const baselines = platformBaselines(entries);
    assert.equal(baselines['Instagram Reels']?.sample_count, 6);
    assert.equal(baselines['Instagram Reels']?.median_impressions, 1000);
  });

  it('refuses to classify below the instance threshold', () => {
    const population = baselinePopulation();
    const baselines = platformBaselines(population);
    const result = classifyGroup(
      [entry({ id: 'X-1', impressions: 5000, likes: 500, saves: 100, shares: 50 })],
      baselines,
      thresholds,
    );
    assert.equal(result.classification, 'UNCLASSIFIED');
    assert.match(result.reason, /instance/);
  });

  it('refuses to classify below the impressions threshold', () => {
    const population = baselinePopulation();
    const baselines = platformBaselines(population);
    const thin = [
      entry({ id: 'X-1', impressions: 50, likes: 10 }),
      entry({ id: 'X-2', impressions: 50, likes: 10 }),
      entry({ id: 'X-3', impressions: 50, likes: 10 }),
    ];
    const result = classifyGroup(thin, baselines, thresholds);
    assert.equal(result.classification, 'UNCLASSIFIED');
    assert.match(result.reason, /impressions/);
  });

  it('classifies SCALE well above the median and REWORK well below', () => {
    const population = baselinePopulation();
    const baselines = platformBaselines(population);

    const hot = classifyGroup(
      [
        entry({ id: 'H-1', impressions: 1000, likes: 60, saves: 20, shares: 20 }),
        entry({ id: 'H-2', impressions: 1000, likes: 60, saves: 20, shares: 20 }),
        entry({ id: 'H-3', impressions: 1000, likes: 60, saves: 20, shares: 20 }),
      ],
      baselines,
      thresholds,
    );
    assert.equal(hot.classification, 'SCALE');

    const cold = classifyGroup(
      [
        entry({ id: 'C-1', impressions: 1000, likes: 1 }),
        entry({ id: 'C-2', impressions: 1000, likes: 1 }),
        entry({ id: 'C-3', impressions: 1000, likes: 1 }),
      ],
      baselines,
      thresholds,
    );
    assert.equal(cold.classification, 'REWORK');
  });

  it('keeps the noise band unclassified', () => {
    const population = baselinePopulation();
    const baselines = platformBaselines(population);
    const ordinary = classifyGroup(population.slice(0, 3), baselines, thresholds);
    assert.equal(ordinary.classification, 'UNCLASSIFIED');
    assert.match(ordinary.reason, /noise band/);
  });

  it('reserves KILL for a full underperformance window', () => {
    const population = baselinePopulation();
    const baselines = platformBaselines(population);
    const cold = [
      entry({ id: 'C-1', impressions: 1000, likes: 1 }),
      entry({ id: 'C-2', impressions: 1000, likes: 1 }),
      entry({ id: 'C-3', impressions: 1000, likes: 1 }),
    ];

    const shortWindow = classifyCampaignWindow(cold, baselines, thresholds, 7);
    assert.equal(shortWindow.classification, 'REWORK', 'a week of bad data is REWORK, not KILL');

    const fullWindow = classifyCampaignWindow(cold, baselines, thresholds, 14);
    assert.equal(fullWindow.classification, 'KILL');
  });
});
