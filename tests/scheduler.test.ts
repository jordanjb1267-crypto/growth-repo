import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import {
  acquireLock,
  DIGEST_EMAIL_SWITCH,
  evaluateJobs,
  jobArgs,
  JOBS,
  parseSchedulerArgs,
  readState,
  runTick,
} from '../src/scripts/scheduler.ts';
import type { Job, JobRunner, State } from '../src/scripts/scheduler.ts';

/** Temp state file per test — never the production logs/scheduler-state.json. */
function tempStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'sched-')), 'scheduler-state.json');
}

/** Records invocations instead of spawning anything. */
function recordingRunner(): { runner: JobRunner; calls: { job: string; args: string[] }[] } {
  const calls: { job: string; args: string[] }[] = [];
  const runner: JobRunner = async (job, env) => {
    calls.push({ job: job.name, args: jobArgs(job, env) });
  };
  return { runner, calls };
}

const job = (name: string): Job => {
  const found = JOBS.find((j) => j.name === name);
  assert.ok(found, `${name} exists`);
  return found;
};

/** Sunday 2026-08-02 15:12 local — the rehearsal clock. */
const SUNDAY_1512 = new Date(2026, 7, 2, 15, 12, 0);

describe('argument parsing', () => {
  it('defaults to the continuous production loop', () => {
    const parsed = parseSchedulerArgs([]);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.args.mode, 'loop');
    assert.equal(parsed.args.only, null);
  });

  it('accepts --dry-run, --once with a selector, and --only in either form', () => {
    for (const [argv, mode, only] of [
      [['--dry-run'], 'dry-run', null],
      [['--once', '--only', 'publish:approved'], 'once', 'publish:approved'],
      [['--once', '--all-due'], 'once', null],
      [['--only=publish:approved'], 'loop', 'publish:approved'],
    ] as const) {
      const parsed = parseSchedulerArgs([...argv]);
      assert.ok(parsed.ok, `${argv.join(' ')} parses`);
      if (!parsed.ok) return;
      assert.equal(parsed.args.mode, mode);
      assert.equal(parsed.args.only, only);
    }
  });

  it('refuses a bare --once and names both valid selectors', () => {
    // On a machine that has been off all morning a bare one-shot tick would
    // fire every catch-up job at once — generation, classification, publish.
    const parsed = parseSchedulerArgs(['--once']);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /--once requires an explicit execution selector/);
    assert.match(parsed.error, /--only <job>/);
    assert.match(parsed.error, /--all-due/);
  });

  it('refuses --only combined with --all-due', () => {
    for (const argv of [['--once', '--only', 'publish:approved', '--all-due'], ['--once', '--all-due', '--only', 'publish:approved']]) {
      const parsed = parseSchedulerArgs(argv);
      assert.equal(parsed.ok, false, `${argv.join(' ')} must fail`);
      if (parsed.ok) return;
      assert.match(parsed.error, /mutually exclusive/);
    }
  });

  it('leaves the continuous loop and dry-run free of the selector requirement', () => {
    // Running every due job is precisely the loop's purpose, and dry-run
    // executes nothing.
    for (const argv of [[], ['--dry-run'], ['--dry-run', '--only', 'publish:approved']]) {
      assert.ok(parseSchedulerArgs(argv).ok, `${argv.join(' ') || '(no args)'} is valid`);
    }
  });

  it('lets --dry-run win over --once, never the reverse', () => {
    // Silently upgrading a requested dry run into a real tick would be the
    // worst way to resolve the ambiguity.
    for (const argv of [['--dry-run', '--once'], ['--once', '--dry-run']]) {
      const parsed = parseSchedulerArgs(argv);
      assert.ok(parsed.ok);
      if (!parsed.ok) return;
      assert.equal(parsed.args.mode, 'dry-run');
    }
  });

  it('fails closed on an unknown job and lists the valid names', () => {
    const parsed = parseSchedulerArgs(['--only', 'publish:everything']);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /Unknown job "publish:everything"/);
    for (const j of JOBS) assert.ok(parsed.error.includes(j.name), `lists ${j.name}`);
  });

  it('rejects --only without a value and unknown flags', () => {
    assert.equal(parseSchedulerArgs(['--only']).ok, false);
    assert.equal(parseSchedulerArgs(['--only', '--once']).ok, false);
    assert.equal(parseSchedulerArgs(['--wat']).ok, false);
  });
});

