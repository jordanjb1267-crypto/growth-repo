/**
 * Content generation core.
 *
 * One provider call per product returns the whole daily set, which is both the
 * cheap shape (one cacheable prefix, one call) and the shape that lets the
 * model vary hooks and CTAs across items rather than repeating itself.
 *
 * Two paths produce items:
 *
 *   FREEFORM — the model writes the item. It enters `drafted` with no
 *   exemption and takes its chances with the classifier like anything else.
 *
 *   TEMPLATE — the model supplies only slot values for a founder-approved
 *   template; the frozen text is substituted mechanically. Slot values that
 *   trip any rule cause the instance to be SKIPPED, not published and not
 *   queued — embedding a bad slot value in a draft would still put bad text
 *   in front of the founder as if it were ours.
 *
 * This module never sets a risk level and never routes an item. Classification
 * does both.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractJson } from '../llm/provider.ts';
import { getProvider } from '../llm/index.ts';
import {
  DEFAULT_CAMPAIGN,
  loadBrandContext,
  loadCampaignBriefs,
  loadLatestPlan,
  loadMemoryExtract,
  loadTodaysResearch,
} from './context.ts';
import { listTemplates, renderTemplate } from '../templates/template.ts';
import { nextContentId, writeItem } from '../lib/store.ts';
import { paths } from '../lib/paths.ts';
import { dayId } from '../lib/dates.ts';
import type { LlmProvider } from '../llm/provider.ts';
import type { ContentItem, Platform, Product } from '../lib/types.ts';

/** Platform code used in content IDs. */
const PLATFORM_CODES: Record<Platform, string> = {
  'YouTube Shorts': 'YT',
  TikTok: 'TT',
  'Instagram Reels': 'IG',
  'Facebook Page': 'FB',
  LinkedIn: 'LI',
  Blog: 'BLOG',
  Email: 'EM',
  X: 'X',
  Reddit: 'RD',
  'Facebook Groups': 'FBG',
};

const PRODUCT_CODES: Record<Product, string> = {
  'Rig Receipts': 'RR',
  'Tilawah Lock': 'TL',
};

type ItemKind = 'video_concept' | 'secondary_post' | 'community_reply';

/**
 * Platform per kind is OURS to decide, not the model's — determinism beats
 * trust here. The community reply lands on Reddit deliberately: Reddit is a
 * draft-only channel with no publish path, so a reply can never leave the
 * queue by accident.
 */
function platformFor(kind: ItemKind, product: Product): Platform {
  switch (kind) {
    case 'video_concept':
      return 'Instagram Reels';
    case 'secondary_post':
      return product === 'Rig Receipts' ? 'LinkedIn' : 'Facebook Page';
    case 'community_reply':
      return 'Reddit';
  }
}

const LIMITS = { hook: 200, body: 4000, caption: 500, cta: 200 } as const;

const GENERATION_SYSTEM = `You are the content-production step of a two-brand organic marketing system. You draft; a separate classifier and a human founder decide what publishes. Because of that, do not write around the brand rules to seem safe — write the best on-brand content and let the gate do its job. But never violate a hard constraint: those are listed in the brand context below and violating one wastes the whole draft.

Craft rules:
- One idea per item. A post that makes three points makes none.
- Write in the audience's register (see the memory extract), not marketing register.
- Never invent a statistic, a customer, a route, or a load. Fictional examples must be labelled fictional.
- Vary the CTA across items — do not reuse one call to action verbatim.
- The community reply must read like a helpful peer answering a real question, never like an ad. It will be posted manually by the founder if at all.

Respond with exactly this JSON shape and nothing else:
{
  "items": [
    {"kind": "video_concept", "campaign": "<campaign name>", "hook": "...", "body": "<the full script/concept>", "caption": "...", "cta": "..."},
    {"kind": "secondary_post", "campaign": "<campaign name>", "hook": "...", "body": "...", "caption": "...", "cta": "..."},
    {"kind": "community_reply", "campaign": "<campaign name>", "hook": "<the question being answered>", "body": "<the reply>", "caption": "", "cta": ""}
  ],
  "template_slots": {"<template_id>": {"<slot_name>": "<value>"}},
  "aso_idea": "<one concrete ASO or landing-page improvement idea>"
}`;

interface RawItem {
  kind?: string;
  campaign?: string;
  hook?: string;
  body?: string;
  caption?: string;
  cta?: string;
}

interface GenerationResponse {
  items?: RawItem[];
  template_slots?: Record<string, Record<string, string>>;
  aso_idea?: string;
}

export interface GenerationResult {
  created: ContentItem[];
  skipped: { kind: string; reason: string }[];
  aso_idea: string | null;
  /** Set when an idea was produced but rejected as incomplete. Null when the
   *  idea was valid, and null when the model returned none at all. */
  aso_idea_error: string | null;
}

