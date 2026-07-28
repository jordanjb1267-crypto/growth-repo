/**
 * Duplicate detection.
 *
 * The spec makes "not duplicate spam" a Green criterion but specifies no
 * mechanism. This is that mechanism: normalized 5-gram shingles compared by
 * Jaccard similarity against everything already published.
 *
 * Chosen over an embedding approach because it is deterministic, needs no model
 * call, and produces a number a human can argue with.
 */

import { normalize } from './evaluate.ts';
import { listAllItems } from '../lib/store.ts';
import type { ContentItem, Platform, Product } from '../lib/types.ts';

const SHINGLE_SIZE = 5;

/** Above this, the item is held for founder review as a possible repeat. */
export const YELLOW_THRESHOLD = 0.6;
/** Above this, the item is treated as duplicate spam and blocked. */
export const RED_THRESHOLD = 0.85;

/**
 * Raised thresholds for template-rendered content.
 *
 * Template instances are similar by design — that is what a template is. The
 * standard thresholds would flag every legitimate re-use. What still counts as
 * spam here is publishing an instance whose slot values barely differ from one
 * already out, so the bar moves to near-identity rather than being removed.
 */
export const TEMPLATE_YELLOW_THRESHOLD = 0.9;
export const TEMPLATE_RED_THRESHOLD = 0.97;

export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = normalize(text).split(' ').filter(Boolean);
  const set = new Set<string>();

  if (words.length < size) {
    // Short text: compare whole-string rather than producing nothing, or two
    // different one-line hooks would both yield empty sets and score 0.
    if (words.length > 0) set.add(words.join(' '));
    return set;
  }

  for (let i = 0; i <= words.length - size; i += 1) {
    set.add(words.slice(i, i + size).join(' '));
  }
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  // Iterate the smaller set for the lookups.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicateResult {
  similarity: number;
  /** Content ID of the closest match, or null if the corpus is empty. */
  closest_id: string | null;
}

/**
 * Compare against previously published items for the same product AND platform.
 *
 * Two scoping decisions, both deliberate:
 *
 * - Per-product, because the two brands address entirely different audiences;
 *   cross-brand similarity is not the spam signal the spec cares about.
 * - Per-platform, because the spec's Red rule is "duplicate across
 *   communities", and posting one short-form video to YouTube, TikTok, and
 *   Instagram is ordinary cross-posting that the spec's own channel list
 *   assumes. Penalising that would block the intended workflow. Repetition
 *   *within* a single platform is the behaviour that reads as spam.
 *
 * The item's own ID is excluded so that re-classification after a founder edit
 * does not match the item against itself.
 */
export function findClosestPublished(
  text: string,
  product: Product,
  platform: Platform,
  corpus: ContentItem[] = listAllItems(),
  excludeId?: string,
): DuplicateResult {
  const candidate = shingles(text);
  let best: DuplicateResult = { similarity: 0, closest_id: null };

  for (const item of corpus) {
    if (item.product !== product) continue;
    if (item.platform !== platform) continue;
    if (excludeId && item.id === excludeId) continue;
    if (item.published_at === null) continue;

    const score = jaccard(candidate, shingles(`${item.hook} ${item.full_content} ${item.caption}`));
    if (score > best.similarity) {
      best = { similarity: score, closest_id: item.id };
    }
  }

  return best;
}
