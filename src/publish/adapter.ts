/**
 * Publisher framework.
 *
 * `publishItem()` is the single gate every adapter runs behind. The ordering of
 * its checks is deliberate and mirrors the spec's adapter requirements: content
 * gates first (red never publishes, yellow needs the founder's approval record,
 * email needs it regardless), then the kill switches, then connector health,
 * then auth, then content validation — and only then a network call.
 *
 * Failure handling: a failed publish transitions to `publish_failed`, never
 * silently retried into `published`. Repeated failures pause the connector and
 * require a founder to clear it (`npm run connector:resume <platform>`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT, paths } from '../lib/paths.ts';
import { checkPublishAllowed } from '../lib/killswitch.ts';
import { moveItem } from '../lib/store.ts';
import { transition } from '../state/machine.ts';
import type { ContentItem, Platform } from '../lib/types.ts';

export interface PublishOutput {
  platform_post_id: string;
  url: string | null;
}

export interface PublisherAdapter {
  readonly platform: Platform;
  /** Credential/config presence and shape. Never logs a credential value. */
  validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }>;
  /** Platform-specific content constraints (caption length, required fields). */
  validateContent(item: ContentItem): { ok: boolean; detail: string };
  publish(item: ContentItem): Promise<PublishOutput>;
}

// ---------------------------------------------------------------------------
// Connector health — pause after repeated errors (spec adapter requirement 12)
// ---------------------------------------------------------------------------

const HEALTH_FILE = join(REPO_ROOT, 'logs', 'publisher-health.json');
export const PAUSE_AFTER_FAILURES = 3;

interface ConnectorHealth {
  consecutive_failures: number;
  paused: boolean;
  last_error: string | null;
  updated_at: string;
}

type HealthFile = Record<string, ConnectorHealth>;

function readHealth(): HealthFile {
  if (!existsSync(HEALTH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HEALTH_FILE, 'utf8')) as HealthFile;
  } catch {
    return {};
  }
}

function writeHealth(health: HealthFile): void {
  mkdirSync(dirname(HEALTH_FILE), { recursive: true });
  writeFileSync(HEALTH_FILE, `${JSON.stringify(health, null, 2)}\n`, 'utf8');
}

export function connectorHealth(platform: Platform): ConnectorHealth {
  return (
    readHealth()[platform] ?? {
      consecutive_failures: 0,
      paused: false,
      last_error: null,
      updated_at: new Date().toISOString(),
    }
  );
}

function recordResult(platform: Platform, ok: boolean, error?: string): ConnectorHealth {
  const health = readHealth();
  const current = health[platform] ?? {
    consecutive_failures: 0,
    paused: false,
    last_error: null,
    updated_at: '',
  };

  const next: ConnectorHealth = ok
    ? { consecutive_failures: 0, paused: false, last_error: null, updated_at: new Date().toISOString() }
    : {
        consecutive_failures: current.consecutive_failures + 1,
        paused: current.paused || current.consecutive_failures + 1 >= PAUSE_AFTER_FAILURES,
        last_error: error ?? 'unknown',
        updated_at: new Date().toISOString(),
      };

  health[platform] = next;
  writeHealth(health);
  return next;
}

/** Founder action: clear a pause after investigating. */
export function resumeConnector(platform: Platform): void {
  const health = readHealth();
  health[platform] = {
    consecutive_failures: 0,
    paused: false,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  writeHealth(health);
}

// ---------------------------------------------------------------------------
// Attribution — platform-post-ID ↔ content-ID map (acceptance criteria 9/10)
// ---------------------------------------------------------------------------

const ATTRIBUTION_FILE = join(paths.analytics, 'attribution.json');

export function recordAttribution(platform: Platform, platformPostId: string, contentId: string): void {
  let map: Record<string, string> = {};
  if (existsSync(ATTRIBUTION_FILE)) {
    try {
      map = JSON.parse(readFileSync(ATTRIBUTION_FILE, 'utf8')) as Record<string, string>;
    } catch {
      map = {};
    }
  }
  map[`${platform}:${platformPostId}`] = contentId;
  mkdirSync(dirname(ATTRIBUTION_FILE), { recursive: true });
  writeFileSync(ATTRIBUTION_FILE, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

/** UTM-tagged product link so PostHog can attribute funnel events to the
 *  originating content item (utm_campaign carries the content ID). */
export function withUtm(baseUrl: string, contentId: string, source: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'organic');
  url.searchParams.set('utm_campaign', contentId);
  return url.toString();
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface PublishAttempt {
  item_id: string;
  published: boolean;
  platform_post_id: string | null;
  url: string | null;
  reason: string;
}

const RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishItem(
  item: ContentItem,
  adapter: PublisherAdapter,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PublishAttempt> {
  const refuse = (reason: string): PublishAttempt => ({
    item_id: item.id,
    published: false,
    platform_post_id: null,
    url: null,
    reason,
  });

  if (adapter.platform !== item.platform) {
    return refuse(`Adapter is for ${adapter.platform}, item targets ${item.platform}.`);
  }
  if (item.status !== 'auto_publish_ready') {
    return refuse(`Item is in "${item.status}", not "auto_publish_ready".`);
  }

  // Content gates — independent of, and checked before, everything operational.
  if (item.risk_level === 'red') {
    return refuse('Classified Red. Red content cannot publish at all.');
  }
  if (item.risk_level === 'yellow' && !item.approval) {
    return refuse('Classified Yellow with no founder approval record. Approval is required before publishing.');
  }
  if (item.platform === 'Email' && !item.approval) {
    return refuse('Email sends are approval-gated regardless of risk level — a send cannot be retracted.');
  }
  if (item.classification === null) {
    return refuse('Item has no classification record; it did not pass through risk:classify.');
  }

  const switches = checkPublishAllowed(item.platform, env);
  if (!switches.allowed) return refuse(switches.reason);

  const health = connectorHealth(item.platform);
  if (health.paused) {
    return refuse(
      `Connector is paused after ${health.consecutive_failures} consecutive failure(s) (last: ${health.last_error}). Investigate, then: npm run connector:resume ${item.platform}`,
    );
  }

  const auth = await adapter.validateAuth(env);
  if (!auth.ok) return refuse(`Auth validation failed: ${auth.detail}`);

  const content = adapter.validateContent(item);
  if (!content.ok) return refuse(`Content validation failed: ${content.detail}`);

  // Point of no return: mark scheduled before the network call so a crash
  // mid-publish leaves the item visibly in-flight, never silently approved.
  let current = transition(item, 'scheduled', `Publishing to ${item.platform}.`);
  moveItem(current, item.status);

  let lastError = 'unknown';
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const output = await adapter.publish(current);

      const published = transition(current, 'published', `Published: ${output.platform_post_id}`);
      const final: ContentItem = {
        ...published,
        platform_post_id: output.platform_post_id,
        published_at: new Date().toISOString(),
      };
      moveItem(final, current.status);
      recordAttribution(item.platform, output.platform_post_id, item.id);
      recordResult(item.platform, true);

      return {
        item_id: item.id,
        published: true,
        platform_post_id: output.platform_post_id,
        url: output.url,
        reason: 'published',
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < RETRIES) await sleep(2_000 * 2 ** attempt);
    }
  }

  const failed = transition(current, 'publish_failed', `Publish failed after ${RETRIES + 1} attempts: ${lastError}`);
  moveItem(failed, current.status);
  const healthAfter = recordResult(item.platform, false, lastError);

  return refuse(
    `Publish failed after ${RETRIES + 1} attempt(s): ${lastError}${healthAfter.paused ? ` — connector now PAUSED` : ''}`,
  );
}
