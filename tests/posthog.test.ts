import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectFunnel, projectEnvKey, projectIdFor } from '../src/analytics/posthog.ts';
import type { FunnelSubject } from '../src/analytics/posthog.ts';

/** Fake fetch recording each project URL it was pointed at. */
function fakeFetch(resultsByProject: Record<string, [string, string, number][]>) {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    const project = url.match(/\/api\/projects\/([^/]+)\//)?.[1] ?? '';
    return new Response(JSON.stringify({ results: resultsByProject[project] ?? [] }), {
      status: resultsByProject[project] === undefined ? 404 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const SUBJECTS: FunnelSubject[] = [
  { id: 'RR-IG-2026-01-01-001', product: 'Rig Receipts' },
  { id: 'TL-IG-2026-01-01-001', product: 'Tilawah Lock' },
];

const BASE_ENV = {
  POSTHOG_PERSONAL_API_KEY: 'phx_test',
  POSTHOG_PROJECT_ID_RIG_RECEIPTS: '518659',
  POSTHOG_PROJECT_ID_TILAWAH_LOCK: '538185',
} as NodeJS.ProcessEnv;

describe('posthog project resolution', () => {
  it('prefers the per-product key over the single-project fallback', () => {
    const env = { POSTHOG_PROJECT_ID_RIG_RECEIPTS: '1', POSTHOG_PROJECT_ID: '999' } as NodeJS.ProcessEnv;
    assert.equal(projectIdFor('Rig Receipts', env), '1');
    assert.equal(projectIdFor('Tilawah Lock', env), '999', 'falls back when the product key is unset');
    assert.equal(projectIdFor('Tilawah Lock', {} as NodeJS.ProcessEnv), null);
    assert.equal(projectEnvKey('Tilawah Lock'), 'POSTHOG_PROJECT_ID_TILAWAH_LOCK');
  });
});

describe('per-product funnel collection', () => {
  it('queries each product against its own project and merges the results', async () => {
    const { impl, calls } = fakeFetch({
      '518659': [['RR-IG-2026-01-01-001', 'install', 12]],
      '538185': [['TL-IG-2026-01-01-001', 'trial_start', 4]],
    });

    const result = await collectFunnel(SUBJECTS, BASE_ENV, impl);

    assert.ok(result.available);
    assert.equal(result.byId['RR-IG-2026-01-01-001']?.installs, 12);
    assert.equal(result.byId['TL-IG-2026-01-01-001']?.trial_starts, 4);
    assert.equal(calls.length, 2, 'one query per product');

    // Each project is only asked about its own product's content IDs.
    const rr = calls.find((c) => c.url.includes('/518659/'));
    assert.ok(rr);
    assert.ok(rr.body.includes('RR-IG-2026-01-01-001'));
    assert.ok(!rr.body.includes('TL-IG-2026-01-01-001'), 'no cross-project ID leakage');
  });

  it('reports a product with no project as missing, not as zero', async () => {
    const { impl, calls } = fakeFetch({ '518659': [['RR-IG-2026-01-01-001', 'install', 12]] });
    const env = { ...BASE_ENV, POSTHOG_PROJECT_ID_TILAWAH_LOCK: '' } as NodeJS.ProcessEnv;

    const result = await collectFunnel(SUBJECTS, env, impl);

    assert.equal(calls.length, 1, 'the unconfigured product is not queried');
    assert.equal(result.byId['TL-IG-2026-01-01-001'], undefined, 'absent, not zeroed');
    assert.match(result.detail, /POSTHOG_PROJECT_ID_TILAWAH_LOCK not set/);
    assert.match(result.detail, /Rig Receipts: 1 item/, 'the configured product still reports');
  });

  it('a failing project does not lose the other product\'s data', async () => {
    // 538185 absent from the map → the fake returns 404 for it.
    const { impl } = fakeFetch({ '518659': [['RR-IG-2026-01-01-001', 'install', 3]] });
    const result = await collectFunnel(SUBJECTS, BASE_ENV, impl);

    assert.equal(result.byId['RR-IG-2026-01-01-001']?.installs, 3);
    assert.match(result.detail, /returned 404/);
  });

  it('skips entirely without a personal API key', async () => {
    const { impl, calls } = fakeFetch({});
    const result = await collectFunnel(SUBJECTS, {} as NodeJS.ProcessEnv, impl);
    assert.equal(result.available, false);
    assert.equal(calls.length, 0);
    assert.match(result.detail, /POSTHOG_PERSONAL_API_KEY/);
  });

  it('filters malformed content IDs out of the query', async () => {
    const { impl, calls } = fakeFetch({ '518659': [] });
    await collectFunnel(
      [{ id: "RR'; drop table events--", product: 'Rig Receipts' }, SUBJECTS[0]!],
      BASE_ENV,
      impl,
    );
    assert.equal(calls.length, 1);
    assert.ok(!calls[0]?.body.includes('drop table'), 'only pattern-valid IDs reach the query');
  });
});
