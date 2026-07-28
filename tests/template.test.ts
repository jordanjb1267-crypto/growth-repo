import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify } from '../src/risk/classify.ts';
import { computeTemplateHash, loadTemplate, renderTemplate } from '../src/templates/template.ts';
import { passingScorer } from './helpers.ts';

const TL_TEMPLATE_ID = 'TL-FOCUS-LOCK-DEMO-001';

function tlTemplate() {
  const template = loadTemplate('Tilawah Lock', TL_TEMPLATE_ID);
  assert.ok(template, `${TL_TEMPLATE_ID} should exist`);
  return template;
}

describe('template integrity', () => {
  it('ships sealed — the stored hash matches the frozen text', () => {
    const template = tlTemplate();
    assert.equal(computeTemplateHash(template), template.content_hash);
  });

  it('renders with clean slot values', () => {
    const result = renderTemplate(tlTemplate(), {
      session_length: 'Two minutes',
      app_category: 'social apps',
    });

    assert.ok(result.ok, result.ok ? '' : result.failures.join('; '));
    if (!result.ok) return;

    assert.ok(result.body.includes('Two minutes'));
    assert.ok(!result.body.includes('{{'), 'no placeholder should survive rendering');
    assert.equal(result.exemption.template_id, TL_TEMPLATE_ID);
  });

  it('refuses a slot value that carries a new religious claim', () => {
    // This is the condition the whole exemption rests on: religious framing was
    // approved once in the frozen text, and nothing new may enter via a slot.
    const result = renderTemplate(tlTemplate(), {
      session_length: 'Guaranteed forgiveness',
      app_category: 'social apps',
    });

    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.slot_hits.some((h) => h.level === 'red'));
  });

  it('refuses a slot value that trips any rule, not only red ones', () => {
    const result = renderTemplate(tlTemplate(), {
      session_length: 'Two minutes',
      app_category: 'better than other apps',
    });

    assert.ok(!result.ok);
  });

  it('refuses a slot value containing template syntax', () => {
    const result = renderTemplate(tlTemplate(), {
      session_length: '{{app_category}}',
      app_category: 'social apps',
    });
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('template syntax')));
  });

  it('refuses a slot value containing a line break', () => {
    const result = renderTemplate(tlTemplate(), {
      session_length: 'Two\nminutes',
      app_category: 'social apps',
    });
    assert.ok(!result.ok);
  });

  it('refuses an over-length slot value', () => {
    const result = renderTemplate(tlTemplate(), {
      session_length: 'x'.repeat(200),
      app_category: 'social apps',
    });
    assert.ok(!result.ok);
  });

  it('refuses a missing slot value', () => {
    const result = renderTemplate(tlTemplate(), { session_length: 'Two minutes' });
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('app_category')));
  });

  it('voids the exemption when the frozen text has been edited since approval', () => {
    const tampered = { ...tlTemplate(), body: 'Different body text entirely. {{session_length}}' };
    const result = renderTemplate(tampered, { session_length: 'Two minutes', app_category: 'social apps' });

    assert.ok(!result.ok);
    if (result.ok) return;
    assert.ok(result.failures.some((f) => f.includes('edited since approval')));
  });

  it('refuses a template carrying no approval record', () => {
    const unapproved = { ...tlTemplate(), approved_by: '', approved_at: '' };
    const result = renderTemplate(unapproved, { session_length: 'Two minutes', app_category: 'social apps' });
    assert.ok(!result.ok);
  });

  it('refuses an undeclared slot value', () => {
    const result = renderTemplate(tlTemplate(), {
      session_length: 'Two minutes',
      app_category: 'social apps',
      smuggled: 'anything',
    });
    assert.ok(!result.ok);
  });
});

describe('template exemption in classification', () => {
  it('turns religious content green when the exemption holds', async () => {
    const rendered = renderTemplate(tlTemplate(), {
      session_length: 'Two minutes',
      app_category: 'social apps',
    });
    assert.ok(rendered.ok);
    if (!rendered.ok) return;

    // Without the exemption this same text is Yellow.
    const gated = await classify(
      {
        product: 'Tilawah Lock',
        platform: 'Instagram Reels',
        campaign: 'Read Before You Scroll',
        hook: rendered.hook,
        body: rendered.body,
        caption: rendered.caption,
        cta: rendered.cta,
      },
      { provider: passingScorer, corpus: [] },
    );
    assert.equal(gated.level, 'yellow');
    assert.ok(gated.rule_hits.some((h) => h.id === 'YEL-RELIGIOUS-REFERENCE'));

    // With it, the same text auto-publishes.
    const exempt = await classify(
      {
        product: 'Tilawah Lock',
        platform: 'Instagram Reels',
        campaign: 'Read Before You Scroll',
        hook: rendered.hook,
        body: rendered.body,
        caption: rendered.caption,
        cta: rendered.cta,
        templateExemption: rendered.exemption,
      },
      { provider: passingScorer, corpus: [] },
    );
    assert.equal(exempt.level, 'green');
    assert.ok(
      exempt.rule_hits.some((h) => h.id === 'YEL-RELIGIOUS-REFERENCE'),
      'the discounted hit must still be recorded for auditability',
    );
  });

  it('does not let an exemption discount a red rule', async () => {
    const rendered = renderTemplate(tlTemplate(), {
      session_length: 'Two minutes',
      app_category: 'social apps',
    });
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
