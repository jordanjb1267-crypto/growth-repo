#!/usr/bin/env node
/**
 * Place one content item on verification hold, or release one from it.
 *
 *   npm run content:hold -- --only <id> --reason "…"
 *   npm run content:release -- --only <id> --reason "…"
 *
 * Both require an explicit id and a non-empty reason. There is no "all" form
 * and no fallback: a command that could hold or release the whole queue by
 * omission is a command that eventually will.
 */

import { realpathSync } from 'node:fs';
import { holdItem, HoldError, releaseItem } from '../approval/hold.ts';
import { readItem } from '../lib/store.ts';

export type HoldMode = 'hold' | 'release';

export interface HoldArgs {
  only: string;
  reason: string;
}

export type ParseResult = { ok: true; args: HoldArgs } | { ok: false; error: string };

export function usage(mode: HoldMode): string {
  const command = mode === 'hold' ? 'content:hold' : 'content:release';
  return [
    `Usage: npm run ${command} -- --only <content-id> --reason "<reason>"`,
    '',
    'Both flags are required. The "--" after the script name is required — without',
    'it npm consumes the flags before this script sees them.',
  ].join('\n');
}

export function parseHoldArgs(argv: readonly string[], mode: HoldMode): ParseResult {
  let only: string | null = null;
  let reason: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (flag: string): string | null => {
      if (arg === flag) {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) return null;
        i += 1;
        return value;
      }
      return arg?.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : null;
    };

    if (arg === '--only' || arg?.startsWith('--only=')) {
      const value = take('--only');
      if (value === null) return { ok: false, error: `--only requires a content id.\n\n${usage(mode)}` };
      only = value;
    } else if (arg === '--reason' || arg?.startsWith('--reason=')) {
      const value = take('--reason');
      if (value === null) return { ok: false, error: `--reason requires text.\n\n${usage(mode)}` };
      reason = value;
    } else {
      return { ok: false, error: `Unknown argument: ${arg}\n\n${usage(mode)}` };
    }
  }

  if (!only) return { ok: false, error: `--only is required.\n\n${usage(mode)}` };
  if (reason === null || reason.trim().length === 0) {
    return { ok: false, error: `--reason is required and must not be empty.\n\n${usage(mode)}` };
  }

  return { ok: true, args: { only, reason } };
}

export function run(argv: readonly string[], mode: HoldMode): number {
  const parsed = parseHoldArgs(argv, mode);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }
  const { only, reason } = parsed.args;

  // Named before anything mutates, so the log shows what was selected and
  // where it started even if the transition then fails.
  const before = readItem(only);
  if (before) {
    console.log(`${mode === 'hold' ? 'Holding' : 'Releasing'} ${before.id} — currently "${before.status}" (${before.product} · ${before.platform}).`);
  }

  try {
    const item = mode === 'hold' ? holdItem(only, reason) : releaseItem(only, reason);
    console.log(`  ${item.id}  → ${item.status}`);
    console.log(`  reason: ${reason}`);
    if (mode === 'hold') {
      console.log('  Excluded from classification, scheduling, and publishing until explicitly released.');
    } else {
      console.log('  Must pass brand check and classification again before it can publish.');
    }
    return 0;
  } catch (error) {
    console.error(error instanceof HoldError ? error.message : `Failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(import.meta.filename);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const mode: HoldMode = process.argv[1]?.includes('content-release') ? 'release' : 'hold';
  process.exitCode = run(process.argv.slice(2), mode);
}
