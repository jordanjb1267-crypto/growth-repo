/**
 * Founder-approved template library.
 *
 * This is the sanctioned route to autonomy for Tilawah Lock (CLAUDE.md
 * addendum A2). The problem it solves: the Yellow rules gate any mention of
 * Salah, Quran, or worship, but Tilawah Lock's core promise is "Pray. Read.
 * Then Unlock." — so essentially all on-brand content is approval-gated,
 * which cannot coexist with the 60-70% autonomy target.
 *
 * The resolution is not to loosen the rule. It is to let the founder approve a
 * piece of religious framing ONCE, deliberately, and then allow mechanical
 * re-use of exactly that framing. Three conditions must all hold, and all three
 * are checkable by code rather than judgement:
 *
 *   1. The rendered instance differs from the template only inside explicitly
 *      declared slots. Guaranteed by construction — we do the substitution.
 *   2. Every slot value independently passes the full Red and Yellow rule pass.
 *      This is what stops a new religious claim entering through a slot.
 *   3. The template's content hash still matches the approved record. Editing
 *      a template's frozen text voids its approval.
 *
 * Any failure falls back to normal founder approval. Nothing is ever published
 * on a template exemption that did not satisfy all three.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { evaluateRules } from '../risk/evaluate.ts';
import { PRODUCT_SLUGS } from '../lib/types.ts';
import type { Product, RuleHit, TemplateExemption } from '../lib/types.ts';

export interface TemplateSlot {
  name: string;
  /** Shown to whoever fills the slot. Also a hint to the generator. */
  description: string;
  max_length: number;
}

export interface Template {
  $schema_version: 1;
  id: string;
  product: Product;
  campaign: string;
  approved_by: string;
  approved_at: string;
  /** sha256 over the frozen text plus slot definitions. Recomputed on load;
   *  a mismatch voids the approval. */
  content_hash: string;

  hook: string;
  body: string;
  caption: string;
  cta: string;
  slots: TemplateSlot[];
}

const SLOT_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Canonical serialization for hashing. Field order is fixed here rather than
 * taken from the object so that reformatting the JSON file does not void an
 * approval, while any change to the actual text does.
 */
function canonicalize(template: Template): string {
  return JSON.stringify({
    id: template.id,
    product: template.product,
    campaign: template.campaign,
    hook: template.hook,
    body: template.body,
    caption: template.caption,
    cta: template.cta,
    slots: [...template.slots]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ name: s.name, max_length: s.max_length })),
  });
}

export function computeTemplateHash(template: Template): string {
  return createHash('sha256').update(canonicalize(template), 'utf8').digest('hex');
}

export function loadTemplate(product: Product, templateId: string): Template | null {
  const file = join(paths.templates, PRODUCT_SLUGS[product], `${templateId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Template;
}

export function listTemplates(product: Product): Template[] {
  const dir = join(paths.templates, PRODUCT_SLUGS[product]);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Template);
}

/**
 * Re-derive a template exemption for an existing item.
 *
 * The exemption is never trusted from a stored record. At classification time
 * the template is re-loaded, re-rendered with the item's stored slot values,
 * and the output compared field-by-field against the item's actual text. All
 * three integrity conditions are therefore re-checked on every classification:
 * a template edited since approval, a slot value that now trips a rule (rules
 * evolve), or item text that drifted from the render (e.g. a founder edit) all
 * void the exemption and drop the item back to normal approval.
 */
export function deriveExemption(item: {
  product: Product;
  template_id: string | null;
  template_slots: Record<string, string> | null;
  hook: string;
  full_content: string;
  caption: string;
  cta: string;
}): TemplateExemption | null {
  if (!item.template_id || !item.template_slots) return null;

  const template = loadTemplate(item.product, item.template_id);
  if (!template) return null;

  const rendered = renderTemplate(template, item.template_slots);
  if (!rendered.ok) return null;

  const matches =
    rendered.hook === item.hook &&
    rendered.body === item.full_content &&
    rendered.caption === item.caption &&
    rendered.cta === item.cta;

  return matches ? rendered.exemption : null;
}

export type RenderResult =
  | { ok: true; hook: string; body: string; caption: string; cta: string; exemption: TemplateExemption }
  | { ok: false; failures: string[]; slot_hits: RuleHit[] };

/**
 * Render a template with the given slot values, enforcing all three integrity
 * conditions. Returns a discriminated result rather than throwing so callers
 * can degrade to normal approval instead of crashing the pipeline.
 */
export function renderTemplate(template: Template, values: Record<string, string>): RenderResult {
  const failures: string[] = [];
  const slotHits: RuleHit[] = [];

  // Condition 3 — approval is bound to the exact frozen text.
  const actualHash = computeTemplateHash(template);
  if (actualHash !== template.content_hash) {
    failures.push(
      `Template ${template.id} has been edited since approval (hash ${actualHash.slice(0, 12)} != approved ${template.content_hash.slice(0, 12)}). Re-approval required.`,
    );
  }

  if (!template.approved_by || !template.approved_at) {
    failures.push(`Template ${template.id} carries no founder approval record.`);
  }

  const declared = new Set(template.slots.map((s) => s.name));
  const fullText = `${template.hook}\n${template.body}\n${template.caption}\n${template.cta}`;

  // Every placeholder appearing in the text must be declared, or an
  // undeclared substitution point would escape slot-level rule checking.
  for (const match of fullText.matchAll(SLOT_PATTERN)) {
    const name = match[1];
    if (name && !declared.has(name)) {
      failures.push(`Template ${template.id} uses undeclared slot "{{${name}}}".`);
    }
  }

  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      failures.push(`Slot value supplied for undeclared slot "${key}".`);
    }
  }

  for (const slot of template.slots) {
    const value = values[slot.name];

    if (value === undefined) {
      failures.push(`Missing value for slot "${slot.name}".`);
      continue;
    }
    if (value.length > slot.max_length) {
      failures.push(`Slot "${slot.name}" is ${value.length} chars, over its ${slot.max_length} limit.`);
    }
    // A slot value containing template syntax could introduce a substitution
    // point the integrity check never saw.
    if (/\{\{|\}\}/.test(value)) {
      failures.push(`Slot "${slot.name}" contains template syntax.`);
    }
    if (/[\r\n]/.test(value)) {
      failures.push(`Slot "${slot.name}" contains a line break, which could restructure the rendered content.`);
    }

    // Condition 2 — the check that actually carries the safety argument.
    const hits = evaluateRules(value, template.product);
    if (hits.length > 0) {
      slotHits.push(...hits);
      failures.push(
        `Slot "${slot.name}" triggered ${hits.length} rule(s): ${hits.map((h) => h.id).join(', ')}.`,
      );
    }
  }

  if (failures.length > 0) return { ok: false, failures, slot_hits: slotHits };

  const substitute = (text: string): string =>
    text.replace(SLOT_PATTERN, (_whole, name: string) => values[name] ?? '');

  return {
    ok: true,
    hook: substitute(template.hook),
    body: substitute(template.body),
    caption: substitute(template.caption),
    cta: substitute(template.cta),
    exemption: {
      template_id: template.id,
      template_hash: actualHash,
      approved_by: template.approved_by,
      approved_at: template.approved_at,
    },
  };
}
