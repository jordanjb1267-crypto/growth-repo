#!/usr/bin/env node
/**
 *   npm run edit -- TL-IG-2026-07-28-001 --caption "New caption text"
 *   npm run edit -- TL-IG-2026-07-28-001 --hook "New hook" --note "Toned down"
 *
 * The `--` separator is required. Without it npm consumes the flags itself and
 * this script never sees them.
 *
 * Editable fields: --hook, --content, --caption, --cta
 *
 * An edited item returns to `edited`, whose only legal next state is
 * `brand_checked`. Editing therefore cannot skip re-classification — run
 * `npm run risk:classify` afterwards to move it forward.
 */

import { editItem } from '../approval/queue.ts';
import type { ContentItem } from '../lib/types.ts';

const FIELD_FLAGS: Record<string, keyof Pick<ContentItem, 'hook' | 'full_content' | 'caption' | 'cta'>> = {
  '--hook': 'hook',
  '--content': 'full_content',
  '--caption': 'caption',
  '--cta': 'cta',
};

const USAGE = [
  'Usage: npm run edit -- <content-id> [--hook "…"] [--content "…"] [--caption "…"] [--cta "…"] [--note "…"]',
  '',
  'The "--" after the script name is required — without it npm consumes the flags',
  'before this script sees them.',
].join('\n');

const args = process.argv.slice(2);
const id = args[0];

if (!id || id.startsWith('--')) {
  console.error(USAGE);
  process.exit(1);
}

const changes: Partial<Pick<ContentItem, 'hook' | 'full_content' | 'caption' | 'cta'>> = {};
let note: string | undefined;

// Scan for flags rather than assuming fixed positions, so a mangled invocation
// produces a useful message instead of silently assigning the wrong field.
let i = 1;
while (i < args.length) {
  const flag = args[i];

  if (flag === undefined) break;

  if (!flag.startsWith('--')) {
    console.error(`Expected a flag but found "${flag}".`);
    console.error('');
    console.error(USAGE);
    process.exit(1);
  }

  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`Flag "${flag}" is missing its value.`);
    process.exit(1);
  }

  if (flag === '--note') {
    note = value;
  } else {
    const field = FIELD_FLAGS[flag];
    if (!field) {
      console.error(`Unknown flag "${flag}". Expected one of: ${Object.keys(FIELD_FLAGS).join(', ')}, --note`);
      process.exit(1);
    }
    changes[field] = value;
  }

  i += 2;
}

if (Object.keys(changes).length === 0) {
  console.error('No changes supplied. Pass at least one of --hook, --content, --caption, --cta.');
  console.error('');
  console.error(USAGE);
  process.exit(1);
}

try {
  const item = editItem(id, changes, note);
  console.log(`Edited ${item.id} → ${item.status}`);
  console.log(`  Fields changed: ${Object.keys(changes).join(', ')}`);
  console.log('  Previous classification cleared.');
  console.log('');
  console.log('Run `npm run risk:classify` to re-check it. It cannot be approved until that completes.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
