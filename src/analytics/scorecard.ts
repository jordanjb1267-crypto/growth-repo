/**
 * The content scorecard — one record per published item, holding whatever
 * metrics have been observed so far. This is the single input to the learning
 * layer, so its honesty rule matters: a metric is either observed (with its
 * source recorded) or absent. Nothing is estimated.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from '../lib/paths.ts';
import type { Platform, Product, RiskLevel } from '../lib/types.ts';

export const SCORECARD_FILE = join(paths.analytics, 'content-scorecard.json');

/** Platform-level engagement metrics. All optional — only what was observed. */
export interface PlatformMetrics {
  impressions?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  clicks?: number;
  watch_time_seconds?: number;
  negative_comments?: number;
}

/** Product-funnel events, attributed via utm_campaign = content ID. */
export interface FunnelMetrics {
  pageviews?: number;
  waitlist_signups?: number;
  installs?: number;
  onboarding_completions?: number;
  trial_starts?: number;
  paid_conversions?: number;
}

export interface ScorecardEntry {
  content_id: string;
  product: Product;
  platform: Platform;
  campaign: string;
  hook: string;
  published_at: string;
  /** 'green' = published autonomously; 'approved' = founder-approved Yellow.
   *  This is what lets the weekly review measure the spec's autonomy targets. */
  autonomy: 'green' | 'approved';
  risk_level: RiskLevel;
  metrics: PlatformMetrics;
  funnel: FunnelMetrics;
  /** Where each metric group last came from, with timestamp. */
  sources: Record<string, string>;
}

export interface Scorecard {
  $schema_version: 1;
  updated_at: string;
  items: Record<string, ScorecardEntry>;
}

export function readScorecard(): Scorecard {
  if (!existsSync(SCORECARD_FILE)) {
    return { $schema_version: 1, updated_at: new Date().toISOString(), items: {} };
  }
  return JSON.parse(readFileSync(SCORECARD_FILE, 'utf8')) as Scorecard;
}

export function writeScorecard(scorecard: Scorecard): void {
  scorecard.updated_at = new Date().toISOString();
  mkdirSync(dirname(SCORECARD_FILE), { recursive: true });
  writeFileSync(SCORECARD_FILE, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
}

/**
 * Manual metrics drop — how social-platform numbers get in before Phase 4
 * adapters (and for platforms whose APIs never expose them). The founder drops
 * a JSON file into analytics/raw/ named manual-metrics-*.json:
 *
 *   { "RR-IG-2026-07-28-001": { "impressions": 4200, "saves": 61, ... }, ... }
 *
 * Later files win over earlier ones per metric. Unknown content IDs are
 * reported, not silently dropped.
 */
export function readManualMetrics(): { byId: Record<string, PlatformMetrics>; files: string[] } {
  const rawDir = join(paths.analytics, 'raw');
  const byId: Record<string, PlatformMetrics> = {};
  const files: string[] = [];

  if (!existsSync(rawDir)) return { byId, files };

  for (const file of readdirSync(rawDir).filter((f) => /^manual-metrics-.*\.json$/.test(f)).sort()) {
    files.push(file);
    try {
      const parsed = JSON.parse(readFileSync(join(rawDir, file), 'utf8')) as Record<string, PlatformMetrics>;
      for (const [id, metrics] of Object.entries(parsed)) {
        byId[id] = { ...byId[id], ...metrics };
      }
    } catch {
      console.error(`  skipping unparseable ${file}`);
    }
  }
  return { byId, files };
}

/** Sum of the engagement signals the learning rules care about. */
export function engagement(metrics: PlatformMetrics): number {
  return (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.saves ?? 0) + (metrics.shares ?? 0);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (sorted.length % 2 === 0 && low !== undefined && high !== undefined) return (low + high) / 2;
  return high ?? 0;
}
