#!/usr/bin/env node
/**
 * Connector, credential, and environment audit — the spec's mandatory first step.
 *
 * Generates all six /audit files.
 *
 *   npm run audit:connectors
 *
 * RUN THIS ON THE FOUNDER'S LAPTOP. An audit generated anywhere else describes
 * that machine, not the one the system runs on — a cloud container will report
 * ffmpeg, sqlite3, gh, and cron as absent when they may well be installed
 * locally. See CLAUDE.md addendum A7.
 *
 * SECRETS: this script reads .env to learn which KEYS are set. It never reads,
 * logs, or writes a VALUE. The only fact that leaves this process is a boolean
 * per key name.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths, REPO_ROOT } from '../lib/paths.ts';
import { CONNECTORS, type ConnectorEntry } from './connector-matrix-data.ts';

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

interface ToolProbe {
  name: string;
  command: string;
  args: string[];
  required: boolean;
  purpose: string;
}

const TOOL_PROBES: ToolProbe[] = [
  { name: 'Node.js', command: 'node', args: ['--version'], required: true, purpose: 'Runtime for every script here' },
  { name: 'npm', command: 'npm', args: ['--version'], required: true, purpose: 'Runs the command list' },
  { name: 'pnpm', command: 'pnpm', args: ['--version'], required: false, purpose: 'Alternative package manager' },
  { name: 'yarn', command: 'yarn', args: ['--version'], required: false, purpose: 'Alternative package manager' },
  { name: 'TypeScript', command: 'tsc', args: ['--version'], required: false, purpose: 'Typecheck gate (npm run typecheck)' },
  { name: 'Python 3', command: 'python3', args: ['--version'], required: false, purpose: 'Ad-hoc data work' },
  { name: 'git', command: 'git', args: ['--version'], required: true, purpose: 'Version control and the audit trail' },
  { name: 'GitHub CLI', command: 'gh', args: ['--version'], required: false, purpose: 'Convenience only' },
  { name: 'SQLite', command: 'sqlite3', args: ['--version'], required: false, purpose: 'Not used — storage is local JSON by design' },
  { name: 'ffmpeg', command: 'ffmpeg', args: ['-version'], required: false, purpose: 'Video validation and processing (Phase 4)' },
  { name: 'ImageMagick', command: 'magick', args: ['--version'], required: false, purpose: 'Thumbnail processing (Phase 4)' },
  { name: 'ImageMagick (legacy)', command: 'convert', args: ['--version'], required: false, purpose: 'Thumbnail processing fallback' },
  { name: 'cron', command: 'crontab', args: ['-V'], required: false, purpose: 'Local scheduling' },
  { name: 'Claude Code', command: 'claude', args: ['--version'], required: true, purpose: 'Content generation backend (claude -p)' },
];

interface ProbeResult extends ToolProbe {
  present: boolean;
  version: string;
}

function probe(tool: ToolProbe): ProbeResult {
  try {
    const out = execFileSync(tool.command, tool.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    });
    return { ...tool, present: true, version: out.split('\n')[0]?.trim() ?? '' };
  } catch {
    return { ...tool, present: false, version: '' };
  }
}

function probeMcp(): { available: boolean; detail: string } {
  try {
    const out = execFileSync('claude', ['mcp', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
    return { available: true, detail: out.trim() || '(no MCP servers configured)' };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? error.message.split('\n')[0] ?? '' : 'unavailable' };
  }
}

/**
 * Probe non-interactive `claude -p` — the backend the whole content engine runs
 * on — by actually running it, as the spec's audit checklist asks.
 *
 * Presence of the binary is not evidence that headless invocation works: it can
 * be present and still time out (a nested Claude Code session, a stalled auth
 * refresh). Reporting "assumed available" off `claude --version` states the one
 * load-bearing capability without testing it, which is exactly the class of
 * claim this audit exists to eliminate.
 *
 * Costs one very short model call per audit run. Set `AUDIT_SKIP_LLM_PROBE=true`
 * to skip it on a machine where spawning it is undesirable.
 */
