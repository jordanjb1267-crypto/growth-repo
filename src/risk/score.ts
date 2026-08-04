/**
 * Model-produced rubric scores.
 *
 * The spec gates Green on three scores >= 85 but never defines their scale or
 * how they are produced. This module defines them. Critically, the scores only
 * ever *raise* the risk level — see classify.ts. A model cannot argue content
 * past a triggered rule, and a scoring failure degrades to Yellow rather than
 * Green.
 */

import { extractJson, getProvider } from '../llm/index.ts';
import type { LlmProvider } from '../llm/provider.ts';
import type { Product, RiskScores } from '../lib/types.ts';

export const SCORE_THRESHOLD = 85;

const RUBRIC_SYSTEM = `You are the compliance scorer for a two-brand organic marketing system. You score drafts; you never rewrite them and never publish.

Return three integer scores from 0 to 100.

BRAND (0-100) — how well the draft fits the brand's voice, promise, and audience.
  90-100  On-promise, on-voice, immediately recognisable as this brand.
  85-89   On-brand with a minor wobble in tone or emphasis.
  70-84   Generic. Could be any app in the category.
  40-69   Off-voice, or drifts toward a positioning the brand rejects.
  0-39    Contradicts a stated brand constraint.

PLATFORM_SAFETY (0-100) — likelihood of surviving platform policy review untouched.
  90-100  Nothing a reviewer would question.
  85-89   Safe, with one phrase a strict reviewer might flag.
  70-84   Plausible reach penalty (engagement bait, borderline claim).
  40-69   Likely to be limited or removed.
  0-39    Clear policy violation.

STRATEGIC_QUALITY (0-100) — is this worth publishing at all?
  90-100  Specific, useful, differentiated. Earns the audience's attention.
  85-89   Useful and clear, if not novel.
  70-84   True but forgettable. Adds nothing the audience does not know.
  40-69   Filler.
  0-39    Noise, or actively confusing without context.

Score STRATEGIC_QUALITY below 85 when a draft could be misunderstood without
context the reader will not have. That case is an approval trigger in the
governing spec and there is no reliable pattern for it, so it is your job.

Be strict. A draft that is merely inoffensive is not an 85. Withholding a high
score costs a human two minutes of review; awarding one wrongly publishes
unreviewed content to a real audience.

Respond with exactly this JSON shape and nothing else:
{"brand": <int>, "platform_safety": <int>, "strategic_quality": <int>, "rationale": "<one sentence>"}`;

export interface ScoreResult {
  scores: RiskScores | null;
  rationale: string;
  /** True when scoring failed and the caller must fail closed. */
  failed: boolean;
}

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export async function scoreContent(
  input: { product: Product; campaign: string; hook: string; body: string; caption: string; cta: string },
  brandContext: string,
  provider: LlmProvider = getProvider(),
): Promise<ScoreResult> {
  // Brand context sits with the system prompt because it is stable across every
  // call for a given product — it becomes the cacheable prefix once the API
  // backend is wired up.
  const system = `${RUBRIC_SYSTEM}\n\n--- BRAND CONTEXT: ${input.product} ---\n${brandContext}`;

  const prompt = [
    `Product: ${input.product}`,
    `Campaign: ${input.campaign}`,
    `Hook: ${input.hook}`,
    `Body: ${input.body}`,
    `Caption: ${input.caption}`,
    `CTA: ${input.cta}`,
  ].join('\n');

  try {
    const response = await provider.complete({
      system,
      prompt,
      json: true,
      // Latency-tolerant: classification runs on a schedule, so an API backend
      // should batch this for the 50% discount.
      batch: true,
      model: process.env.LLM_MODEL_CLASSIFICATION,
      maxTokens: 512,
    });

    const parsed = extractJson<Partial<RiskScores> & { rationale?: string }>(response.text);

    if (
      !parsed ||
      !isValidScore(parsed.brand) ||
      !isValidScore(parsed.platform_safety) ||
      !isValidScore(parsed.strategic_quality)
    ) {
      return {
        scores: null,
        rationale: 'Scorer returned an unparseable or out-of-range response; holding for review.',
        failed: true,
      };
    }

    return {
      scores: {
        brand: Math.round(parsed.brand),
        platform_safety: Math.round(parsed.platform_safety),
        strategic_quality: Math.round(parsed.strategic_quality),
      },
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      failed: false,
    };
  } catch (error) {
    return {
      scores: null,
      rationale: `Scorer unavailable (${error instanceof Error ? error.message : String(error)}); holding for review.`,
      failed: true,
    };
  }
}

/** Every score must clear the threshold. One low score is enough to hold. */
export function scoresPass(scores: RiskScores | null): boolean {
  if (!scores) return false;
  return (
    scores.brand >= SCORE_THRESHOLD &&
    scores.platform_safety >= SCORE_THRESHOLD &&
    scores.strategic_quality >= SCORE_THRESHOLD
  );
}
