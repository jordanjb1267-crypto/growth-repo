#!/usr/bin/env node
/**
 * Long-running local scheduler — the headless alternative to cron/launchd.
 *
 *   npm run scheduler
 *
 * Runs the spec's daily timetable in LOCAL time. State is persisted per day in
 * logs/scheduler-state.json, so a restart never double-runs a job and a laptop
 * asleep at 8:00 runs the missed jobs (in order) when it wakes.
 *
 * Jobs run sequentially, never concurrently — generate must not race classify.
 * A failing job is logged and does not stop the others; publish remains gated
 * by the kill switches regardless of what the schedule says.
 *
 * Prefer cron? scripts/crontab.example has the equivalent lines.
 */

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../lib/paths.ts';
import { loadEnvFile } from '../lib/env-file.ts';
import { dayId } from '../lib/dates.ts';

const execFileAsync = promisify(execFile);

loadEnvFile();

interface Job {
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
const JOBS: Job[] = [
  { name: 'daily:research', script: 'src/scripts/daily-research.ts', hour: 7, minute: 0, timeout_ms: 15 * 60_000 },
  { name: 'content:generate', script: 'src/scripts/generate-content.ts', hour: 8, minute: 0, timeout_ms: 20 * 60_000 },
  { name: 'risk:classify', script: 'src/scripts/classify-risk.ts', hour: 8, minute: 30, timeout_ms: 30 * 60_000 },
  { name: 'approval:digest', script: 'src/scripts/approval-digest.ts', args: ['--email'], hour: 9, minute: 0, timeout_ms: 5 * 60_000 },
  { name: 'publish:approved', script: 'src/scripts/publish-approved.ts', hour: 12, minute: 0, timeout_ms: 30 * 60_000 },
  { name: 'analytics:collect', script: 'src/scripts/collect-analytics.ts', hour: 20, minute: 0, timeout_ms: 10 * 60_000 },
  { name: 'learning:update', script: 'src/scripts/update-memory.ts', hour: 20, minute: 30, timeout_ms: 5 * 60_000 },
  { name: 'weekly:review', script: 'src/scripts/weekly-review.ts', hour: 20, minute: 0, day_of_week: 5, timeout_ms: 5 * 60_000 },
  { name: 'weekly:plan', script: 'src/scripts/weekly-plan.ts', hour: 9, minute: 0, day_of_week: 0, timeout_ms: 5 * 60_000 },
];

const STATE_FILE = join(REPO_ROOT, 'logs', 'scheduler-state.json');
const LOG_FILE = join(REPO_ROOT, 'logs', 'scheduler.log');

type State = Record<string, string>; // job name -> last completed local date

function readState(): State {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  } catch {
    return {};
  }
}

function writeState(state: State): void {
  mkdirSync(join(REPO_ROOT, 'logs'), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  mkdirSync(join(REPO_ROOT, 'logs'), { recursive: true });
  appendFileSync(LOG_FILE, `${stamped}\n`, 'utf8');
}

/** Local calendar date, since the timetable is founder-local. */
function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isDue(job: Job, now: Date, state: State): boolean {
  if (job.day_of_week !== undefined && now.getDay() !== job.day_of_week) return false;
  if (state[job.name] === localDate(now)) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= job.hour * 60 + job.minute;
}

async function runJob(job: Job): Promise<void> {
  log(`start ${job.name}`);
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(REPO_ROOT, job.script), ...(job.args ?? [])],
      { cwd: REPO_ROOT, timeout: job.timeout_ms, maxBuffer: 16 * 1024 * 1024 },
    );
    if (stdout.trim()) appendFileSync(LOG_FILE, `${stdout.trimEnd()}\n`, 'utf8');
    if (stderr.trim()) appendFileSync(LOG_FILE, `${stderr.trimEnd()}\n`, 'utf8');
    log(`done  ${job.name}`);
  } catch (error) {
    // A failed job is loud in the log but never takes down the scheduler or
    // blocks the rest of the day. State is still marked so a broken job does
    // not retry in a tight loop all day — it gets another chance tomorrow.
    log(`FAIL  ${job.name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  const state = readState();
  const due = JOBS.filter((job) => isDue(job, now, state));

  for (const job of due) {
    await runJob(job);
    const fresh = readState();
    fresh[job.name] = localDate(now);
    writeState(fresh);
  }
}

async function main(): Promise<void> {
  log(`scheduler up — ${JOBS.length} jobs, local time base, state in logs/scheduler-state.json`);
  log('note: jobs missed while the machine slept run on wake, in timetable order.');

  // Serialized loop: a long publish cannot overlap the next tick's jobs.
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

await main();
