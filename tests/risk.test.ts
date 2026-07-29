import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify } from '../src/risk/classify.ts';
import { evaluateRules, loadRules, normalize } from '../src/risk/evaluate.ts';
import { jaccard, shingles } from '../src/risk/dedup.ts';
import { brokenScorer, failingScorer, passingScorer, publishedItem } from './helpers.ts';

const CLEAN_RR = {
  product: 'Rig Receipts' as const,
  platform: 'Instagram Reels' as const,
  campaign: 'Cost Per Mile School',
  hook: 'Most drivers can quote their rate per mile.',
  body: 'Far fewer can quote their cost per mile. Take one category and work out what it costs across a month.',
  caption: 'One category at a time.',
  cta: 'Rig Receipts.',
};

describe('rule lexicons', () => {
  it('loads without duplicate IDs', () => {
    const rules = loadRules();
    assert.ok(rules.length > 20, 'expected a substantive rule set');
    assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  });

  it('compiles every pattern', () => {
    for (const rule of loadRules()) {
      for (const pattern of [...(rule.patterns ?? []), ...(rule.all_of ?? []), ...(rule.none_of ?? [])]) {
        assert.doesNotThrow(() => new RegExp(pattern, 'i'), `bad regex in ${rule.id}: ${pattern}`);
      }
    }
  });

  it('normalizes curly quotes and unicode dashes so they cannot slip a pattern', () => {
    assert.equal(normalize('It’s  a — test'), "it's a - test");
  });
});