function probeClaudeHeadless(binaryPresent: boolean): { status: string; detail: string } {
  if (!binaryPresent) return { status: 'unavailable', detail: '`claude` binary not found' };
  if (process.env.AUDIT_SKIP_LLM_PROBE === 'true') {
    return { status: 'not probed', detail: 'skipped via AUDIT_SKIP_LLM_PROBE=true — availability unverified' };
  }

  try {
    const out = execFileSync('claude', ['-p', 'Reply with exactly: ok'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 45_000,
    });
    return { status: 'verified', detail: `responded: ${out.trim().slice(0, 80) || '(empty response)'}` };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ETIMEDOUT') {
      return {
        status: 'FAILED (timed out)',
        detail:
          'no response in 45s. Content generation cannot run until this works. ' +
          'Common cause: the audit was launched from inside a Claude Code session — retry from a plain shell.',
      };
    }
    return {
      status: 'FAILED',
      detail: error instanceof Error ? error.message.split('\n')[0] ?? '' : 'unavailable',
    };
  }
}

// ---------------------------------------------------------------------------
// Secrets — key presence only, never values
// ---------------------------------------------------------------------------

/**
 * Parse .env for KEY NAMES only.
 *
 * The value side of each line is discarded at the point of parsing rather than
 * later, so there is no code path in which a secret value exists in a variable
 * that could be logged by accident.
 */
export function readEnvKeys(file: string): Set<string> {
  return parseEnv(file).configured;
}

/**
 * Every key NAME the file declares, whether or not it carries a value.
 *
 * `.env.example` declares the full set of keys the system understands; most
 * ship empty because they are the credentials the founder has yet to insert.
 * Those empty declarations are the entire point of the secrets report — a
 * report built only from keys that already have values can never show a gap.
 */
export function readDeclaredKeys(file: string): Set<string> {
  return parseEnv(file).declared;
}

function parseEnv(file: string): { declared: Set<string>; configured: Set<string> } {
  const declared = new Set<string>();
  const configured = new Set<string>();
  if (!existsSync(file)) return { declared, configured };

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    const hasValue = trimmed.slice(eq + 1).trim().length > 0;
    declared.add(key);
    if (hasValue) configured.add(key);
  }
  return { declared, configured };
}

/**
 * Build the secrets table over every DECLARED key, not just the set ones.
 *
 * The distinction is load-bearing. `.env.example` pre-fills a minority of keys
 * with non-secret defaults (kill switches, API versions, model names) and
 * leaves the credentials empty. A table built from keys-with-values therefore
 * lists only the defaults, and every row reads "yes" the moment the founder
 * runs `cp .env.example .env` — reporting a fully configured system at the
 * exact moment nothing is configured.
 */
export function secretsReport(
  declaredKeys: Set<string>,
  envKeys: Set<string>,
): { total: number; configured: number; rows: string[][] } {
  const all = [...new Set([...declaredKeys, ...envKeys])].sort();
  return {
    total: all.length,
    configured: all.filter((k) => envKeys.has(k)).length,
    rows: all.map((k) => [`\`${k}\``, envKeys.has(k) ? 'yes' : 'no']),
  };
}

// ---------------------------------------------------------------------------
// Repo inspection
// ---------------------------------------------------------------------------

function listDir(relative: string): string[] {
  const full = join(REPO_ROOT, relative);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((f) => !f.startsWith('.'));
}

