import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { generateForProduct } from '../src/content/generate.ts';
import { deriveExemption } from '../src/templates/template.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { stubProvider } from './helpers.ts';
import type { ContentItem } from '../src/lib/types.ts';

const createdIds: string[] = [];

function cleanup(): void {
  for (const id of createdIds) {
    const file = join(REPO_ROOT, 'content', 'drafts', `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
  }
}
after(cleanup);

function track(items: ContentItem[]): void {
  createdIds.push(...items.map((i) => i.id));
}

const GOOD_RESPONSE = JSON.stringify({
  items: [
    {
      kind: 'video_concept',
      campaign: 'Cost Per Mile School',
      hook: 'Your rate per mile is not your pay per mile.',
      body: 'Open on a rate confirmation total. Fictional example: subtract fuel, tolls, the maintenance reserve. Show the remainder.',
      caption: 'The number that matters is the one after the subtractions.',
      cta: 'Rig Receipts shows you the remainder.',
    },
    {
      kind: 'secondary_post',
      campaign: 'Gross Rate Is Not Profit',
      hook: 'A load that grossed well and paid badly.',
      body: 'A fictional walkthrough of why the same load can look strong on the board and weak in the bank.',
      caption: 'Gross is a headline. Net is a decision.',
      cta: 'Know what every load really pays.',
    },
    {
      kind: 'community_reply',
      campaign: 'Cost Per Mile School',
      hook: 'How do you all track expenses without losing your mind?',
      body: 'What worked for me was one habit: everything gets photographed the moment it happens, sorted later. The sorting is the easy part once capture is automatic.',
      caption: '',
      cta: '',
    },
  ],
  template_slots: { 'RR-CPM-BASICS-001': { cost_category: 'tires' } },
  // Empty deliberately: a non-empty idea appends to the real analytics/daily
  // ideas file, and tests must not write into production output.
  aso_idea: '',
});

describe('content generation', () => {
  it('creates the daily set with our platform routing, not the model\'s', async () => {
    const result = await generateForProduct('Rig Receipts', stubProvider(GOOD_RESPONSE));
    track(result.created);

    // 3 freeform + 1 template instance
    assert.equal(result.created.length, 4);

    const byPlatform = new Map(result.created.map((i) => [i.platform, i]));
    assert.ok(byPlatform.has('Instagram Reels'));
    assert.ok(byPlatform.has('LinkedIn'), 'RR secondary post routes to LinkedIn');
    assert.ok(byPlatform.has('Reddit'), 'community reply routes to draft-only Reddit');

    for (const item of result.created) {
      assert.equal(item.status, 'drafted');
      assert.equal(item.classification, null, 'generation never classifies');
      assert.equal(item.approval, null);
    }
  });

  it('produces a template instance whose exemption re-derives', async () => {
    const result = await generateForProduct('Rig Receipts', stubProvider(GOOD_RESPONSE));
    track(result.created);

    const templated = result.created.find((i) => i.template_id === 'RR-CPM-BASICS-001');
    assert.ok(templated, 'template instance should exist');
    assert.ok(templated.full_content.includes('tires'));
    assert.deepEqual(templated.template_slots, { cost_category: 'tires' });

    const exemption = deriveExemption(templated);
    assert.ok(exemption, 'a freshly rendered instance must re-derive its exemption');
    assert.equal(exemption.template_id, 'RR-CPM-BASICS-001');

    // Drift voids it — the same item with edited text no longer re-derives.
    const drifted = { ...templated, full_content: `${templated.full_content} extra sentence.` };
    assert.equal(deriveExemption(drifted), null);
  });

  it('skips a template instance whose slot value trips a rule', async () => {
    const response = JSON.stringify({
      items: [],
      template_slots: { 'RR-CPM-BASICS-001': { cost_category: 'guaranteed tax savings' } },
      aso_idea: '',
    });

    const result = await generateForProduct('Rig Receipts', stubProvider(response));
    track(result.created);

    assert.equal(result.created.length, 0, 'a rule-tripping slot value must not produce a draft at all');
    assert.ok(result.skipped.some((s) => s.kind === 'template:RR-CPM-BASICS-001'));
  });

  it('falls back to the default campaign for an invented campaign name', async () => {
    const response = JSON.stringify({
      items: [
        {
          kind: 'video_concept',
          campaign: 'Campaign That Does Not Exist',
          hook: 'A hook.',
          body: 'A body.',
          caption: '',
          cta: '',
        },
      ],
    });

    const result = await generateForProduct('Rig Receipts', stubProvider(response));
    track(result.created);
    assert.equal(result.created[0]?.campaign, 'Gross Rate Is Not Profit');
  });

  it('throws on unparseable output rather than creating anything', async () => {
    await assert.rejects(
      () => generateForProduct('Rig Receipts', stubProvider('not json at all')),
      /unparseable/,
    );
  });
});
