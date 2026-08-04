/**
 * PostHog funnel collection — per product.
 *
 * Attribution mechanism: every product link published by an adapter carries
 * utm_campaign=<content_id> (see withUtm in src/publish/adapter.ts). PostHog
 * records utm_campaign on events, so a HogQL query grouped by that property
 * maps funnel events straight back to the originating content item —
 * acceptance criterion 10 without any platform cooperation.
 *
 * Each product lives in its own PostHog project (Rig Receipts and Tilawah Lock
 * are separate organisations in the founder's account), so content IDs are
 * grouped by product and each group is queried against its own project. A
 * single personal API key covers both, since the founder owns both orgs.
 *
 * Config, in precedence order per product:
 *   POSTHOG_PROJECT_ID_RIG_RECEIPTS / POSTHOG_PROJECT_ID_TILAWAH_LOCK
 *   POSTHOG_PROJECT_ID                (single-project fallback, both products)
 *
 * A product with no project configured is reported as unconfigured rather than
 * silently returning zero funnel events — an absent number and a real zero mean
 * very different things to the learning rules.
 */

import { PRODUCTS } from '../lib/types.ts';
import type { Product } from '../lib/types.ts';
import type { FunnelMetrics } from './scorecard.ts';

/** Content IDs are embedded in a HogQL string; validate shape first so the
 *  query is injection-proof by construction. */
const CONTENT_ID_PATTERN = /^[A-Z]{2,4}-[A-Z]{2,4}-\d{4}-\d{2}-\d{2}-\d{3}$/;

const EVENT_TO_FIELD: Record<string, keyof FunnelMetrics> = {
  $pageview: 'pageviews',
  waitlist_signup: 'waitlist_signups',
  install: 'installs',
  onboarding_complete: 'onboarding_completions',
  trial_start: 'trial_starts',
  paid_conversion: 'paid_conversions',
};

const PROJECT_ENV_KEYS: Record<Product, string> = {
  'Rig Receipts': 'POSTHOG_PROJECT_ID_RIG_RECEIPTS',
  'Tilawah Lock': 'POSTHOG_PROJECT_ID_TILAWAH_LOCK',
};

/** The project a product's funnel events land in, or null if unconfigured. */
export function projectIdFor(product: Product, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[PROJECT_ENV_KEYS[product]] || env.POSTHOG_PROJECT_ID || null;
}

export function projectEnvKey(product: Product): string {
  return PROJECT_ENV_KEYS[product];
}

export interface PosthogResult {
  available: boolean;
  detail: string;
  byId: Record<string, FunnelMetrics>;
}

/** Content items keyed by ID, so each ID can be routed to its product's
 *  project. Only id and product are needed. */
export interface FunnelSubject {
  id: string;
  product: Product;
}

export async function collectFunnel(
  subjects: FunnelSubject[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PosthogResult> {
  const key = env.POSTHOG_PERSONAL_API_KEY;
  const host = env.POSTHOG_HOST ?? 'https://us.posthog.com';

  if (!key) {
    return {
      available: false,
      detail: 'POSTHOG_PERSONAL_API_KEY not set — funnel metrics skipped (note: the project key is ingestion-only; querying needs a personal API key).',
      byId: {},
    };
  }

  const byId: Record<string, FunnelMetrics> = {};
  const notes: string[] = [];
  let anyQueried = false;

  for (const product of PRODUCTS) {
    const ids = subjects
      .filter((s) => s.product === product)
      .map((s) => s.id)
      .filter((id) => CONTENT_ID_PATTERN.test(id));
    if (ids.length === 0) continue;

    const project = projectIdFor(product, env);
    if (!project) {
      notes.push(`${product}: ${PROJECT_ENV_KEYS[product]} not set — ${ids.length} item(s) have no funnel data`);
      continue;
    }

    anyQueried = true;
    const result = await queryProject(host, project, key, ids, fetchImpl);
    if (result.error) {
      notes.push(`${product}: ${result.error}`);
      continue;
    }
    Object.assign(byId, result.byId);
    notes.push(`${product}: ${Object.keys(result.byId).length} item(s) with funnel data (project ${project})`);
  }

  if (notes.length === 0) return { available: true, detail: 'No published content IDs to query.', byId };

  return { available: anyQueried, detail: notes.join('; '), byId };
}

async function queryProject(
  host: string,
  project: string,
  key: string,
  ids: string[],
  fetchImpl: typeof fetch,
): Promise<{ byId: Record<string, FunnelMetrics>; error: string | null }> {
  const idList = ids.map((id) => `'${id}'`).join(', ');
  const events = Object.keys(EVENT_TO_FIELD)
    .map((e) => `'${e}'`)
    .join(', ');
  const query = `select properties.utm_campaign as cid, event, count() as n from events where properties.utm_campaign in (${idList}) and event in (${events}) group by cid, event`;

  const response = await fetchImpl(`${host}/api/projects/${project}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });

  if (!response.ok) {
    return { byId: {}, error: `PostHog query on project ${project} returned ${response.status}.` };
  }

  const payload = (await response.json()) as { results?: [string, string, number][] };
  const byId: Record<string, FunnelMetrics> = {};

  for (const row of payload.results ?? []) {
    const [cid, event, count] = row;
    const field = EVENT_TO_FIELD[event];
    if (!field || typeof cid !== 'string' || typeof count !== 'number') continue;
    byId[cid] = { ...byId[cid], [field]: count };
  }

  return { byId, error: null };
}
