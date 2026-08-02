#!/usr/bin/env node
/**
 * Local scheduler — the headless alternative to cron/launchd.
 *
 *   npm run scheduler                                    # production: continuous loop
 *   npm run scheduler -- --dry-run                       # evaluate only, change nothing
 *   npm run scheduler -- --once --only publish:approved  # one tick, one named job
 *   npm run scheduler -- --once --all-due                # one tick, every due job
 *
 * Runs the spec's daily timetable in LOCAL time. State is persisted per day in
 * logs/scheduler-state.json, so a restart never double-runs a job and a laptop
 * asleep at 8:00 runs the missed jobs (in order) when it wakes.
 *
 * Jobs run sequentially, never concurrently — generate must not race classify.
 * A failing job is logged and does not stop the others; publish remains gated
 * by the kill switches regardless of what the schedule says.
 *
 * TWO SAFETY PROPERTIES worth understanding before changing this file:
 *
 * 1. `--once` refuses to guess. On a machine that has been off all morning,
 *    a bare one-shot tick would fire every catch-up job at once — generation,
 *    classification, publish — which is rarely what someone rehearsing a
 *    single job intends. It therefore requires an explicit execution selector,
 *    either `--only <job>` or `--all-due`. The continuous loop is unaffected:
 *    running every due job is precisely its purpose.
 *
 * 2. One scheduler per checkout. Two ticks interleaving would double-run jobs
 *    and race on the state file, so a live tick holds an atomic directory lock.
 *
 * `--dry-run` is the safe rehearsal: it reads the clock and the state file and
 * reports what WOULD run. It spawns nothing, touches no network, writes no
 * state or log, and takes no lock. It therefore cannot report how a job's own
 * command would have behaved — a job it lists as due is a job it would have
 * invoked, nothing more.
 *
 * KNOWN LIMITATIONS (unchanged by this file's hardening, and not solved here):
 *   - `--only` accepts exactly ONE job per invocation. Rehearsing a sequence
 *     such as generate-then-classify takes two invocations, and the second is
 *     not conditioned on the first succeeding.
 *   - A failed job is still MARKED COMPLETE for the day, by the pre-existing
 *     anti-tight-loop policy, and is not retried automatically. One broken
 *     morning costs that day's run. Retry/backoff is a separate design; the
 *     scheduler is not self-healing.
 *
 * Prefer cron? scripts/crontab.example has the equivalent lines.
 */

import { execFile } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../lib/paths.ts';
import { loadEnvFile } from '../lib/env-file.ts';

const execFileAsync = promisify(execFile);

export interface Job {
  name: string;
  script: string;
  args?: string[];
  hour: number;
  minute: number;
  /** 0=Sunday … 6=Saturday. Omit for daily. */
  day_of_week?: number;
  timeout_ms: number;
}

/** The spec's recommended schedule, in order within each day. */
export const JOBS: Job[] = [
  { name: 'daily:research', script: 'src/scripts/daily-research.ts', hour: 7, minute: 0, timeout_ms: 15 * 60_000 },
  { name: 'content:generate', script: 'src/scripts/generate-content.ts', hour: 8, minute: 0, timeout_ms: 20 * 60_000 },
  { name: 'risk:classify', script: 'src/scripts/classify-risk.ts', hour: 8, minute: 30, timeout_ms: 30 * 60_000 },
  { name: 'approval:digest', script: 'src/scripts/approval-digest.ts', hour: 9, minute: 0, timeout_ms: 5 * 60_000 },
  { name: 'publish:approved', script: 'src/scripts/publish-approved.ts', hour: 12, minute: 0, timeout_ms: 30 * 60_000 },
  { name: 'analytics:collect', script: 'src/scripts/collect-analytics.ts', hour: 20, minute: 0, timeout_ms: 10 * 60_000 },
  { name: 'learning:update', script: 'src/scripts/update-memory.ts', hour: 20, minute: 30, timeout_ms: 5 * 60_000 },
  { name: 'weekly:review', script: 'src/scripts/weekly-review.ts', hour: 20, minute: 0, day_of_week: 5, timeout_ms: 5 * 60_000 },
  { name: 'weekly:plan', script: 'src/scripts/weekly-plan.ts', hour: 9, minute: 0, day_of_week: 0, timeout_ms: 5 * 60_000 },
];

