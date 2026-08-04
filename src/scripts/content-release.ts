#!/usr/bin/env node
/**
 * Release one content item from verification hold back to `edited`.
 *
 *   npm run content:release -- --only <id> --reason "…"
 *
 * Thin entry point over the shared implementation in content-hold.ts; the two
 * commands differ only in direction, so they share argument parsing, selection,
 * and reporting rather than drifting apart.
 */

import { realpathSync } from 'node:fs';
import { run } from './content-hold.ts';

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
  process.exitCode = run(process.argv.slice(2), 'release');
}
