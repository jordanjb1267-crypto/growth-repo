/**
 * Risk classification — the orchestration layer.
 *
 * The ordering here is the whole safety argument, so it is worth stating
 * plainly:
 *
 *   deterministic rules  ->  duplicate check  ->  model scores  ->  MOST SEVERE WINS
 *
 * The model can only ever make the outcome worse. There is no path by which a
 * high score lifts content above a triggered Red or Yellow rule, and a scoring
 * failure produces Yellow rather than Green. A template exemption can discount
 * Yellow rule hits — never Red ones — and only when every template-integrity
 * condition held.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { mostSevere, PRODUCT_SLUGS } from '../lib/types.ts';
import { evaluateRules, levelFromHits } from './evaluate.ts';
import {
  findClosestPublished,
  RED_THRESHOLD,
  TEMPLATE_RED_THRESHOLD,
  TEMPLATE_YELLOW_THRESHOLD,
  YELLOW_THRESHOLD,
} from './dedup.ts';
import { scoreContent, scoresPass } from './score.ts';
import type { LlmProvider } from '../llm/provider.ts';
import type {
  Classification,
  ContentItem,
  Platform,
  Product,
  RiskLevel,
  RuleHit,
  TemplateExemption,
} from '../lib/types.ts';

export interface ClassifyInput {
  id?: string;
  product: Product;
  platform: Platform;
  campaign: string;
  hook: string;
  body: string;
  caption: string;
  cta: string;
  /** Present only when the item was rendered from an approved template and
   *  every integrity condition in renderTemplate() held. */
  templateExemption?: TemplateExemption | null;
}

export interface ClassifyOptions {
  provider?: LlmProvider;
  corpus?: ContentItem[];
  /** Skip the model call. Used by tests and by any path that must stay
   *  deterministic; the result fails closed to Yellow, never Green. */
  skipScoring?: boolean;
}

function loadBrandContext(product: Product): string {
  const file = join(paths.brands, `${PRODUCT_SLUGS[product]}.md`);
  const shared = join(paths.brands, 'shared-rules.md');
  const parts: string[] = [];
  if (existsSync(shared)) parts.push(readFileSync(shared, 'utf8'));
  if (existsSync(file)) parts.push(readFileSync(file, 'utf8'));
  return parts.join('\n\n');
}

function duplicateLevel(similarity: number, hasTemplateExemption: boolean): RiskLevel {
  const red = hasTemplateExemption ? TEMPLATE_RED_THRESHOLD : RED_THRESHOLD;
  const yellow = hasTemplateExemption ? TEMPLATE_YELLOW_THRESHOLD : YELLOW_THRESHOLD;

  if (similarity >= red) return 'red';
  if (similarity >= yellow) return 'yellow';
  return 'green';
}

export async function classify(input: ClassifyInput, options: ClassifyOptions = {}): Promise<Classification> {
  const fullText = [input.hook, input.body, input.caption, input.cta].filter(Boolean).join('\n');

  // --- 1. Deterministic rules. The floor. -----------------------------------
  const ruleHits = evaluateRules(fullText, input.product);
  const redHits = ruleHits.filter((h) => h.level === 'red');
  const exemption = input.templateExemption ?? null;

  // A template exemption discounts Yellow hits only. It cannot reach a Red hit:
  // Red rules encode the spec's hard constraints, and a template was never
  // approved to override those. A Red hit can also arise from the interaction
  // of frozen text and a slot value, which is precisely the case that must
  // still stop the item.
  const hasExemption = Boolean(exemption);
  const effectiveHits: RuleHit[] = hasExemption ? redHits : ruleHits;
  const ruleLevel = levelFromHits(effectiveHits);

  // --- 2. Duplicate check. --------------------------------------------------
  const duplicate = findClosestPublished(
    fullText,
    input.product,
    input.platform,
    options.corpus,
    input.id,
  );
  const dupLevel = duplicateLevel(duplicate.similarity, hasExemption);

  // --- 3. Model scores. Can only raise the level. ---------------------------
  let scores = null;
  let scoreRationale = '';
  let scoreLevel: RiskLevel = 'green';

  if (options.skipScoring) {
    scoreLevel = 'yellow';
    scoreRationale = 'Scoring skipped; failing closed to approval-required.';
  } else {
    const result = await scoreContent(
      {
        product: input.product,
        campaign: input.campaign,
        hook: input.hook,
        body: input.body,
        caption: input.caption,
        cta: input.cta,
      },
      loadBrandContext(input.product),
      options.provider,
    );
    scores = result.scores;
    scoreRationale = result.rationale;
    // Below threshold, unavailable, or unparseable all land the same way:
    // held for a human. Green requires an affirmative pass.
    scoreLevel = scoresPass(scores) ? 'green' : 'yellow';
  }

  // --- 4. Most severe wins. -------------------------------------------------
  const level = mostSevere(ruleLevel, dupLevel, scoreLevel);

  return {
    level,
    // Record every hit, including ones discounted by the exemption, so a past
    // decision can be fully reconstructed.
    rule_hits: ruleHits,
    scores,
    duplicate_similarity: Number(duplicate.similarity.toFixed(4)),
    duplicate_of: duplicate.similarity >= YELLOW_THRESHOLD ? duplicate.closest_id : null,
    template_exemption: exemption ?? null,
    rationale: buildRationale({
      level,
      ruleLevel,
      dupLevel,
      scoreLevel,
      effectiveHits,
      allHits: ruleHits,
      hasExemption,
      similarity: duplicate.similarity,
      scoreRationale,
    }),
    classified_at: new Date().toISOString(),
  };
}

function buildRationale(ctx: {
  level: RiskLevel;
  ruleLevel: RiskLevel;
  dupLevel: RiskLevel;
  scoreLevel: RiskLevel;
  effectiveHits: RuleHit[];
  allHits: RuleHit[];
  hasExemption: boolean;
  similarity: number;
  scoreRationale: string;
}): string {
  const reasons: string[] = [];

  if (ctx.ruleLevel === ctx.level && ctx.effectiveHits.length > 0) {
    const driving = ctx.effectiveHits.filter((h) => h.level === ctx.level);
    reasons.push(`Rules: ${driving.map((h) => h.id).join(', ')}.`);
  }
  if (ctx.dupLevel === ctx.level && ctx.dupLevel !== 'green') {
    reasons.push(`Duplicate similarity ${(ctx.similarity * 100).toFixed(0)}% against published content.`);
  }
  if (ctx.scoreLevel === ctx.level && ctx.scoreLevel !== 'green') {
    reasons.push(ctx.scoreRationale || 'Rubric scores below threshold.');
  }
  if (ctx.hasExemption) {
    const discounted = ctx.allHits.filter((h) => h.level === 'yellow').length;
    if (discounted > 0) {
      reasons.push(
        `${discounted} yellow rule hit(s) discounted under a founder-approved template exemption; red rules were not discounted.`,
      );
    }
  }
  if (reasons.length === 0) reasons.push('No rule hits, no duplicate match, all rubric scores at or above threshold.');

  return reasons.join(' ');
}