export const DEFAULT_STATE_FILE = join(REPO_ROOT, 'logs', 'scheduler-state.json');
export const DEFAULT_LOG_FILE = join(REPO_ROOT, 'logs', 'scheduler.log');
export const DEFAULT_LOCK_DIR = join(REPO_ROOT, 'logs', 'scheduler.lock');

/** job name -> last completed local date */
export type State = Record<string, string>;

export const USAGE = [
  'Usage:',
  '  npm run scheduler                                    continuous loop (production)',
  '  npm run scheduler -- --dry-run                       evaluate only; no execution, no writes',
  '  npm run scheduler -- --once --only <job>             one tick, one named job',
  '  npm run scheduler -- --once --all-due                one tick, every currently due job',
  '',
  `Jobs: ${JOBS.map((j) => j.name).join(', ')}`,
].join('\n');

// ---------------------------------------------------------------------------
// Digest email — a founder-notification control, deliberately separate from the
// marketing kill switches.
// ---------------------------------------------------------------------------

export const DIGEST_EMAIL_SWITCH = 'SCHEDULER_DIGEST_EMAIL';

/**
 * Arguments for a job at run time.
 *
 * The scheduler used to pass `--email` to the digest unconditionally. That is
 * a real send the moment Resend credentials exist, with every publishing
 * switch still false — surprising, because nothing in the marketing switches
 * governs it. It is now opt-in, and follows the repository's canonical rule:
 * only the exact string "true" enables it.
 */
export function jobArgs(job: Job, env: NodeJS.ProcessEnv = process.env): string[] {
  const base = job.args ?? [];
  if (job.name === 'approval:digest' && env[DIGEST_EMAIL_SWITCH] === 'true') {
    return [...base, '--email'];
  }
  return base;
}

// ---------------------------------------------------------------------------
// CLI parsing — all validation happens here, before any filesystem access.
// ---------------------------------------------------------------------------

export type SchedulerMode = 'loop' | 'once' | 'dry-run';

export interface ParsedArgs {
  mode: SchedulerMode;
  only: string | null;
  allDue: boolean;
}

export type ParseResult = { ok: true; args: ParsedArgs } | { ok: false; error: string };

/**
 * Parse scheduler flags.
 *
 * `--dry-run` wins over `--once` when both are given: it is the strictly safer
 * of the two, and silently upgrading a dry run to a real tick would be the
 * worst possible way to resolve the ambiguity.
 */
export function parseSchedulerArgs(argv: readonly string[], jobs: readonly Job[] = JOBS): ParseResult {
  let dryRun = false;
  let once = false;
  let allDue = false;
  let only: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--once') once = true;
    else if (arg === '--all-due') allDue = true;
    else if (arg === '--only') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { ok: false, error: `--only requires a job name.\n\n${USAGE}` };
      only = value;
      i += 1;
    } else if (arg?.startsWith('--only=')) {
      only = arg.slice('--only='.length);
      if (!only) return { ok: false, error: `--only requires a job name.\n\n${USAGE}` };
    } else {
      return { ok: false, error: `Unknown argument: ${arg}\n\n${USAGE}` };
    }
  }

  if (only !== null && allDue) {
    return {
      ok: false,
      error: `--only and --all-due are mutually exclusive: one names a single job, the other authorizes all of them.\n\n${USAGE}`,
    };
  }

  if (only !== null && !jobs.some((j) => j.name === only)) {
    return { ok: false, error: `Unknown job "${only}". Valid jobs: ${jobs.map((j) => j.name).join(', ')}` };
  }

  const mode: SchedulerMode = dryRun ? 'dry-run' : once ? 'once' : 'loop';

  // A bare --once would fire every catch-up job at once on a machine that has
  // been off. Require the caller to say which they meant.
  if (mode === 'once' && only === null && !allDue) {
    return {
      ok: false,
      error:
        '--once requires an explicit execution selector.\n' +
        '  --once --only <job>   run one named job\n' +
        '  --once --all-due      run every currently due job\n' +
        'Refusing to guess: with no state file, a single tick can fire every catch-up job at once.\n' +
        `Use --dry-run to see what is currently due without executing anything.\n\n${USAGE}`,
    };
  }

  return { ok: true, args: { mode, only, allDue } };
}

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------

