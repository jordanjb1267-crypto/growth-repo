#!/usr/bin/env node
/**
 * Daily research — gather content opportunities per product.
 *
 *   npm run daily:research
 *
 * Writes /analytics/raw/YYYY-MM-DD-research.json, which content:generate reads
 * the same day. Public-source observation only; no logins, no scraping, no
 * individual's private material.
 *
 * Honesty about sourcing: when the backend has no live web access, topics come
 * from the model's own knowledge and are marked "model-prior". Downstream, the
 * RED-UNVERIFIED-STATISTIC rule blocks any unsourced number regardless — so a
 * speculative topic can inspire an angle but cannot smuggle a statistic into
 * published content.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { extractJson, getProvider } from '../llm/index.ts';
import { loadBrandContext, loadCampaignBriefs, loadMemoryExtract, researchPathFor } from '../content/context.ts';
import { PRODUCTS } from '../lib/types.ts';
import type { ResearchFile, ResearchTopic } from '../content/context.ts';
import type { Product } from '../lib/types.ts';

const RESEARCH_SYSTEM = `You are the market-intelligence step of a two-brand organic marketing system. Your job is to surface what each audience is currently discussing, in their own register, so tomorrow's content responds to something real.

Rules:
- Observe, do not invent. If you have no live information, say so via "sources": "model-prior" and keep the topic qualitative.
- Never fabricate a statistic, a survey, or a trend figure. A number without a citable source will be blocked downstream.
- Capture audience phrasing verbatim-style ("deadhead ate the load"), not marketing register.
- Never include anything that identifies an individual.

Respond with exactly this JSON shape and nothing else:
{"topics": [{"product": "<product name>", "topic": "<what is being discussed>", "audience_language": ["<phrase>", ...], "objections": ["<objection>", ...], "content_angle": "<one concrete angle for our content>", "sources": ["<url or publication>", ...] | "model-prior"}]}`;

function validTopic(candidate: unknown): candidate is ResearchTopic {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const t = candidate as Partial<ResearchTopic>;
  return (
    typeof t.topic === 'string' &&
    typeof t.content_angle === 'string' &&
    (PRODUCTS as readonly string[]).includes(t.product as string) &&
    Array.isArray(t.audience_language) &&
    Array.isArray(t.objections) &&
    (t.sources === 'model-prior' || Array.isArray(t.sources))
  );
}

async function researchProduct(product: Product): Promise<ResearchTopic[]> {
  const provider = getProvider();
  const system = `${RESEARCH_SYSTEM}\n\n--- BRAND CONTEXT: ${product} ---\n${loadBrandContext(product)}`;
  const prompt = [
    `Product: ${product}`,
    '',
    'Active campaigns:',
    ...loadCampaignBriefs(product).map((c) => `- ${c.name}`),
    '',
    'Memory extract:',
    loadMemoryExtract(),
    '',
    'Produce 3 to 5 topics for this product. If web search is available to you, use it and cite sources; otherwise mark every topic "model-prior".',
  ].join('\n');

  const response = await provider.complete({ system, prompt, json: true, maxTokens: 2048 });
  const parsed = extractJson<{ topics?: unknown[] }>(response.text);
  const topics = (parsed?.topics ?? []).filter(validTopic).filter((t) => t.product === product);

  if (topics.length === 0) {
    console.error(`  ${product}: research returned no usable topics — generation will run on campaign briefs alone.`);
  }
  return topics;
}

async function main(): Promise<void> {
  const all: ResearchTopic[] = [];
  for (const product of PRODUCTS) {
    console.log(`Researching ${product}…`);
    all.push(...(await researchProduct(product)));
  }

  const file: ResearchFile = {
    $schema_version: 1,
    generated_at: new Date().toISOString(),
    topics: all,
  };

  const target = researchPathFor();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

  const speculative = all.filter((t) => t.sources === 'model-prior').length;
  console.log('');
  console.log(`Wrote ${all.length} topic(s) to ${target}`);
  if (speculative > 0) {
    console.log(`${speculative} topic(s) are model-prior (no live sources) — usable for angles, not for facts.`);
  }
}

await main();
