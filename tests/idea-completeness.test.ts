import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ASO_IDEA_MAX, ASO_IDEA_MIN, generateForProduct, validateAsoIdea } from '../src/content/generate.ts';
import { paths, REPO_ROOT } from '../src/lib/paths.ts';
import { dayId } from '../src/lib/dates.ts';
import { stubProvider } from './helpers.ts';
import type { ContentItem } from '../src/lib/types.ts';

const createdIds: string[] = [];
after(() => {
  for (const id of createdIds) {
    const file = join(REPO_ROOT, 'content', 'drafts', `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
  }
});
const track = (items: ContentItem[]) => createdIds.push(...items.map((i) => i.id));

/** The two shapes observed on 2026-08-04, both cut by a silent 600-char slice. */
const TRUNCATED_RR =
  'The App Store screenshot set currently leads with the receipt capture flow, which is the feature but not ' +
  'the reason anyone opens the app. Reorder so screenshot 1 is the load breakdown, captioned "Gross rate is ' +
  'not profit." That single image carries the whole promise. Same assets, no new design work; ' +
  "it's a reorder plus one new caption ";

const TRUNCATED_TL =
  'Move the lockout answer into the first App Store screenshot instead of the third. Right now the opening ' +
  'screenshot sells the lock, and most people never swipe past screenshot one. Make screenshot 1 a two-column ' +
  'frame over the lock screen. Keep the current lock demo as screenshot 2. The same two-column b';

const VALID_IDEA =
  'Move the lockout answer into the first App Store screenshot instead of the third, because most people never ' +
  'swipe past screenshot one. Keep the current lock demo as screenshot 2 so the sequence still reads as a demo.';

describe('aso idea validation', () => {
  it('rejects the exact trailing-whitespace shape from 2026-08-04', () => {
    const result = validateAsoIdea(TRUNCATED_RR);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /trailing whitespace/);
    assert.match(result.reason, /one new caption/, 'quotes the evidence');
  });

  it('rejects the exact mid-word shape from 2026-08-04', () => {
    const result = validateAsoIdea(TRUNCATED_TL);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /mid-sentence with no terminator/);
    assert.match(result.reason, /two-column b/, 'quotes the evidence');
  });

  it('accepts a complete idea and returns it trimmed', () => {
    const result = validateAsoIdea(VALID_IDEA);
    assert.ok(result.ok, result.ok ? '' : result.reason);
    if (!result.ok) return;
    assert.equal(result.idea, VALID_IDEA);
  });

  it('accepts terminators closed by a quote or bracket', () => {
    for (const suffix of ['."', ".'", '.)', '!', '?']) {
      const idea = `${VALID_IDEA.slice(0, -1)}${suffix}`;
      assert.ok(validateAsoIdea(idea).ok, `should accept ending ${JSON.stringify(suffix)}`);
    }
  });

  it('reports an absent idea distinctly from an incomplete one', () => {
    for (const empty of [undefined, '', '   ']) {
      const result = validateAsoIdea(empty);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, 'absent', 'absence is not a failure to report as truncation');
    }
  });

  it('rejects an abnormally short entry', () => {
    const result = validateAsoIdea('Reorder the screenshots.');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, new RegExp(`${ASO_IDEA_MIN}-char minimum`));
  });

  it('treats an over-length idea as incomplete rather than truncating it', () => {
    // The original bug in one assertion: the cap must never silently slice.
    const long = `${'word '.repeat(ASO_IDEA_MAX)}end.`;
    const result = validateAsoIdea(long);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /treated as incomplete rather than truncated/);
  });
});

describe('generation refuses to file an incomplete idea', () => {
  const response = (idea: string) =>
    JSON.stringify({
      items: [
        {
          kind: 'video_concept',
          campaign: 'Gross Rate Is Not Profit',
          hook: 'A hook.',
          body: 'A fictional body.',
          caption: 'A caption.',
          cta: 'A CTA.',
        },
      ],
      aso_idea: idea,
    });

  it('keeps valid drafts, drops the idea, and reports the failure', async () => {
    const ideasFile = join(paths.analytics, 'daily', `${dayId()}-ideas.md`);
    const before = existsSync(ideasFile) ? readFileSync(ideasFile, 'utf8') : null;

    const result = await generateForProduct('Rig Receipts', stubProvider(response(TRUNCATED_TL)));
    track(result.created);

    assert.equal(result.created.length, 1, 'independently valid drafts are preserved');
    assert.equal(result.aso_idea, null, 'no idea is returned');
    assert.ok(result.aso_idea_error, 'the failure is surfaced, not swallowed');
    assert.match(result.aso_idea_error ?? '', /mid-sentence/);
    assert.ok(result.skipped.some((s) => s.kind === 'aso_idea'));

    const after = existsSync(ideasFile) ? readFileSync(ideasFile, 'utf8') : null;
    assert.equal(after, before, 'nothing written to analytics/daily');
  });

  it('does not repair or invent the missing ending', async () => {
    const result = await generateForProduct('Rig Receipts', stubProvider(response(TRUNCATED_RR)));
    track(result.created);

    assert.equal(result.aso_idea, null);
    assert.match(result.aso_idea_error ?? '', /trailing whitespace/);
    // The rejected text is quoted as evidence but never completed.
    assert.doesNotMatch(result.aso_idea_error ?? '', /caption\./, 'no fabricated terminator');
  });

  it('reports no idea-error when the model returns none at all', async () => {
    const result = await generateForProduct(
      'Rig Receipts',
      stubProvider(JSON.stringify({ items: [{ kind: 'video_concept', campaign: 'Gross Rate Is Not Profit', hook: 'h', body: 'b', caption: '', cta: '' }] })),
    );
    track(result.created);
    assert.equal(result.aso_idea, null);
    assert.equal(result.aso_idea_error, null, 'absence is not an incompleteness failure');
  });
});
