/**
 * Local JSON store for content items.
 *
 * JSON on disk rather than SQLite: the spec permits either and prefers
 * local-first, and git-diffable state directly serves the auditability
 * requirement — every state change shows up in `git diff` as a readable
 * change rather than an opaque binary delta.
 *
 * Writes are atomic (temp file + rename) so an interrupted write cannot leave
 * a truncated item on disk.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './paths.ts';
import { STATE_DIRECTORIES } from '../state/machine.ts';
import type { ContentItem, ContentState } from './types.ts';

function itemPath(state: ContentState, id: string): string {
  return join(REPO_ROOT, STATE_DIRECTORIES[state], `${id}.json`);
}

export function writeItem(item: ContentItem): void {
  const target = itemPath(item.status, item.id);
  mkdirSync(join(REPO_ROOT, STATE_DIRECTORIES[item.status]), { recursive: true });

  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(item, null, 2)}\n`, 'utf8');
  renameSync(tmp, target);
}

/**
 * Persist an item after a state transition, removing it from its previous
 * directory. Pass the state the item occupied before the transition.
 */
export function moveItem(item: ContentItem, previousState: ContentState): void {
  writeItem(item);

  const oldDir = STATE_DIRECTORIES[previousState];
  const newDir = STATE_DIRECTORIES[item.status];
  if (oldDir === newDir) return;

  const stale = itemPath(previousState, item.id);
  if (existsSync(stale)) unlinkSync(stale);
}

export function readItem(id: string): ContentItem | null {
  for (const dir of new Set(Object.values(STATE_DIRECTORIES))) {
    const candidate = join(REPO_ROOT, dir, `${id}.json`);
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf8')) as ContentItem;
    }
  }
  return null;
}

/** All items currently sitting in the directory for `state`. */
export function listItemsInState(state: ContentState): ContentItem[] {
  const dir = join(REPO_ROOT, STATE_DIRECTORIES[state]);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ContentItem)
    .filter((item) => item.status === state)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Every item across every state directory. */
export function listAllItems(): ContentItem[] {
  const seen = new Map<string, ContentItem>();
  for (const dir of new Set(Object.values(STATE_DIRECTORIES))) {
    const full = join(REPO_ROOT, dir);
    if (!existsSync(full)) continue;
    for (const file of readdirSync(full)) {
      if (!file.endsWith('.json') || file.endsWith('.tmp')) continue;
      const item = JSON.parse(readFileSync(join(full, file), 'utf8')) as ContentItem;
      seen.set(item.id, item);
    }
  }
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Content ID format from the spec: TL-IG-2026-07-28-001.
 * Sequence restarts per product/platform/day.
 */
export function nextContentId(productCode: string, platformCode: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const prefix = `${productCode}-${platformCode}-${day}-`;
  const used = listAllItems()
    .filter((i) => i.id.startsWith(prefix))
    .map((i) => Number.parseInt(i.id.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n));

  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}
