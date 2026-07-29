#!/usr/bin/env node
/**
 * Founder action: clear a paused connector after investigating its failures.
 *
 *   npm run connector:resume Blog
 *   npm run connector:resume Email
 */

import { connectorHealth, resumeConnector } from '../publish/adapter.ts';
import { PLATFORMS } from '../lib/types.ts';
import type { Platform } from '../lib/types.ts';

const name = process.argv.slice(2).join(' ');

if (!(PLATFORMS as readonly string[]).includes(name)) {
  console.error(`Usage: npm run connector:resume <platform>`);
  console.error(`Platforms: ${PLATFORMS.join(', ')}`);
  process.exit(1);
}

const platform = name as Platform;
const before = connectorHealth(platform);

if (!before.paused && before.consecutive_failures === 0) {
  console.log(`${platform} is not paused and has no recorded failures. Nothing to do.`);
} else {
  resumeConnector(platform);
  console.log(`${platform} resumed. Previous state: ${before.consecutive_failures} failure(s), last error: ${before.last_error ?? 'none'}.`);
}