describe('due selection', () => {
  const evaluate = (now: Date, state: State = {}, only: string | null = null) =>
    Object.fromEntries(evaluateJobs({ now, state, only }).map((e) => [e.job.name, e]));

  it('treats the scheduled minute as due and the minute before as not due', () => {
    const research = job('daily:research'); // 07:00
    const at0659 = evaluate(new Date(2026, 7, 2, 6, 59))[research.name];
    const at0700 = evaluate(new Date(2026, 7, 2, 7, 0))[research.name];
    assert.equal(at0659?.status, 'not_yet_due');
    assert.equal(at0700?.status, 'due');
    assert.match(at0700?.reason ?? '', /scheduled 07:00/);
  });

  it('filters weekly jobs by day of week', () => {
    // weekly:review is Friday (5); 2026-08-02 is a Sunday (0).
    const sunday = evaluate(SUNDAY_1512);
    assert.equal(sunday['weekly:review']?.status, 'wrong_day');
    assert.match(sunday['weekly:review']?.reason ?? '', /Friday only; today is Sunday/);
    // weekly:plan is Sunday (0) at 09:00 — due at 15:12.
    assert.equal(sunday['weekly:plan']?.status, 'due');
  });

  it('suppresses a job already completed today', () => {
    const today = '2026-08-02';
    const evaluated = evaluate(SUNDAY_1512, { 'daily:research': today });
    assert.equal(evaluated['daily:research']?.status, 'already_completed');
    assert.match(evaluated['daily:research']?.reason ?? '', /already completed for 2026-08-02/);
    // Yesterday's completion does not suppress today's run.
    assert.equal(evaluate(SUNDAY_1512, { 'daily:research': '2026-08-01' })['daily:research']?.status, 'due');
  });

  it('catches up every missed job when no state file exists', () => {
    const due = evaluateJobs({ now: SUNDAY_1512, state: {} }).filter((e) => e.status === 'due');
    assert.deepEqual(
      due.map((e) => e.job.name),
      ['daily:research', 'content:generate', 'risk:classify', 'approval:digest', 'publish:approved', 'weekly:plan'],
    );
    assert.match(due[0]?.reason ?? '', /catch-up/);
  });

  it('reports --only exclusions as exclusions, not schedule verdicts', () => {
    const evaluated = evaluate(SUNDAY_1512, {}, 'publish:approved');
    assert.equal(evaluated['publish:approved']?.status, 'due');
    for (const name of ['daily:research', 'weekly:review', 'analytics:collect']) {
      assert.equal(evaluated[name]?.status, 'excluded', `${name} excluded`);
      assert.match(evaluated[name]?.reason ?? '', /--only publish:approved/);
    }
  });

  it('does not make a named job due earlier than its schedule', () => {
    const early = evaluate(new Date(2026, 7, 2, 11, 59), {}, 'publish:approved'); // 12:00 job
    assert.equal(early['publish:approved']?.status, 'not_yet_due');
  });
});

describe('tick execution', () => {
  it('runs due jobs and persists their completion', async () => {
    const statePath = tempStatePath();
    const { runner, calls } = recordingRunner();

    const result = await runTick({ now: SUNDAY_1512, runner, statePath, logPath: null, quiet: true });

    assert.deepEqual(result.failed, []);
    assert.deepEqual(calls.map((c) => c.job), [
      'daily:research', 'content:generate', 'risk:classify', 'approval:digest', 'publish:approved', 'weekly:plan',
    ]);
    const state = readState(statePath);
    assert.equal(state['publish:approved'], '2026-08-02');
  });

  it('with --only runs one job and marks only that job complete', async () => {
    const statePath = tempStatePath();
    const { runner, calls } = recordingRunner();

    const result = await runTick({
      now: SUNDAY_1512, only: 'publish:approved', runner, statePath, logPath: null, quiet: true,
    });

    assert.deepEqual(result.ran, ['publish:approved']);
    assert.deepEqual(calls.map((c) => c.job), ['publish:approved']);
    const state = readState(statePath);
    assert.deepEqual(Object.keys(state), ['publish:approved'], 'excluded jobs are not marked complete');
  });

  it('records a failing job without stopping the tick, and still marks it', async () => {
    const statePath = tempStatePath();
    const failing: JobRunner = async (j) => {
      if (j.name === 'content:generate') throw new Error('boom');
    };

    const result = await runTick({ now: SUNDAY_1512, runner: failing, statePath, logPath: null, quiet: true });

    assert.deepEqual(result.failed, ['content:generate']);
    assert.ok(result.ran.includes('risk:classify'), 'later jobs still run');
    // Existing policy: a broken job is marked so it cannot retry in a tight loop.
    assert.equal(readState(statePath)['content:generate'], '2026-08-02');
  });

  it('writes no state when nothing is due', async () => {
    const statePath = tempStatePath();
    const { runner, calls } = recordingRunner();

    // 06:00 — before the earliest job (07:00).
    const result = await runTick({
      now: new Date(2026, 7, 2, 6, 0), runner, statePath, logPath: null, quiet: true,
    });

    assert.deepEqual(result.ran, []);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(statePath), false, 'no state file created');
  });
});

