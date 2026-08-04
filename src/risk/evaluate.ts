/**
 * The deterministic rule pass.
 *
 * This layer is intentionally dumb: regex over normalized text, no model in the
 * loop. Its output is the floor of the risk decision — `classify()` may raise
 * the level based on model scores, but it may never lower it below what this
 * pass returns.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { mostSevere } from '../lib/types.ts';
import { isRuleFile, type Rule } from './rules/schema.ts';
import type { Product, RiskLevel, RuleHit } from '../lib/types.ts';

let cachedRules: Rule[] | null = null;

/** Loads every rule file in src/risk/rules/. Cached for the process lifetime. */
export function loadRules(): Rule[] {
  if (cachedRules) return cachedRules;

  const files = readdirSync(paths.rules).filter((f) => f.endsWith('.json'));
  const rules: Rule[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const parsed: unknown = JSON.parse(readFileSync(join(paths.rules, file), 'utf8'));
    if (!isRuleFile(parsed)) {
      throw new Error(`Rule file ${file} is not a valid rule file (missing $schema_version: 1 or rules[])`);
    }
    for (const rule of parsed.rules) {
      if (seenIds.has(rule.id)) {
        // Duplicate IDs would make a classification record ambiguous about
        // which rule actually fired.
        throw new Error(`Duplicate rule ID "${rule.id}" found in ${file}`);
      }
      seenIds.add(rule.id);
      rules.push(rule);
    }
  }

  cachedRules = rules;
  return rules;
}

/** Test seam — forces the next loadRules() call to re-read from disk. */
export function clearRuleCache(): void {
  cachedRules = null;
}

/**
 * Normalize before matching so trivial obfuscation and formatting noise do not
 * slip past a rule: collapse whitespace, fold common Unicode lookalikes to
 * ASCII, and lowercase.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function firstMatch(text: string, patterns: string[]): { evidence: string } | null {
  for (const pattern of patterns) {
    const match = new RegExp(pattern, 'i').exec(text);
    if (match) return { evidence: excerpt(text, match.index, match[0].length) };
  }
  return null;
}

function allMatch(text: string, patterns: string[]): { evidence: string } | null {
  const evidences: string[] = [];
  for (const pattern of patterns) {
    const match = new RegExp(pattern, 'i').exec(text);
    if (!match) return null;
    evidences.push(excerpt(text, match.index, match[0].length));
  }
  return { evidence: evidences.join(' + ') };
}

function ruleApplies(rule: Rule, product: Product): boolean {
  return rule.applies_to.includes('*') || rule.applies_to.includes(product);
}

/**
 * Run every applicable rule against the text.
 *
 * Returns ALL hits, not just the most severe one — a Yellow hit alongside a Red
 * one still belongs in the record, because the founder reviewing a block needs
 * to see everything that fired.
 */
export function evaluateRules(text: string, product: Product, rules = loadRules()): RuleHit[] {
  const normalized = normalize(text);
  const hits: RuleHit[] = [];

  for (const rule of rules) {
    if (!ruleApplies(rule, product)) continue;

    // A suppression match wins outright — this is what lets a properly
    // labelled fictional example or a sourced statistic through.
    if (rule.none_of && firstMatch(normalized, rule.none_of)) continue;

    const hit = rule.all_of
      ? allMatch(normalized, rule.all_of)
      : rule.patterns
        ? firstMatch(normalized, rule.patterns)
        : null;

    if (!hit) continue;

    hits.push({
      id: rule.id,
      level: rule.level,
      category: rule.category,
      reason: rule.reason,
      evidence: hit.evidence,
    });
  }

  return hits;
}

/** The most severe level among a set of rule hits. */
export function levelFromHits(hits: RuleHit[]): RiskLevel {
  return mostSevere(...hits.map((h) => h.level));
}
