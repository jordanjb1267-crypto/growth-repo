import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify } from '../src/risk/classify.ts';
import { computeTemplateHash, loadTemplate, renderTemplate } from '../src/templates/template.ts';
import { passingScorer } from './helpers.ts';

const TL_TEMPLATE_ID = 'TL-QURAN-LOCK-PRELAUNCH-001';
const RR_TEMPLATE_ID = 'RR-CPM-BASICS-001';

function tlTemplate() {
  const template = loadTemplate('Tilawah Lock', TL_TEMPLATE_ID);
  assert.ok(template, `${TL_TEMPLATE_ID} should exist`);
  return template;
}

function rrTemplate() {
  const template = loadTemplate('Rig Receipts', RR_TEMPLATE_ID);
  assert.ok(template, `${RR_TEMPLATE_ID} should exist`);
  return template;
}

describe('template integrity', () => {
  it('ships sealed — the stored hash matches the frozen text', () => {
    for (const template of [tlTemplate(), rrTemplate()]) {
      assert.equal(computeTemplateHash(template), template.content_hash, `${template.id} is sealed`);
    }
  });

  it('the retired Focus Lock template no longer loads under its old id', () => {
    // It described Quran Lock behaviour under a Focus Lock name and claimed
    // streaks did not exist. Retired outright — deliberately no alias, so any
    // item still holding the old id fails closed instead of silently
    // inheriting the corrected exemption.
    assert.equal(loadTemplate('Tilawah Lock', 'TL-FOCUS-LOCK-DEMO-001'), null);
  });

  it('renders the slot-free Tilawah template and issues an exemption', () => {
    const result = renderTemplate(tlTemplate(), {});

    assert.ok(result.ok, result.ok ? '' : result.failures.join('; '));
    if (!result.ok) return;
    assert.ok(!result.body.includes('{{'), 'no placeholder should survive rendering');
    assert.equal(result.exemption.template_id, TL_TEMPLATE_ID);
  });

  it('refuses any value supplied to a slot-free template', () => {
    // With no declared slots there is no substitution point at all, which is
    // what removes slot-smuggling as a risk for the religious template.
    const result = renderTemplate(tlTemplate(), { smuggled: 'anything' });
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('undeclared slot')));
  });

  it('voids the exemption when the frozen text has been edited since approval', () => {
    const tampered = { ...tlTemplate(), body: 'Different body text entirely.' };
    const result = renderTemplate(tampered, {});

    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('edited since approval')));
  });

  it('refuses a template carrying no approval record', () => {
    const unapproved = { ...tlTemplate(), approved_by: '', approved_at: '' };
    assert.ok(!renderTemplate(unapproved, {}).ok);
  });
});

describe('slot rule-checking', () => {
  // Exercised against the Rig Receipts template, the one that still declares a
  // slot. The guarantee under test is the same for any template: a slot value
  // is rule-checked in isolation, so nothing new can enter through it.
  it('renders with a clean slot value', () => {
    const result = renderTemplate(rrTemplate(), { cost_category: 'tires' });

    assert.ok(result.ok, result.ok ? '' : result.failures.join('; '));
    if (!result.ok) return;
    assert.ok(result.body.includes('tires'));
    assert.ok(!result.body.includes('{{'), 'no placeholder should survive rendering');
    assert.equal(result.exemption.template_id, RR_TEMPLATE_ID);
  });

  it('refuses a slot value carrying a red claim', () => {
    const result = renderTemplate(rrTemplate(), { cost_category: 'guaranteed tax savings' });
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.slot_hits.some((h) => h.level === 'red'));
  });

  it('refuses a slot value that trips any rule, not only red ones', () => {
    assert.ok(!renderTemplate(rrTemplate(), { cost_category: 'better than other apps' }).ok);
  });

  it('refuses a slot value containing template syntax', () => {
    const result = renderTemplate(rrTemplate(), { cost_category: '{{cost_category}}' });
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('template syntax')));
  });

  it('refuses a slot value containing a line break', () => {
    assert.ok(!renderTemplate(rrTemplate(), { cost_category: 'tires\nand tolls' }).ok);
  });

  it('refuses an over-length slot value', () => {
    assert.ok(!renderTemplate(rrTemplate(), { cost_category: 'x'.repeat(200) }).ok);
  });

  it('refuses a missing slot value', () => {
    const result = renderTemplate(rrTemplate(), {});
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('cost_category')));
  });

  it('refuses an undeclared slot value', () => {
    assert.ok(!renderTemplate(rrTemplate(), { cost_category: 'tires', smuggled: 'anything' }).ok);
  });
});

describe('template exemption in classification', () => {
  it('turns religious content green when the exemption holds', async () => {
    const rendered = renderTemplate(tlTemplate(), {});
    assert.ok(rendered.ok);
    if (!rendered.ok) return;

    const fields = {
      product: 'Tilawah Lock' as const,
      platform: 'Instagram Reels' as const,
      campaign: 'Read Before You Scroll',
      hook: rendered.hook,
      body: rendered.body,
      caption: rendered.caption,
      cta: rendered.cta,
    };

    // Without the exemption this same text is Yellow.
    const gated = await classify(fields, { provider: passingScorer, corpus: [] });
    assert.equal(gated.level, 'yellow');
    assert.ok(gated.rule_hits.some((h) => h.id === 'YEL-RELIGIOUS-REFERENCE'));

    // With it, the same text auto-publishes.
    const exempt = await classify(
      { ...fields, templateExemption: rendered.exemption },
      { provider: passingScorer, corpus: [] },
    );
    assert.equal(exempt.level, 'green');
    assert.ok(
      exempt.rule_hits.some((h) => h.id === 'YEL-RELIGIOUS-REFERENCE'),
      'the discounted hit must still be recorded for auditability',
    );
  });

  it('does not let an exemption discount a red rule', async () => {
    const rendered = renderTemplate(tlTemplate(), {});
    assert.ok(rendered.ok);
    if (!rendered.ok) return;

    // Simulates a red hit arising from the interaction of frozen text and
    // surrounding copy — the case a slot-only check would miss.
    const result = await classify(
      {
        product: 'Tilawah Lock',
        platform: 'Instagram Reels',
        campaign: 'Read Before You Scroll',
        hook: rendered.hook,
        body: `${rendered.body} A real Muslim would not need this reminder.`,
        caption: rendered.caption,
        cta: rendered.cta,
        templateExemption: rendered.exemption,
      },
      { provider: passingScorer, corpus: [] },
    );

    assert.equal(result.level, 'red');
  });
});