/**
 * Upper bound on a strategy idea.
 *
 * This used to be applied with a silent `slice(0, 600)`. Both of 2026-08-04's
 * ideas came back at exactly 600 characters — the cap had cut them mid-word
 * ("…one new caption ", "The same two-column b") and the run still reported
 * success. Slicing prose at a byte count and filing the remainder as a
 * finished thought is the bug; the limit now rejects rather than truncates.
 */
export const ASO_IDEA_MAX = 1200;

/** Below this an "idea" cannot carry an actionable suggestion. */
export const ASO_IDEA_MIN = 80;

export type IdeaValidation =
  | { ok: true; idea: string }
  | { ok: false; reason: string };

/**
 * Fail-closed completeness check for a generated strategy idea.
 *
 * Never repairs. A truncated idea is reported and dropped, because the only
 * way to "fix" one is to write the ending the model never produced — which
 * would put invented product decisions into the founder's planning notes.
 */
export function validateAsoIdea(raw: string | undefined, max = ASO_IDEA_MAX): IdeaValidation {
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return { ok: false, reason: 'absent' };
  }

  // Checked before trimming: trailing whitespace where a terminator belongs is
  // itself the signature of a cut, not a formatting quirk.
  if (raw !== raw.trimEnd()) {
    return { ok: false, reason: `idea ends in trailing whitespace, not a sentence terminator: …${JSON.stringify(raw.slice(-28))}` };
  }

  const idea = raw.trim();

  if (idea.length < ASO_IDEA_MIN) {
    return { ok: false, reason: `idea is ${idea.length} chars, under the ${ASO_IDEA_MIN}-char minimum to be actionable` };
  }
  if (idea.length > max) {
    return { ok: false, reason: `idea is ${idea.length} chars, over the ${max}-char ceiling — treated as incomplete rather than truncated` };
  }

  // A finished idea ends on a sentence terminator, optionally closed by a
  // quote or bracket. "…two-column b" and "…one new caption" both fail here.
  if (!/[.!?][)"'’”\]]?$/.test(idea)) {
    return { ok: false, reason: `idea ends mid-sentence with no terminator: …${JSON.stringify(idea.slice(-28))}` };
  }

  return { ok: true, idea };
}

