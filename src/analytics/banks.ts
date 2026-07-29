/**
 * Audience-bank folding — completes the audience-mining role.
 *
 * Daily research captures audience language and objections into
 * analytics/raw/*-research.json. This module folds them into the memory banks
 * under the second-independent-appearance rule: a phrase or objection enters
 * the bank only once it has appeared in research on TWO different days. One
 * appearance is an observation; two is a pattern worth writing down.
 *
 * Folding is idempotent — it recomputes candidates from whatever raw research
 * files exist and upserts. Entries already promoted are never removed when old
 * raw files get cleaned up; the bank is the durable record, raw is the feed.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { normalize } from '../risk/evaluate.ts';
import type { ResearchFile } from '../content/context.ts';

interface Candidate {
  text: string;
  product: string;
  dates: Set<string>;
}

export interface BankEntry {
  text: string;
  product: string;
  first_seen: string;
  last_seen: string;
  appearances: number;
}

interface Extraction {
  language: Map<string, Candidate>;
  objections: Map<string, Candidate>;
}

const RESEARCH_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})-research\.json$/;

function collectCandidates(): Extraction {
  const rawDir = join(paths.analytics, 'raw');
  const extraction: Extraction = { language: new Map(), objections: new Map() };
  if (!existsSync(rawDir)) return extraction;

  for (const file of readdirSync(rawDir)) {
    const match = RESEARCH_FILE_PATTERN.exec(file);
    if (!match) continue;
    const date = match[1] ?? '';

    let parsed: ResearchFile;
    try {
      parsed = JSON.parse(readFileSync(join(rawDir, file), 'utf8')) as ResearchFile;
    } catch {
      continue;
    }

    for (const topic of parsed.topics ?? []) {
      addAll(extraction.language, topic.audience_language, topic.product, date);
      addAll(extraction.objections, topic.objections, topic.product, date);
    }
  }
  return extraction;
}

function addAll(map: Map<string, Candidate>, items: string[] | undefined, product: string, date: string): void {
  for (const raw of items ?? []) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (text.length < 3 || text.length > 200) continue;

    const key = `${product}::${normalize(text)}`;
    const existing = map.get(key);
    if (existing) {
      existing.dates.add(date);
    } else {
      map.set(key, { text, product, dates: new Set([date]) });
    }
  }
}

interface FoldResult {
  promoted_language: number;
  promoted_objections: number;
  candidates_waiting: number;
}

/** Upsert promoted candidates into a bank file's entry array. */
function upsertBank(file: string, arrayKey: string, promoted: Candidate[]): number {
  const full = join(paths.memory, file);
  const bank = JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown> & Record<string, BankEntry[] | unknown>;
  const entries = (bank[arrayKey] as BankEntry[] | undefined) ?? [];
  const byKey = new Map(entries.map((e) => [`${e.product}::${normalize(e.text)}`, e]));

  let changed = 0;
  for (const candidate of promoted) {
    const dates = [...candidate.dates].sort();
    const key = `${candidate.product}::${normalize(candidate.text)}`;
    const existing = byKey.get(key);
    const first = dates[0] ?? '';
    const last = dates[dates.length - 1] ?? '';

    if (existing) {
      if (existing.last_seen !== last || existing.appearances !== candidate.dates.size) {
        existing.last_seen = last;
        existing.appearances = candidate.dates.size;
        changed += 1;
      }
    } else {
      byKey.set(key, {
        text: candidate.text,
        product: candidate.product,
        first_seen: first,
        last_seen: last,
        appearances: candidate.dates.size,
      });
      changed += 1;
    }
  }

  bank[arrayKey] = [...byKey.values()].sort((a, b) => a.text.localeCompare(b.text));
  writeFileSync(full, `${JSON.stringify(bank, null, 2)}\n`, 'utf8');
  return changed;
}

export function foldAudienceBanks(): FoldResult {
  const { language, objections } = collectCandidates();

  const promotedLanguage = [...language.values()].filter((c) => c.dates.size >= 2);
  const promotedObjections = [...objections.values()].filter((c) => c.dates.size >= 2);
  const waiting =
    [...language.values()].filter((c) => c.dates.size < 2).length +
    [...objections.values()].filter((c) => c.dates.size < 2).length;

  const changedLanguage = upsertBank('audience-language-bank.json', 'entries', promotedLanguage);
  const changedObjections = upsertBank('objection-bank.json', 'objections', promotedObjections);

  return {
    promoted_language: changedLanguage,
    promoted_objections: changedObjections,
    candidates_waiting: waiting,
  };
}