function countFiles(relative: string): number {
  return listDir(relative).length;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function statusFor(connector: ConnectorEntry, presentKeys: Set<string>): ConnectorEntry['status'] {
  // Draft-only and not-recommended assessments are policy decisions, not
  // credential facts — credentials must never upgrade them.
  if (connector.status === 'DRAFT_ONLY_RECOMMENDED' || connector.status === 'NOT_RECOMMENDED') {
    return connector.status;
  }
  if (connector.env_vars_needed.length === 0) return connector.status;

  const present = connector.env_vars_needed.filter((k) => presentKeys.has(k));
  if (present.length === connector.env_vars_needed.length) return 'AVAILABLE_AND_CONFIGURED';
  if (present.length > 0) return 'AVAILABLE_MISSING_AUTH';
  return 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED';
}

function table(rows: string[][]): string {
  if (rows.length === 0) return '';
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function main(): void {
  const generatedAt = new Date().toISOString();
  const host = process.platform;
  const probes = TOOL_PROBES.map(probe);
  const mcp = probeMcp();
  const envKeys = readEnvKeys(join(REPO_ROOT, '.env'));
  const exampleKeys = readDeclaredKeys(join(REPO_ROOT, '.env.example'));
  const hasEnvFile = existsSync(join(REPO_ROOT, '.env'));
  const secrets = secretsReport(exampleKeys, envKeys);
  const claudePresent = probes.find((p) => p.name === 'Claude Code')?.present ?? false;
  const headless = probeClaudeHeadless(claudePresent);

  const matrix = CONNECTORS.map((c) => ({ ...c, status: statusFor(c, envKeys) }));

  mkdirSync(paths.audit, { recursive: true });

  const machineWarning = [
    '> **This audit describes the machine it was generated on.**',
    '> Regenerate it on the founder\'s laptop before trusting it. An audit produced',
    '> in a cloud container will report ffmpeg, sqlite3, gh, and cron as absent when',
    '> they may be installed locally. See CLAUDE.md addendum A7.',
  ].join('\n');

  // --- ENVIRONMENT_AUDIT.md ------------------------------------------------
  const missingRequired = probes.filter((p) => p.required && !p.present);

  writeFileSync(
    join(paths.audit, 'ENVIRONMENT_AUDIT.md'),
    [
      '# Environment Audit',
      '',
      `Generated: ${generatedAt}`,
      `Platform: ${host}`,
      '',
      machineWarning,
      '',
      '## Toolchain',
      '',
      table([
        ['Tool', 'Present', 'Version', 'Required', 'Purpose'],
        ...probes.map((p) => [
          p.name,
          p.present ? 'yes' : 'NO',
          p.version || '—',
          p.required ? 'yes' : 'no',
          p.purpose,
        ]),
      ]),
      '',
      missingRequired.length > 0
        ? `**${missingRequired.length} required tool(s) missing: ${missingRequired.map((p) => p.name).join(', ')}.** The system cannot run until these are installed.`
        : 'All required tools present.',
      '',
      '## Claude Code and MCP',
      '',
      `- \`claude\` binary: ${claudePresent ? 'present' : 'NOT FOUND'}`,
      `- Non-interactive \`claude -p\`: ${headless.status} — ${headless.detail}`,
      `- \`claude mcp list\`: ${mcp.available ? 'succeeded' : 'failed'}`,
      '',
      '```text',
      mcp.detail,
      '```',
      '',
      '## Secrets',
      '',
      '> Only key NAMES are inspected. No value is read, logged, or written by this audit.',
      '',
      `- \`.env\` present: ${hasEnvFile ? 'yes' : 'no'}`,
      `- \`.env.example\` present: ${existsSync(join(REPO_ROOT, '.env.example')) ? 'yes' : 'no'}`,
      `- Configured: **${secrets.configured} of ${secrets.total}** declared keys carry a value in \`.env\`.`,
      '',
      secrets.configured < secrets.total
        ? `The ${secrets.total - secrets.configured} key(s) below marked \`no\` are the remaining standup gap. Run \`npm run doctor\` for the per-channel next command.`
        : 'Every declared key carries a value.',
      '',
      table([['Key', 'Configured'], ...secrets.rows]),
      '',
      '## Repository',
      '',
      table([
        ['Location', 'Files'],
        ['`/campaigns/rig-receipts`', String(countFiles('campaigns/rig-receipts'))],
        ['`/campaigns/tilawah-lock`', String(countFiles('campaigns/tilawah-lock'))],
        ['`/brands`', String(countFiles('brands'))],
        ['`/memory`', String(countFiles('memory'))],
        ['`/templates/rig-receipts`', String(countFiles('templates/rig-receipts'))],
        ['`/templates/tilawah-lock`', String(countFiles('templates/tilawah-lock'))],
        ['`/content/drafts`', String(countFiles('content/drafts'))],
        ['`/content/approval-queue`', String(countFiles('content/approval-queue'))],
        ['`/content/published`', String(countFiles('content/published'))],
        ['`/publishers`', String(countFiles('publishers'))],
      ]),
      '',
      '## Scheduling',
      '',
      probes.find((p) => p.name === 'cron')?.present
        ? 'cron is available. Use the schedule in CLAUDE.md, and remember cron runs with a minimal environment — reference absolute paths and source the .env explicitly.'
        : 'cron was not detected. On macOS use launchd, or run a Node scheduler in a long-lived process. Do not assume a scheduled job will inherit your shell environment.',
      '',
    ].join('\n'),
    'utf8',
  );

  // --- CONNECTOR_MATRIX.json ----------------------------------------------
  writeFileSync(
    join(paths.audit, 'CONNECTOR_MATRIX.json'),
    `${JSON.stringify(
      {
        $schema_version: 1,
        generated_at: generatedAt,
        note: 'Access-gate assessments were verified against platform documentation, not inferred from the spec. See CONNECTOR_AUDIT.md for the build-order consequence.',
        connectors: matrix.map(({ phase4_rank: _rank, ...rest }) => rest),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // --- CONNECTOR_AUDIT.md --------------------------------------------------
  const phase4 = matrix
    .filter((c) => c.phase4_rank !== null)
    .sort((a, b) => (a.phase4_rank ?? 0) - (b.phase4_rank ?? 0));

  writeFileSync(
    join(paths.audit, 'CONNECTOR_AUDIT.md'),
    [
      '# Connector Audit',
      '',
      `Generated: ${generatedAt}`,
      '',
      machineWarning,
      '',
      '## Headline',
      '',
      'The spec treats the five social adapters as a single Phase 4 deliverable. They are not equivalent.',
      'Their access gates differ enough to change the build order, and the ordering is not intuitive —',
      'the two channels most people would build first (YouTube, TikTok) are the two that cannot publish',
      'publicly without passing a platform audit.',
      '',
      '## Recommended Phase 4 order',
      '',
      table([
        ['#', 'Connector', 'Gate', 'Status'],
        ...phase4.map((c) => [
          String(c.phase4_rank),
          c.name,
          c.risk_level === 'low' ? 'none' : c.risk_level === 'medium' ? 'app config' : 'platform audit',
          c.status,
        ]),
      ]),
      '',
      '## Full matrix',
      '',
      table([
        ['Connector', 'Category', 'Status', 'Risk', 'Automation'],
        ...matrix.map((c) => [c.name, c.category, c.status, c.risk_level, c.automation_level]),
      ]),
      '',
      '## Per-connector detail',
      '',
      ...matrix.flatMap((c) => [
        `### ${c.name}`,
        '',
        `- **Status:** ${c.status}`,
        `- **Purpose:** ${c.purpose}`,
        `- **Env vars:** ${c.env_vars_needed.length > 0 ? c.env_vars_needed.map((v) => `\`${v}\``).join(', ') : 'none'}`,
        `- **Monthly cost:** ${c.monthly_cost}`,
        `- **Risk:** ${c.risk_level}`,
        `- **Automation:** ${c.automation_level}`,
        '',
        c.notes,
        '',
      ]),
    ].join('\n'),
    'utf8',
  );

  // --- MISSING_CONNECTORS.md ----------------------------------------------
  const missingAuth = matrix.filter(
    (c) => c.status === 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED' || c.status === 'AVAILABLE_MISSING_AUTH',
  );

  const absentTools = probes.filter((p) => !p.present);

  writeFileSync(
    join(paths.audit, 'MISSING_CONNECTORS.md'),
    [
      '# Missing Connectors',
      '',
      `Generated: ${generatedAt}`,
      '',
      machineWarning,
      '',
      '## Connectors awaiting credentials',
      '',
      'Official API available, credentials not fully configured.',
      '',
      table([
        ['Connector', 'Status', 'Missing env vars'],
        ...missingAuth.map((c) => [
          c.name,
          c.status,
          c.env_vars_needed.filter((v) => !envKeys.has(v)).map((v) => `\`${v}\``).join(', ') || '—',
        ]),
      ]),
      '',
      '## Missing tooling',
      '',
      ...(absentTools.length === 0
        ? ['None. Every probed tool is present.', '']
        : [
            table([
              ['Tool', 'Required', 'Purpose'],
              ...absentTools.map((p) => [p.name, p.required ? 'yes' : 'no', p.purpose]),
            ]),
            '',
            'Tools marked not-required are needed from Phase 4 onward, with one exception:',
            'SQLite is not used at all — storage is local JSON by design, so its absence is not a gap.',
            '',
          ]),
    ].join('\n'),
    'utf8',
  );

  // --- RISKY_CONNECTORS.md -------------------------------------------------
  const risky = matrix.filter((c) => c.risk_level === 'high' || c.status === 'NOT_RECOMMENDED');

  writeFileSync(
    join(paths.audit, 'RISKY_CONNECTORS.md'),
    [
      '# Risky Connectors',
      '',
      `Generated: ${generatedAt}`,
      '',
      'Connectors whose risk is high enough to change the build decision, not just the build order.',
      '',
      ...risky.flatMap((c) => [`### ${c.name}`, '', `**Status:** ${c.status} · **Automation:** ${c.automation_level}`, '', c.notes, '']),
      '## Categorically excluded',
      '',
      'These have no automation path in this codebase, and adding one would violate the spec:',
      '',
      '- Private or undocumented platform endpoints',
      '- Browser automation that mimics a human to evade restrictions',
      '- Credential scraping, or scraping behind a login',
      '- Automated DMs and mass commenting',
      '- Automated Reddit or Facebook Group posting',
      '- Engagement buying, follow/unfollow automation',
      '- CAPTCHA bypass, rate-limit evasion',
      '',
      'Reddit, Facebook Groups, and X have no kill switch because they have no publish path at all.',
      'That is a stronger guarantee than a switch that defaults to off.',
      '',
    ].join('\n'),
    'utf8',
  );

  // --- RECOMMENDED_CONNECTORS.md -------------------------------------------
  writeFileSync(
    join(paths.audit, 'RECOMMENDED_CONNECTORS.md'),
    [
      '# Recommended Connector Stack',
      '',
      `Generated: ${generatedAt}`,
      '',
      '## Now (Phases 1-3)',
      '',
      '- Claude Code (`claude -p`) — content generation, no marginal token cost',
      '- Local filesystem + git — storage and audit trail',
      '- Node.js + TypeScript — no build step, no runtime dependencies',
      '- Blog / static host — owned channel, no policy risk, no review gate',
      '- Email provider — owned channel, but approval-gated: a send cannot be retracted',
      '- PostHog — already has an organisation provisioned',
      '',
      '## Phase 4, in this order',
      '',
      ...phase4.map((c) => `${c.phase4_rank}. **${c.name}** — ${c.notes.split('.')[0]}.`),
      '',
      '## Deliberately not adopted',
      '',
      '- **SQLite** — the spec permits JSON or SQLite and prefers local-first. JSON is git-diffable, which serves the auditability requirement directly.',
      '- **LinkedIn Community Management API** — enterprise-partner gated; not realistic solo.',
      '- **X API** — free tier write-capped, paid tier costs more than the rest of the stack combined.',
      '- **Supabase, Notion, Airtable** — no need until local storage is genuinely insufficient.',
      '',
      '## Revisit when',
      '',
      '- A platform audit passes (YouTube, TikTok) — move that connector up the order.',
      '- Content volume outgrows a single JSON directory — reconsider SQLite then, not before.',
      '- `claude -p` throughput becomes the bottleneck — see the cost model in `src/llm/anthropic-api.ts` before switching.',
      '',
    ].join('\n'),
    'utf8',
  );

  // --- Console summary -----------------------------------------------------
  console.log('');
  console.log('Connector audit complete.');
  console.log(`  Platform: ${host}`);
  console.log(`  Tools present: ${probes.filter((p) => p.present).length}/${probes.length}`);
  console.log(`  Configured keys: ${secrets.configured}/${secrets.total} — values were never read`);
  console.log(`  Headless claude -p: ${headless.status}`);
  console.log(`  Connectors assessed: ${matrix.length}`);
  console.log('');
  for (const file of ['CONNECTOR_AUDIT.md', 'CONNECTOR_MATRIX.json', 'MISSING_CONNECTORS.md', 'RISKY_CONNECTORS.md', 'RECOMMENDED_CONNECTORS.md', 'ENVIRONMENT_AUDIT.md']) {
    console.log(`  wrote audit/${file}`);
  }
  console.log('');
  if (missingRequired.length > 0) {
    console.error(`Missing required tooling: ${missingRequired.map((p) => p.name).join(', ')}`);
    process.exitCode = 1;
  }
  console.log('Regenerate this on the founder\'s laptop before trusting it (CLAUDE.md addendum A7).');
  console.log('');
}

/**
 * Run only when invoked as a command, never on import.
 *
 * This module writes all six /audit files as a side effect of loading, so an
 * unguarded call means any import — a test, a future script reusing the env
 * parsers — silently regenerates the audit on whatever machine it happens to
 * be running on, overwriting the founder's laptop-generated output with
 * container data. That is precisely the invalidation CLAUDE.md A7 warns about,
 * and it is not something a reader of the importing file would ever suspect.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(import.meta.filename);
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