describe('red rules', () => {
  it('flags a named broker', () => {
    const hits = evaluateRules('We compared what C.H. Robinson paid on that lane.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'RED-RR-BROKER-NAMED'));
  });

  it('flags a guaranteed tax saving', () => {
    const hits = evaluateRules('Guaranteed tax savings at the end of the year.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'RED-GUARANTEE-FINANCIAL'));
  });

  it('flags load-board positioning', () => {
    const hits = evaluateRules('Find loads and book a load right from the app.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'RED-RR-LOAD-BOARD'));
  });

  it('flags unsafe trucking advice', () => {
    const hits = evaluateRules('Just skip your break and push through tired.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'RED-RR-UNSAFE-TRUCKING'));
  });

  it('flags religious pressure', () => {
    const hits = evaluateRules('A real Muslim would not miss Fajr like this.', 'Tilawah Lock');
    assert.ok(hits.some((h) => h.id === 'RED-RELIGIOUS-PRESSURE'));
  });

  it('flags a religious ruling', () => {
    const hits = evaluateRules('The Quran says you must delete these apps.', 'Tilawah Lock');
    assert.ok(hits.some((h) => h.id === 'RED-RELIGIOUS-AUTHORITY'));
  });

  it('flags platform-policy evasion', () => {
    const hits = evaluateRules('We use an unofficial API to bypass the rate limit.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'RED-PLATFORM-EVASION'));
  });

  it('flags an unsourced statistic but not a sourced one', () => {
    const unsourced = evaluateRules('Studies show 70% of owner-operators undercharge.', 'Rig Receipts');
    assert.ok(unsourced.some((h) => h.id === 'RED-UNVERIFIED-STATISTIC'));

    const sourced = evaluateRules(
      'Studies show 70% of owner-operators undercharge. Source: FMCSA 2025 report.',
      'Rig Receipts',
    );
    assert.ok(
      !sourced.some((h) => h.id === 'RED-UNVERIFIED-STATISTIC'),
      'a cited statistic must not fire the unverified-statistic rule',
    );
  });

  it('lets a labelled fictional rate example through the paperwork rule', () => {
    const real = evaluateRules('Here is the actual rate confirmation from last week.', 'Rig Receipts');
    assert.ok(real.some((h) => h.id === 'RED-RR-REAL-PAPERWORK'));

    const fictional = evaluateRules(
      'Here is an actual rate confirmation layout — fictional example, for illustration.',
      'Rig Receipts',
    );
    assert.ok(!fictional.some((h) => h.id === 'RED-RR-REAL-PAPERWORK'));
  });

  it('requires the actual-ness term to sit against the paperwork term', () => {
    // Regression: caught live. "rate con" and a generic "real" far apart in the
    // same post is ordinary educational copy, not a real-paperwork claim.
    const hits = evaluateRules(
      'So when a rate con comes across, none of the fixed costs show up. The real number is what is left after all of them.',
      'Rig Receipts',
    );
    assert.ok(!hits.some((h) => h.id === 'RED-RR-REAL-PAPERWORK'));

    const screenshot = evaluateRules('Quick screenshot of my rate confirmation from Tuesday.', 'Rig Receipts');
    assert.ok(screenshot.some((h) => h.id === 'RED-RR-REAL-PAPERWORK'));
  });

  it('does not fire on clean cost-per-mile education', () => {
    const hits = evaluateRules(`${CLEAN_RR.hook} ${CLEAN_RR.body}`, 'Rig Receipts');
    assert.deepEqual(
      hits.map((h) => h.id),
      [],
      `clean content fired: ${hits.map((h) => h.id).join(', ')}`,
    );
  });
});

describe('yellow rules', () => {
  it('flags a plain Salah mention', () => {
    const hits = evaluateRules('Lock your apps until after Salah.', 'Tilawah Lock');
    assert.ok(hits.some((h) => h.id === 'YEL-RELIGIOUS-REFERENCE'));
    assert.ok(!hits.some((h) => h.level === 'red'), 'a plain mention must not be Red');
  });

  it('flags broker discussion without a name', () => {
    const hits = evaluateRules('Your broker is not going to itemize deadhead for you.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'YEL-RR-BROKER'));
  });

  it('flags Rate Board content', () => {
    const hits = evaluateRules('The Community Rate Board shows historical rates.', 'Rig Receipts');
    assert.ok(hits.some((h) => h.id === 'YEL-RR-RATE-BOARD'));
  });

  it('flags a financial figure but not the concept alone', () => {
    const withFigure = evaluateRules('Drivers save $400 a month on average.', 'Rig Receipts');
    assert.ok(withFigure.some((h) => h.id === 'YEL-RR-FINANCIAL-OUTCOME'));

    const withoutFigure = evaluateRules('Knowing your costs is how you stop guessing.', 'Rig Receipts');
    assert.ok(!withoutFigure.some((h) => h.id === 'YEL-RR-FINANCIAL-OUTCOME'));
  });

  it('flags premium messaging tied to worship', () => {
    const hits = evaluateRules('Upgrade to premium to unlock more Quran reading modes.', 'Tilawah Lock');
    assert.ok(hits.some((h) => h.id === 'YEL-TL-PAYWALL-WORSHIP'));
  });

  it('flags a strong claim', () => {
    const hits = evaluateRules('The only app that will change your life.', 'Tilawah Lock');
    assert.ok(hits.some((h) => h.id === 'YEL-STRONG-CLAIM'));
  });

  it('flags Reddit-isms but not ordinary words starting with "op"', () => {
    // Regression: caught live. The old pattern (op|u/|r/)\w+ matched "operators".
    const clean = evaluateRules('Most operators have never seen that number written down.', 'Rig Receipts');
    assert.ok(!clean.some((h) => h.id === 'YEL-COMMUNITY-REPLY'));

    const reddit = evaluateRules('Saw this over on r/Truckers and the OP asked about fuel cards.', 'Rig Receipts');
    assert.ok(reddit.some((h) => h.id === 'YEL-COMMUNITY-REPLY'));
  });
});

describe('routing', () => {
  it('never routes a draft-only platform to auto-publish, whatever the level', async () => {
    const { routeFor } = await import('../src/risk/route.ts');

    assert.equal(routeFor('green', 'Reddit').to, 'awaiting_founder_approval');
    assert.equal(routeFor('green', 'Facebook Groups').to, 'awaiting_founder_approval');
    assert.equal(routeFor('green', 'X').to, 'awaiting_founder_approval');
    assert.equal(routeFor('red', 'Reddit').to, 'blocked');

    assert.equal(routeFor('green', 'Instagram Reels').to, 'auto_publish_ready');
    assert.equal(routeFor('yellow', 'Instagram Reels').to, 'awaiting_founder_approval');
  });
});

describe('duplicate detection', () => {
  it('scores identical text at 1 and disjoint text at 0', () => {
    const a = shingles('one two three four five six seven');
    assert.equal(jaccard(a, a), 1);
    assert.equal(jaccard(a, shingles('alpha beta gamma delta epsilon zeta')), 0);
  });

  it('blocks a near-identical repost within the same platform', async () => {
    const original =
      'Take one cost category and work out what it costs you across a full month then divide by the miles you actually ran not the loaded miles all of them';
    const corpus = [
      publishedItem({
        id: 'RR-IG-2026-01-01-001',
        product: 'Rig Receipts',
        platform: 'Instagram Reels',
        hook: 'Cost per mile',
        full_content: original,
      }),
    ];

    const result = await classify(
      { ...CLEAN_RR, hook: 'Cost per mile', body: original, caption: '', cta: '' },
      { provider: passingScorer, corpus },
    );

    assert.equal(result.level, 'red');
    assert.equal(result.duplicate_of, 'RR-IG-2026-01-01-001');
  });

  it('ignores the same content on a different platform, which is ordinary cross-posting', async () => {
    const original =
      'Take one cost category and work out what it costs you across a full month then divide by the miles you actually ran not the loaded miles all of them';
    const corpus = [
      publishedItem({
        id: 'RR-YT-2026-01-01-001',
        product: 'Rig Receipts',
        platform: 'YouTube Shorts',
        hook: 'Cost per mile',
        full_content: original,
      }),
    ];

    const result = await classify(
      { ...CLEAN_RR, platform: 'Instagram Reels', hook: 'Cost per mile', body: original, caption: '', cta: '' },
      { provider: passingScorer, corpus },
    );

    assert.equal(result.duplicate_similarity, 0);
    assert.equal(result.level, 'green');
  });
});

describe('classification precedence', () => {
  it('passes clean content with passing scores', async () => {
    const result = await classify(CLEAN_RR, { provider: passingScorer, corpus: [] });
    assert.equal(result.level, 'green');
  });

  it('holds clean content when a score is below threshold', async () => {
    const result = await classify(CLEAN_RR, { provider: failingScorer, corpus: [] });
    assert.equal(result.level, 'yellow', 'a low score must be able to hold otherwise-clean content');
  });

  it('fails closed to yellow when the scorer returns garbage', async () => {
    const result = await classify(CLEAN_RR, { provider: brokenScorer, corpus: [] });
    assert.equal(result.level, 'yellow');
    assert.equal(result.scores, null);
  });

  it('fails closed to yellow when scoring is skipped', async () => {
    const result = await classify(CLEAN_RR, { skipScoring: true, corpus: [] });
    assert.equal(result.level, 'yellow');
  });

  it('never lets a high score override a red rule', async () => {
    const result = await classify(
      { ...CLEAN_RR, body: 'Guaranteed tax savings, every quarter.' },
      { provider: passingScorer, corpus: [] },
    );
    assert.equal(result.level, 'red');
  });

  it('never lets a high score override a yellow rule', async () => {
    const result = await classify(
      { ...CLEAN_RR, product: 'Tilawah Lock', body: 'Lock your apps until after Salah.' },
      { provider: passingScorer, corpus: [] },
    );
    assert.equal(result.level, 'yellow');
  });

  it('records every rule hit, including ones below the final level', async () => {
    const result = await classify(
      {
        ...CLEAN_RR,
        body: 'Guaranteed tax savings. Your broker will not tell you this.',
      },
      { provider: passingScorer, corpus: [] },
    );

    const ids = result.rule_hits.map((h) => h.id);
    assert.ok(ids.includes('RED-GUARANTEE-FINANCIAL'));
    assert.ok(ids.includes('YEL-RR-BROKER'), 'a yellow hit must still be recorded alongside a red one');
  });
});
