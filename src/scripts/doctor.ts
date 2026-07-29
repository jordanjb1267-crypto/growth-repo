#!/usr/bin/env node
/**
 * Standup doctor — the credential-insertion companion.
 *
 *   npm run doctor
 *
 * One readiness report across the whole system: toolchain, safety core,
 * templates, memory banks, provider, and a per-channel table showing exactly
 * what each publisher still needs (credential command, switch state, asset
 * hosting). The intended loop on standup day: run doctor → do the next thing
 * it names → run doctor again, until every channel you care about reads ready.
 *
 * Offline by design — it checks presence and integrity, it does not call
 * platform APIs. Exit code is non-zero only when the SAFETY core is broken
 * (rules, templates, state machine, memory files); missing credentials are
 * reported, not failed on, because starting without them is the normal state.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/paths.ts';
import { loadEnvFile } from '../lib/env-file.ts';
import { loadRules } from '../risk/evaluate.ts';
import { listTemplates, computeTemplateHash } from '../templates/template.ts';
import { checkPublishAllowed, DRAFT_ONLY_PLATFORMS, GLOBAL_SWITCH, platformSwitchName } from '../lib/killswitch.ts';
import { connectorHealth } from '../publish/adapter.ts';
import { BlogAdapter } from '../publish/blog.ts';
import { EmailAdapter } from '../publish/email.ts';
import { LinkedInAdapter } from '../publish/linkedin.ts';
import { FacebookPageAdapter } from '../publish/facebook-page.ts';
import { InstagramAdapter } from '../publish/instagram.ts';
import { YouTubeAdapter } from '../publish/youtube.ts';
import { TikTokAdapter } from '../publish/tiktok.ts';
import { getProvider } from '../llm/index.ts';
import { PRODUCTS } from '../lib/types.ts';
import type { PublisherAdapter } from '../publish/adapter.ts';

loadEnvFile();

const OK = '  ✔';
const BAD = '  ✖';
const WARN = '  –';

let safetyFailures = 0;

function section(title: string): void {
  console.log('');
  console.log(title);
  console.log('─'.repeat(72));
}

function ok(message: string): void {
  console.log(`${OK} ${message}`);
}
function bad(message: string, safety = false): void {
  console.log(`${BAD} ${message}`);
  if (safety) safetyFailures += 1;
}
function warn(message: string): void {
  console.log(`${WARN} ${message}`);
}

function version(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      ?.trim() ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('STANDUP DOCTOR');
  console.log('═'.repeat(72));

  // --- Toolchain -----------------------------------------------------------
  section('Toolchain');
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 18)) ok(`node ${process.versions.node}`);
  else bad(`node ${process.versions.node} — need 22.18+ for native TypeScript`, true);

  const claude = version('claude', ['--version']);
  if (claude) ok(`claude CLI: ${claude}`);
  else bad('claude CLI not found — content generation and rubric scoring cannot run', true);

  const ffprobe = version('ffprobe', ['-version']);
  if (ffprobe) ok('ffprobe present — video duration/aspect validated before upload');
  else warn('ffprobe absent — video duration checks degrade to a warning (install ffmpeg before Phase 4 video publishing)');

  // --- Safety core ---------------------------------------------------------
  section('Safety core');
  try {
    const rules = loadRules();
    ok(`risk rules: ${rules.length} rules load and compile`);
  } catch (error) {
    bad(`risk rules failed to load: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  for (const product of PRODUCTS) {
    for (const template of listTemplates(product)) {
      if (computeTemplateHash(template) === template.content_hash) {
        ok(`template ${template.id}: sealed and approved by ${template.approved_by}`);
      } else {
        bad(`template ${template.id}: hash does not match — edited since approval. Its exemption is void until re-approved and re-sealed (npm run seal:template -- --all)`, true);
      }
    }
  }

  for (const file of [
    'hook-bank.json', 'objection-bank.json', 'audience-language-bank.json',
    'platform-performance.json', 'campaign-history.json', 'brand-rule-updates.json',
  ]) {
    const full = join(REPO_ROOT, 'memory', file);
    try {
      JSON.parse(readFileSync(full, 'utf8'));
      ok(`memory/${file}`);
    } catch {
      bad(`memory/${file} missing or unparseable`, true);
    }
  }

  // --- Configuration -------------------------------------------------------
  section('Configuration');
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    warn('.env does not exist yet — cp .env.example .env (the auth scripts also create it on first write)');
  } else {
    const mode = statSync(envPath).mode & 0o777;
    if (mode & 0o077) warn(`.env permissions are ${mode.toString(8)} — consider chmod 600`);
    else ok('.env present, permissions 600');
  }

  const provider = getProvider();
  const health = await provider.healthCheck();
  if (health.ok) ok(`LLM provider "${provider.name}": ${health.detail}`);
  else bad(`LLM provider "${provider.name}": ${health.detail}`, true);

  if (process.env.RIG_RECEIPTS_URL && process.env.TILAWAH_LOCK_URL) ok('product URLs set — UTM funnel attribution active');
  else warn('RIG_RECEIPTS_URL / TILAWAH_LOCK_URL not both set — published CTA links carry no funnel attribution until they are');

  if (process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID) ok('PostHog query credentials set — funnel collection active');
  else warn('POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID not set — analytics:collect skips funnel metrics (the ingestion key alone cannot query)');

  // --- Channels ------------------------------------------------------------
  section('Channels');
  const adapters: PublisherAdapter[] = [
    new BlogAdapter(), new EmailAdapter(), new LinkedInAdapter(),
    new FacebookPageAdapter(), new InstagramAdapter(), new YouTubeAdapter(), new TikTokAdapter(),
  ];

  const globalOn = process.env[GLOBAL_SWITCH] === 'true';
  console.log(`  ${GLOBAL_SWITCH}=${globalOn ? 'true' : 'false — nothing publishes anywhere until this is "true"'}`);
  console.log('');

  for (const adapter of adapters) {
    const auth = await adapter.validateAuth(process.env);
    const switches = checkPublishAllowed(adapter.platform, process.env);
    const paused = connectorHealth(adapter.platform).paused;

    const state = !auth.ok
      ? `needs credentials — ${auth.detail}`
      : paused
        ? `PAUSED — investigate, then npm run connector:resume ${adapter.platform}`
        : switches.allowed
          ? 'READY — will publish approved content'
          : `credentialed; switch off (${platformSwitchName(adapter.platform)}=true to enable)`;

    console.log(`  ${auth.ok && !paused ? '✔' : '·'} ${adapter.platform.padEnd(16)} ${state}`);
  }

  console.log('');
  for (const platform of DRAFT_ONLY_PLATFORMS) {
    console.log(`  · ${platform.padEnd(16)} manual-only by design — drafts queue for the founder, no publish path exists`);
  }

  // --- Verdict -------------------------------------------------------------
  section('Verdict');
  if (safetyFailures > 0) {
    console.log(`  ${safetyFailures} safety-core problem(s) above — fix these before anything else.`);
    process.exitCode = 1;
  } else {
    console.log('  Safety core intact. Remaining items above are credential/config steps, in the order listed.');
    console.log('  Re-run after each step; standup is done when every channel you want reads READY.');
  }
  console.log('');
}

await main();
