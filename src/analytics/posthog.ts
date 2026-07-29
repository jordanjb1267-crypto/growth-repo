/**
 * PostHog funnel collection.
 *
 * Attribution mechanism: every product link published by an adapter carries
 * utm_campaign=<content_id> (see withUtm in src/publish/adapter.ts). PostHog
 * records utm_campaign on events, so a HogQL query grouped by that property
 * maps funnel events straight back to the originating content item —
 * acceptance criterion 10 without any platform cooperation.
 *
 * Requires POSTHOG_PERSONAL_API_KEY (a personal API key — the project key is
 * ingestion-only and cannot query) and POSTHOG_PROJECT_ID. Absent either, the
 * collector skips funnel data with a note rather than failing the run.
 */

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

export interface PosthogResult {
  available: boolean;
  detail: string;
  byId: Record<string, FunnelMetrics>;
}

export async function collectFunnel(
  contentIds: string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PosthogResult> {
  const key = env.POSTHOG_PERSONAL_API_KEY;
  const project = env.POSTHOG_PROJECT_ID;
  const host = env.POSTHOG_HOST ?? 'https://us.posthog.com';

  if (!key || !project) {
    return {
      available: false,
      detail: 'POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID not set — funnel metrics skipped (note: the project key is ingestion-only; querying needs a personal API key).',
      byId: {},
    };
  }

  const ids = contentIds.filter((id) => CONTENT_ID_PATTERN.test(id));
  if (ids.length === 0) return { available: true, detail: 'No published content IDs to query.', byId: {} };

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
    return { available: false, detail: `PostHog query returned ${response.status}.`, byId: {} };
  }

  const payload = (await response.json()) as { results?: [string, string, number][] };
  const byId: Record<string, FunnelMetrics> = {};

  for (const row of payload.results ?? []) {
    const [cid, event, count] = row;
    const field = EVENT_TO_FIELD[event];
    if (!field || typeof cid !== 'string' || typeof count !== 'number') continue;
    byId[cid] = { ...byId[cid], [field]: count };
  }

  return { available: true, detail: `Funnel metrics for ${Object.keys(byId).length} item(s).`, byId };
}
