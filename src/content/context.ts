/**
 * Shared loaders for the stable context that feeds every model call: brand
 * rules, campaign briefs, memory banks, and the day's research.
 *
 * Everything here is deliberately deterministic about ordering (sorted file
 * reads, fixed concatenation order) so the rendered context is byte-stable —
 * that is what makes it a cacheable prefix once the API backend is wired up.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { PRODUCT_SLUGS } from '../lib/types.ts';
import type { Product } from '../lib/types.ts';

export function loadBrandContext(product: Product): string {
  const shared = join(paths.brands, 'shared-rules.md');
  const own = join(paths.brands, `${PRODUCT_SLUGS[product]}.md`);
  const parts: string[] = [];
  if (existsSync(shared)) parts.push(readFileSync(shared, 'utf8'));
  if (existsSync(own)) parts.push(readFileSync(own, 'utf8'));
  return parts.join('\n\n');
}

export interface CampaignBrief {
  /** Campaign display name, taken from the file's H1. */
  name: string;
  file: string;
  body: string;
}

export function loadCampaignBriefs(product: Product): CampaignBrief[] {
  const dir = join(paths.campaigns, PRODUCT_SLUGS[product]);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const body = readFileSync(join(dir, file), 'utf8');
      const h1 = /^#\s+(.+)$/m.exec(body);
      return { name: h1?.[1]?.trim() ?? file.replace(/\.md$/, ''), file, body };
    });
}

/** The default campaign per product, from the brand promise in the spec. */
export const DEFAULT_CAMPAIGN: Record<Product, string> = {
  'Rig Receipts': 'Gross Rate Is Not Profit',
  'Tilawah Lock': 'Read Before You Scroll',
};

function readJsonIfPresent(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A compact extract of the memory banks for prompt context. Full banks can grow
 * without bound; the prompt gets the most recent slice of each.
 */
export function loadMemoryExtract(limit = 20): string {
  const hookBank = readJsonIfPresent(join(paths.memory, 'hook-bank.json')) as {
    hooks?: unknown[];
  } | null;
  const objectionBank = readJsonIfPresent(join(paths.memory, 'objection-bank.json')) as {
    objections?: unknown[];
  } | null;
  const languageBank = readJsonIfPresent(join(paths.memory, 'audience-language-bank.json')) as {
    entries?: unknown[];
  } | null;

  const sections: string[] = [];
  const hooks = hookBank?.hooks?.slice(-limit) ?? [];
  const objections = objectionBank?.objections?.slice(-limit) ?? [];
  const language = languageBank?.entries?.slice(-limit) ?? [];

  if (hooks.length > 0) sections.push(`Recent hooks and their standing:\n${JSON.stringify(hooks, null, 2)}`);
  if (objections.length > 0) sections.push(`Known audience objections:\n${JSON.stringify(objections, null, 2)}`);
  if (language.length > 0) sections.push(`Audience language bank:\n${JSON.stringify(language, null, 2)}`);

  return sections.length > 0 ? sections.join('\n\n') : 'Memory banks are empty — this is early in the system\'s life.';
}

export interface ResearchTopic {
  product: Product;
  topic: string;
  audience_language: string[];
  objections: string[];
  content_angle: string;
  /** Either a list of citable sources, or the literal string "model-prior" when
   *  the topic came from the model's own knowledge and needs verification
   *  before any statistic derived from it can be published. */
  sources: string[] | 'model-prior';
}

export interface ResearchFile {
  $schema_version: 1;
  generated_at: string;
  topics: ResearchTopic[];
}

export function researchPathFor(date = new Date()): string {
  return join(paths.analytics, 'raw', `${date.toISOString().slice(0, 10)}-research.json`);
}

export function loadTodaysResearch(date = new Date()): ResearchFile | null {
  const parsed = readJsonIfPresent(researchPathFor(date)) as ResearchFile | null;
  return parsed && Array.isArray(parsed.topics) ? parsed : null;
}