export interface LockOwner {
  pid: number;
  started_at: string;
  mode: string;
}

export type LivenessCheck = (pid: number) => boolean;

/** Signal 0 probes existence without delivering anything. EPERM means the
 *  process exists but belongs to another user — still alive. */
export const isProcessAlive: LivenessCheck = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export interface LockHandle {
  owner: LockOwner;
  release(): void;
}

export type AcquireResult =
  | { ok: true; handle: LockHandle; recoveredStale: boolean }
  | { ok: false; error: string; heldBy: LockOwner | null };

function readOwner(lockDir: string): LockOwner | null {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) as LockOwner;
  } catch {
    return null;
  }
}

/**
 * Acquire the single-instance lock.
 *
 * mkdir is the atomic primitive: it either creates the directory or fails with
 * EEXIST, with no window between test and create. Stale recovery avoids the
 * obvious race — two processes both finding a dead owner and both deleting it —
 * by having each contender first RENAME the stale directory to a private name.
 * rename is also atomic, so exactly one contender can succeed; the loser sees
 * ENOENT and simply retries the mkdir, where it will either win cleanly or find
 * the winner's fresh lock.
 */
export function acquireLock(options: {
  lockDir?: string;
  mode?: string;
  pid?: number;
  isAlive?: LivenessCheck;
} = {}): AcquireResult {
  const {
    lockDir = DEFAULT_LOCK_DIR,
    mode = 'scheduler',
    pid = process.pid,
    isAlive = isProcessAlive,
  } = options;

  const owner: LockOwner = { pid, started_at: new Date().toISOString(), mode };

  const write = (): LockHandle => {
    writeFileSync(join(lockDir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
    return {
      owner,
      release: () => rmSync(lockDir, { recursive: true, force: true }),
    };
  };

  const tryCreate = (): boolean => {
    try {
      mkdirSync(lockDir, { recursive: false });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  };

  mkdirSync(join(lockDir, '..'), { recursive: true });

  if (tryCreate()) return { ok: true, handle: write(), recoveredStale: false };

  // Held. Is the holder alive?
  const held = readOwner(lockDir);
  if (held && isAlive(held.pid)) {
    return {
      ok: false,
      heldBy: held,
      error:
        `Another scheduler is already running for this checkout (pid ${held.pid}, ` +
        `started ${held.started_at}, mode ${held.mode}). Refusing to start a second one.`,
    };
  }

  // Stale (dead pid) or unreadable owner. Claim it via atomic rename.
  const claimed = `${lockDir}.stale-${pid}-${Date.now()}`;
  try {
    renameSync(lockDir, claimed);
  } catch {
    // Someone else is mid-recovery. One retry; if it is taken, report held.
    if (tryCreate()) return { ok: true, handle: write(), recoveredStale: true };
    const now = readOwner(lockDir);
    return {
      ok: false,
      heldBy: now,
      error: `Another scheduler claimed the lock during stale recovery${now ? ` (pid ${now.pid})` : ''}.`,
    };
  }
  rmSync(claimed, { recursive: true, force: true });

  if (tryCreate()) return { ok: true, handle: write(), recoveredStale: true };
  const now = readOwner(lockDir);
  return {
    ok: false,
    heldBy: now,
    error: `Another scheduler claimed the lock during stale recovery${now ? ` (pid ${now.pid})` : ''}.`,
  };
}

// ---------------------------------------------------------------------------
// Due selection
// ---------------------------------------------------------------------------

export type JobStatus = 'due' | 'not_yet_due' | 'wrong_day' | 'already_completed' | 'excluded';

export interface JobEvaluation {
  job: Job;
  status: JobStatus;
  reason: string;
}

/** Local calendar date, since the timetable is founder-local. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Classify every job against the clock and prior state.
 *
 * Precedence is deliberate: an excluded job reports exclusion rather than a
 * schedule verdict, so `--only` output never implies anything about the jobs
 * it filtered out.
 */
export function evaluateJobs(params: {
  now: Date;
  state: State;
  only?: string | null;
  jobs?: readonly Job[];
}): JobEvaluation[] {
  const { now, state, only = null, jobs = JOBS } = params;
  const today = localDate(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  return jobs.map((job) => {
    if (only !== null && job.name !== only) {
      return { job, status: 'excluded' as const, reason: `excluded by --only ${only}` };
    }
    if (job.day_of_week !== undefined && now.getDay() !== job.day_of_week) {
      return {
        job,
        status: 'wrong_day' as const,
        reason: `runs ${DAY_NAMES[job.day_of_week]} only; today is ${DAY_NAMES[now.getDay()]}`,
      };
    }
    if (state[job.name] === today) {
      return { job, status: 'already_completed' as const, reason: `already completed for ${today}` };
    }
    const scheduled = job.hour * 60 + job.minute;
    if (minutesNow < scheduled) {
      return {
        job,
        status: 'not_yet_due' as const,
        reason: `scheduled ${hhmm(job.hour, job.minute)}, ${scheduled - minutesNow} min from now`,
      };
    }
    const late = minutesNow - scheduled;
    return {
      job,
      status: 'due' as const,
      reason:
        `scheduled ${hhmm(job.hour, job.minute)}, now ${hhmm(now.getHours(), now.getMinutes())}` +
        ` (${late} min past)${late > 0 ? ' — catch-up' : ''}; no completion recorded for ${today}`,
    };
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function readState(file: string = DEFAULT_STATE_FILE): State {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as State;
  } catch {
    return {};
  }
}

function writeState(state: State, file: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type JobRunner = (job: Job, env: NodeJS.ProcessEnv) => Promise<void>;

/** Production runner: spawns the job's script as a child process. */
export const spawnJob: JobRunner = async (job, env) => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [join(REPO_ROOT, job.script), ...jobArgs(job, env)],
    { cwd: REPO_ROOT, timeout: job.timeout_ms, maxBuffer: 16 * 1024 * 1024 },
  );
  if (stdout.trim()) process.stdout.write(`${stdout.trimEnd()}\n`);
  if (stderr.trim()) process.stderr.write(`${stderr.trimEnd()}\n`);
};

export interface TickOptions {
  now?: Date;
  only?: string | null;
  env?: NodeJS.ProcessEnv;
  runner?: JobRunner;
  statePath?: string;
  /** null disables file logging (used by tests). */
  logPath?: string | null;
  quiet?: boolean;
}

export interface TickResult {
  ran: string[];
  failed: string[];
}

function makeLogger(logPath: string | null, quiet: boolean) {
  return (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line}`;
    if (!quiet) console.log(stamped);
    if (logPath) {
      mkdirSync(join(logPath, '..'), { recursive: true });
      appendFileSync(logPath, `${stamped}\n`, 'utf8');
    }
  };
}

/**
 * One scheduler tick: run every due job in timetable order, marking each
 * complete as it finishes.
 *
 * A failed job is recorded and does not stop the rest — state is still marked
 * so a broken job does not retry in a tight loop all day; it gets another
 * chance tomorrow. That anti-tight-loop policy is deliberate and unchanged
 * here; it is NOT a retry mechanism. Jobs excluded by `--only`, or not due,
 * are never marked.
 */
export async function runTick(options: TickOptions = {}): Promise<TickResult> {
  const {
    now = new Date(),
    only = null,
    env = process.env,
    runner = spawnJob,
    statePath = DEFAULT_STATE_FILE,
    logPath = DEFAULT_LOG_FILE,
    quiet = false,
  } = options;

  const log = makeLogger(logPath, quiet);
  const due = evaluateJobs({ now, state: readState(statePath), only }).filter((e) => e.status === 'due');
  const result: TickResult = { ran: [], failed: [] };

  for (const { job } of due) {
    log(`start ${job.name}`);
    try {
      await runner(job, env);
      log(`done  ${job.name}`);
      result.ran.push(job.name);
    } catch (error) {
      log(`FAIL  ${job.name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      result.failed.push(job.name);
    }
    const fresh = readState(statePath);
    fresh[job.name] = localDate(now);
    writeState(fresh, statePath);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<JobStatus, string> = {
  due: 'DUE      ',
  not_yet_due: 'not due  ',
  wrong_day: 'wrong day',
  already_completed: 'done     ',
  excluded: 'excluded ',
};

export function formatEvaluation(evaluations: readonly JobEvaluation[]): string {
  return evaluations
    .map((e) => `  ${STATUS_LABEL[e.status]}  ${e.job.name.padEnd(18)} ${e.reason}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseSchedulerArgs(argv);
  if (!parsed.ok) {
    // Argument errors are reported before any state is read or written.
    console.error(parsed.error);
    return 1;
  }
  const { mode, only } = parsed.args;

  loadEnvFile();

  if (mode === 'dry-run') {
    // No lock: dry run only READS shared state and never executes or writes,
    // so it stays usable against a running scheduler — which is its main job,
    // answering "what is the live scheduler about to do?". A torn read while
    // the holder rewrites state is caught by readState and degrades to an
    // empty-state view, which over-reports due jobs but executes nothing.
    const now = new Date();
    const state = readState();
    console.log('SCHEDULER DRY RUN — evaluation only. No subprocess, no network, no state or log written, no lock taken.');
    console.log(`now: ${now.toString().slice(0, 24)} (local)   state file: ${existsSync(DEFAULT_STATE_FILE) ? DEFAULT_STATE_FILE : '(absent — nothing has run yet)'}`);
    if (only) console.log(`--only ${only}`);
    console.log(`${DIGEST_EMAIL_SWITCH}=${process.env[DIGEST_EMAIL_SWITCH] ?? '(unset)'} → digest args: ${JSON.stringify(jobArgs(JOBS.find((j) => j.name === 'approval:digest')!, process.env))}`);
    console.log('');
    const evaluations = evaluateJobs({ now, state, only });
    console.log(formatEvaluation(evaluations));
    console.log('');
    const dueNames = evaluations.filter((e) => e.status === 'due').map((e) => e.job.name);
    console.log(
      dueNames.length === 0
        ? 'Nothing due. A real tick would run no jobs.'
        : `A real tick would invoke ${dueNames.length} job(s), in order: ${dueNames.join(', ')}.\n` +
          'Dry run does not invoke them, so it reports nothing about how their commands would behave.',
    );
    return 0;
  }

  const lock = acquireLock({ mode });
  if (!lock.ok) {
    console.error(lock.error);
    return 1;
  }
  if (lock.recoveredStale) {
    console.log('note: recovered a stale scheduler lock left by a dead process.');
  }

  const release = () => lock.handle.release();
  const onSignal = (signal: NodeJS.Signals) => {
    release();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    if (mode === 'once') {
      const result = await runTick({ only });
      console.log(`tick complete — ran ${result.ran.length}, failed ${result.failed.length}`);
      return result.failed.length > 0 ? 1 : 0;
    }

    // Production: serialized loop — a long publish cannot overlap the next tick.
    const log = makeLogger(DEFAULT_LOG_FILE, false);
    log(`scheduler up — ${JOBS.length} jobs, local time base, state in ${DEFAULT_STATE_FILE}`);
    log('note: jobs missed while the machine slept run on wake, in timetable order.');
    for (;;) {
      await runTick({ only });
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  } finally {
    // Runs on normal completion and on a job failure alike.
    release();
  }
}

/** Run only when invoked as a command, never on import — the module exports
 *  its job table, selection logic, and lock for tests, and importing those
 *  must neither start a scheduler nor take a lock. Same guard as
 *  src/scripts/audit-connectors.ts. */
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
  process.exitCode = await main(process.argv.slice(2));
}