function clip(value: string | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

function buildItem(input: {
  product: Product;
  platform: Platform;
  campaign: string;
  hook: string;
  body: string;
  caption: string;
  cta: string;
  templateId?: string;
  templateSlots?: Record<string, string>;
}): ContentItem {
  const now = new Date().toISOString();
  const id = nextContentId(PRODUCT_CODES[input.product], PLATFORM_CODES[input.platform]);

  return {
    id,
    product: input.product,
    platform: input.platform,
    campaign: input.campaign,
    hook: input.hook,
    full_content: input.body,
    caption: input.caption,
    cta: input.cta,
    asset_path: null,
    risk_level: 'green', // provisional; classification overwrites this
    approval_reason: '',
    recommended_action: 'run npm run risk:classify',
    status: 'drafted',
    created_at: now,
    updated_at: now,
    classification: null,
    template_id: input.templateId ?? null,
    template_slots: input.templateSlots ?? null,
    approval: null,
    platform_post_id: null,
    published_at: null,
    founder_note: null,
  };
}

export async function generateForProduct(
  product: Product,
  provider: LlmProvider = getProvider(),
): Promise<GenerationResult> {
  const briefs = loadCampaignBriefs(product);
  const campaignNames = new Set(briefs.map((b) => b.name));
  const templates = listTemplates(product);
  const research = loadTodaysResearch();
  const productTopics = research?.topics.filter((t) => t.product === product) ?? [];

  const system = [
    GENERATION_SYSTEM,
    '',
    `--- BRAND CONTEXT: ${product} ---`,
    loadBrandContext(product),
    '',
    '--- CAMPAIGN BRIEFS ---',
    ...briefs.map((b) => b.body),
  ].join('\n');

  const templateSection =
    templates.length > 0
      ? [
          'Approved templates — provide slot values for AT MOST ONE of these in "template_slots". Slot values are checked against every brand rule in isolation; a value that would itself trip a rule wastes the instance:',
          ...templates.map(
            (t) =>
              `- ${t.id} (campaign: ${t.campaign}): slots ${t.slots
                .map((s) => `${s.name} [max ${s.max_length} chars: ${s.description}]`)
                .join('; ')}`,
          ),
        ].join('\n')
      : 'No approved templates exist for this product; omit "template_slots".';

  // The weekly plan steers emphasis: lead campaign first, killed campaigns
  // excluded. This is the loop closing — learning output shaping creation.
  const plan = loadLatestPlan()?.products[product] ?? null;
  const planSection = plan
    ? `This week's plan (from weekly:plan): lead with the campaign "${plan.lead ?? DEFAULT_CAMPAIGN[product]}". Active campaigns this week: ${plan.active.join(' · ') || DEFAULT_CAMPAIGN[product]}. Draft the video concept for the lead campaign; other items may use any active campaign. Do not draft for campaigns not listed as active.`
    : 'No weekly plan exists yet — draw angles from any campaign brief.';

  const prompt = [
    `Product: ${product}`,
    `Date: ${dayId()}`,
    '',
    planSection,
    '',
    'Memory extract:',
    loadMemoryExtract(),
    '',
    productTopics.length > 0
      ? `Today's research:\n${JSON.stringify(productTopics, null, 2)}`
      : 'No research available today — draw angles from the campaign briefs.',
    '',
    templateSection,
    '',
    'Produce the daily set now.',
  ].join('\n');

  const response = await provider.complete({
    system,
    prompt,
    json: true,
    batch: true,
    maxTokens: 4096,
  });

  const parsed = extractJson<GenerationResponse>(response.text);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Generation for ${product} returned unparseable output; nothing was created.`);
  }

  const created: ContentItem[] = [];
  const skipped: { kind: string; reason: string }[] = [];
  const seenKinds = new Set<string>();

  for (const raw of parsed.items) {
    const kind = raw.kind as ItemKind;
    if (!['video_concept', 'secondary_post', 'community_reply'].includes(kind)) {
      skipped.push({ kind: String(raw.kind), reason: 'unknown kind' });
      continue;
    }
    if (seenKinds.has(kind)) {
      skipped.push({ kind, reason: 'duplicate kind in response' });
      continue;
    }
    seenKinds.add(kind);

    const hook = clip(raw.hook, LIMITS.hook);
    const body = clip(raw.body, LIMITS.body);
    if (!hook || !body) {
      skipped.push({ kind, reason: 'missing hook or body' });
      continue;
    }

    // Campaign must be one we actually run; anything else falls back to the
    // product's default campaign rather than inventing a new bucket.
    const campaign = campaignNames.has(clip(raw.campaign, 120)) ? clip(raw.campaign, 120) : DEFAULT_CAMPAIGN[product];

    const item = buildItem({
      product,
      platform: platformFor(kind, product),
      campaign,
      hook,
      body,
      caption: clip(raw.caption, LIMITS.caption),
      cta: clip(raw.cta, LIMITS.cta),
    });
    writeItem(item);
    created.push(item);
  }

  // Template path — mechanical substitution, slot values rule-checked inside
  // renderTemplate(). At most one instance per day per product.
  const slotSets = Object.entries(parsed.template_slots ?? {}).slice(0, 1);
  for (const [templateId, slots] of slotSets) {
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      skipped.push({ kind: `template:${templateId}`, reason: 'unknown template id' });
      continue;
    }
    if (typeof slots !== 'object' || slots === null) {
      skipped.push({ kind: `template:${templateId}`, reason: 'malformed slot values' });
      continue;
    }

    const rendered = renderTemplate(template, slots);
    if (!rendered.ok) {
      skipped.push({ kind: `template:${templateId}`, reason: rendered.failures.join('; ') });
      continue;
    }

    const item = buildItem({
      product,
      platform: 'Instagram Reels',
      campaign: template.campaign,
      hook: rendered.hook,
      body: rendered.body,
      caption: rendered.caption,
      cta: rendered.cta,
      templateId: template.id,
      templateSlots: slots,
    });
    writeItem(item);
    created.push(item);
  }

  // ASO/landing ideas are notes for the founder, not publishable content — but
  // an incomplete one must not be filed as though it were a finished thought.
  const ideaCheck = validateAsoIdea(parsed.aso_idea);
  let asoIdea: string | null = null;
  let asoIdeaError: string | null = null;

  if (ideaCheck.ok) {
    asoIdea = ideaCheck.idea;
    const ideasFile = join(paths.analytics, 'daily', `${dayId()}-ideas.md`);
    mkdirSync(join(paths.analytics, 'daily'), { recursive: true });
    appendFileSync(ideasFile, `- **${product}:** ${asoIdea}\n`, 'utf8');
  } else if (ideaCheck.reason !== 'absent') {
    // Deliberately NOT written to analytics/daily, and deliberately not
    // repaired: completing someone else's truncated sentence means inventing
    // the product decision it was about to state.
    asoIdeaError = ideaCheck.reason;
    skipped.push({ kind: 'aso_idea', reason: ideaCheck.reason });
  }

  return { created, skipped, aso_idea: asoIdea, aso_idea_error: asoIdeaError };
}