describe('digest email is opt-in', () => {
  const digest = job('approval:digest');

  it('omits --email by default', () => {
    assert.deepEqual(jobArgs(digest, {} as NodeJS.ProcessEnv), []);
    assert.deepEqual(jobArgs(digest, { [DIGEST_EMAIL_SWITCH]: '' } as NodeJS.ProcessEnv), []);
  });

  it('includes --email only for the exact string "true"', () => {
    assert.deepEqual(jobArgs(digest, { [DIGEST_EMAIL_SWITCH]: 'true' } as NodeJS.ProcessEnv), ['--email']);
    for (const value of ['TRUE', 'True', '1', 'yes', 'on']) {
      assert.deepEqual(jobArgs(digest, { [DIGEST_EMAIL_SWITCH]: value } as NodeJS.ProcessEnv), [], `"${value}" is not true`);
    }
  });

  it('never adds --email to any other job', () => {
    for (const j of JOBS.filter((x) => x.name !== 'approval:digest')) {
      assert.deepEqual(jobArgs(j, { [DIGEST_EMAIL_SWITCH]: 'true' } as NodeJS.ProcessEnv), j.args ?? []);
    }
  });
});

describe('single-instance lock', () => {
  const tempLockDir = () => join(mkdtempSync(join(tmpdir(), 'sched-lock-')), 'scheduler.lock');
  const alwaysAlive = () => true;
  const alwaysDead = () => false;

  it('the first scheduler acquires it and records owner metadata', () => {
    const lockDir = tempLockDir();
    const first = acquireLock({ lockDir, mode: 'once', pid: 4242, isAlive: alwaysDead });

    assert.ok(first.ok);
    if (!first.ok) return;
    assert.equal(first.recoveredStale, false);
    assert.equal(first.handle.owner.pid, 4242);
    assert.equal(first.handle.owner.mode, 'once');
    assert.ok(Date.parse(first.handle.owner.started_at) > 0, 'records a start time');
    assert.ok(existsSync(join(lockDir, 'owner.json')));
  });

  it('refuses a second scheduler while the owner is alive', () => {
    const lockDir = tempLockDir();
    const first = acquireLock({ lockDir, pid: 111, isAlive: alwaysAlive });
    assert.ok(first.ok);

    const second = acquireLock({ lockDir, pid: 222, isAlive: alwaysAlive });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /Another scheduler is already running/);
    assert.equal(second.heldBy?.pid, 111, 'names the live holder');
  });

  it('will not steal a lock held by a live process', () => {
    const lockDir = tempLockDir();
    acquireLock({ lockDir, pid: 111, isAlive: alwaysAlive });
    acquireLock({ lockDir, pid: 222, isAlive: alwaysAlive });
    // The original owner file must survive the failed attempt untouched.
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) as { pid: number };
    assert.equal(owner.pid, 111);
  });

  it('releases on normal completion, freeing it for the next process', () => {
    const lockDir = tempLockDir();
    const first = acquireLock({ lockDir, pid: 111, isAlive: alwaysAlive });
    assert.ok(first.ok);
    if (!first.ok) return;

    first.handle.release();
    assert.equal(existsSync(lockDir), false);
    assert.ok(acquireLock({ lockDir, pid: 222, isAlive: alwaysAlive }).ok, 'next process can acquire');
  });

  it('recovers a stale lock whose owner is dead', () => {
    const lockDir = tempLockDir();
    acquireLock({ lockDir, pid: 999, isAlive: alwaysAlive });

    const recovered = acquireLock({ lockDir, pid: 1000, isAlive: alwaysDead });
    assert.ok(recovered.ok);
    if (!recovered.ok) return;
    assert.equal(recovered.recoveredStale, true);
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) as { pid: number };
    assert.equal(owner.pid, 1000, 'new owner recorded');
  });

  it('leaves no stale-recovery residue behind', () => {
    const lockDir = tempLockDir();
    acquireLock({ lockDir, pid: 999, isAlive: alwaysAlive });
    acquireLock({ lockDir, pid: 1000, isAlive: alwaysDead });

    const parent = join(lockDir, '..');
    const residue = readdirSync(parent).filter((f) => f.includes('.stale-'));
    assert.deepEqual(residue, [], 'renamed stale directory is removed');
  });

  it('treats an unreadable owner file as stale rather than deadlocking', () => {
    const lockDir = tempLockDir();
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), 'not json');

    const recovered = acquireLock({ lockDir, pid: 7, isAlive: alwaysAlive });
    assert.ok(recovered.ok, 'a corrupt lock must not wedge the scheduler forever');
  });

  it('a released lock after a failing tick is still released', async () => {
    // Mirrors main()'s finally block: release happens on the failure path too.
    const lockDir = tempLockDir();
    const statePath = tempStatePath();
    const lock = acquireLock({ lockDir, pid: 555, isAlive: alwaysAlive });
    assert.ok(lock.ok);
    if (!lock.ok) return;

    try {
      const failing: JobRunner = async () => { throw new Error('boom'); };
      const result = await runTick({
        now: SUNDAY_1512, only: 'publish:approved', runner: failing, statePath, logPath: null, quiet: true,
      });
      assert.deepEqual(result.failed, ['publish:approved']);
    } finally {
      lock.handle.release();
    }
    assert.equal(existsSync(lockDir), false, 'lock released despite job failure');
  });
});

describe('process-level behaviour', () => {
  const schedulerUrl = pathToFileURL(
    join(import.meta.dirname, '..', 'src', 'scripts', 'scheduler.ts'),
  ).href;
  const schedulerPath = join(import.meta.dirname, '..', 'src', 'scripts', 'scheduler.ts');

  it('does not start when the module is imported', () => {
    // Guards the original defect: main() ran at module scope, so any import
    // started an unkillable 30s loop — which is why it had no tests.
    const started = Date.now();
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(schedulerUrl)})`], {
      stdio: 'ignore',
      timeout: 20_000,
    });
    assert.ok(Date.now() - started < 20_000, 'import returned instead of looping');
  });

  it('--dry-run exits without looping and writes no state file', () => {
    const stateBefore = existsSync(join(import.meta.dirname, '..', 'logs', 'scheduler-state.json'));
    const out = execFileSync(process.execPath, [schedulerPath, '--dry-run'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.match(out, /SCHEDULER DRY RUN/);
    assert.match(out, /No subprocess, no network, no state or log written/);
    const stateAfter = existsSync(join(import.meta.dirname, '..', 'logs', 'scheduler-state.json'));
    assert.equal(stateAfter, stateBefore, 'dry run did not create or remove the state file');
  });

  it('--only with an unknown job exits non-zero', () => {
    assert.throws(
      () => execFileSync(process.execPath, [schedulerPath, '--dry-run', '--only', 'nope'], { stdio: 'pipe', timeout: 30_000 }),
      /Unknown job/,
    );
  });

  it('a bare --once exits non-zero without running a job or writing state', () => {
    const stateFile = join(import.meta.dirname, '..', 'logs', 'scheduler-state.json');
    const before = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null;
    const lockDir = join(import.meta.dirname, '..', 'logs', 'scheduler.lock');

    let stderr = '';
    assert.throws(
      () => {
        try {
          execFileSync(process.execPath, [schedulerPath, '--once'], { stdio: 'pipe', timeout: 30_000 });
        } catch (error) {
          stderr = String((error as { stderr?: Buffer }).stderr ?? '');
          throw error;
        }
      },
      /Command failed/,
      'bare --once must exit non-zero',
    );
    assert.match(stderr, /requires an explicit execution selector/);

    const after = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null;
    assert.equal(after, before, 'state file untouched');
    assert.equal(existsSync(lockDir), false, 'no lock taken — it failed before acquiring one');
  });

  it('does not leave a lock behind after a bounded --once', () => {
    const lockDir = join(import.meta.dirname, '..', 'logs', 'scheduler.lock');
    assert.equal(existsSync(lockDir), false, 'no residue from earlier cases');
  });
});
